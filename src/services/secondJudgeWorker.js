// secondJudgeWorker — second-stage screening of extension-pushed jobs.
//
// The JR-Direct extension judges jobs on JobRight's own description only (no
// scraper) and pushes the matches to the dashboard. This worker is the second
// gate: for each such job it opens the REAL employer posting via the scraper,
// scrapes the full visible text, and re-judges that text against the client
// profile (LOCATION + FRESHNESS only). It NEVER removes the job — a pass keeps
// it; a mismatch only FLAGS it (records the reason) for the operator to review
// and decide. currentStatus/timeline are never touched here.
//
// Pattern mirrors autoOptimizationWorker.js: MongoDB polling (no Redis), atomic
// claim, exponential backoff, stale-processing recovery. Failures to SCREEN
// (scrape down, OpenAI down, thin content, no profile) fail OPEN — the job is
// kept and marked 'skipped'.
//
// secondJudge.status lifecycle:
//   pending    → queued by AddJob (extension jobs with a joblink)
//   processing → claimed by this worker
//   passed     → re-judged on real-site text, kept
//   failed     → re-judged on real-site text, mismatch → FLAGGED (kept; operator decides)
//   skipped    → could not screen after retries (kept, fail-open)

import { JobModel } from '../../Schema_Models/JobModel.js';
import { ProfileModel } from '../../Schema_Models/ProfileModel.js';
import {
  SECOND_JUDGE_SYSTEM_PROMPT,
  buildSecondJudgeUserPrompt,
} from '../../Utils/secondJudgePrompt.js';

// ─── Configuration ───────────────────────────────────────────────────
const WORKER_ENABLED = process.env.SECOND_JUDGE_ENABLED !== 'false';
const POLL_INTERVAL_MS = parseInt(process.env.SECOND_JUDGE_POLL_INTERVAL_MS) || 10000;
const DELAY_BETWEEN_JOBS_MS = parseInt(process.env.SECOND_JUDGE_DELAY_BETWEEN_JOBS_MS) || 2000;
const MAX_ATTEMPTS = parseInt(process.env.SECOND_JUDGE_MAX_ATTEMPTS) || 5;
// Backoff after each failed attempt N (minutes). First three are quick (the
// scraper/OpenAI is usually back in seconds); attempts 4 and 5 wait HOURS so a
// posting behind a long outage / slow ATS still gets two more shots over the
// next ~15h before we give up and keep it (fail-open). Index = attempts-1.
//   attempt 1 → 1 min · 2 → 2 min · 3 → 5 h · 4 → 10 h · 5 → skip
const RETRY_DELAYS_MIN = [1, 2, 5 * 60, 10 * 60];
const THRESHOLD = Number.isFinite(Number(process.env.SECOND_JUDGE_THRESHOLD))
  ? Number(process.env.SECOND_JUDGE_THRESHOLD)
  : 50;
// Floor below the scraper's own full-text floor (100) so we never re-reject a
// page the scraper already returned ok — the scraper is the single thin-gate.
const MIN_JD_CHARS = parseInt(process.env.SECOND_JUDGE_MIN_JD_CHARS) || 80;
const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

// Scraper (Playwright text extractor). EXTRACT path matches the extension's
// exports.js SCRAPER_ENDPOINTS.EXTRACT_INFO ('/extract/infor=').
const SCRAPER_BASE_URL = (process.env.SCRAPER_BASE_URL || 'http://34.100.143.80:8092').replace(/\/+$/, '');
const SCRAPER_EXTRACT_PATH = process.env.SCRAPER_EXTRACT_PATH || '/extract/infor=';
const SCRAPER_TIMEOUT_MS = parseInt(process.env.SECOND_JUDGE_SCRAPER_TIMEOUT_MS) || 45000;

// OpenAI judge (reuses the same key as /extension/openai-judge).
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const OPENAI_MODEL = process.env.OPENAI_JUDGE_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini';
const OPENAI_TIMEOUT_MS = parseInt(process.env.SECOND_JUDGE_OPENAI_TIMEOUT_MS) || 30000;

let isProcessing = false;
let workerRunning = false;
let pollTimer = null;
let lastRecoverMs = 0;
const RECOVER_EVERY_MS = 60 * 1000; // periodic stale-recovery cadence

function nowIST() {
  return new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// fetchWithTimeout — fetch that ABORTS on timeout so a slow scraper/OpenAI
// request doesn't leak a socket (the old withTimeout(fetch(...)) left the
// underlying request running). On timeout the AbortError surfaces to the
// caller, which retries with backoff / fails open.
async function fetchWithTimeout(url, options = {}, ms = 30000, label = 'request') {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } catch (e) {
    if (e?.name === 'AbortError') throw new Error(`${label} timed out after ${ms}ms`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// isScrapeableEmployerUrl — only real employer/ATS pages can be scraped for
// full text. jobright.ai / indeed / linkedin need auth or block bots, so
// scraping them yields a login/app shell — judging that text would WRONGLY
// remove a good job. For those we skip the second judge (fail-open, keep).
function isScrapeableEmployerUrl(url) {
  if (!url || typeof url !== 'string') return false;
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  if (/(^|\.)jobright\.ai$/i.test(host)) return false;
  if (/(^|\.)indeed\./i.test(host)) return false;
  if (/(^|\.)linkedin\.com$/i.test(host)) return false;
  return true;
}

// escapeRegExp — for a safe case-insensitive exact-match email lookup.
function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─── Fast deterministic pre-screen (cost saver, #2) ──────────────────
// The second judge checks ONLY location (allow US/Canada/India, remote,
// missing) + freshness (open vs closed/expired) — both strongly
// regex-detectable. When the scraped text carries NEITHER a foreign-location
// signal NOR a closed-posting signal, the LLM verdict is a certain KEEP, so we
// skip the OpenAI call. Fail-open in BOTH directions, so the regex NEVER
// removes anything on its own — it only decides whether the LLM must run:
//   • a foreign job the regex misses (no country named) → kept, exactly as the
//     LLM would (its rule: missing/unclear location → KEEP);
//   • a false foreign hit (e.g. "London, Ontario") → escalates to the LLM,
//     which confirms KEEP.
const FOREIGN_LOCATION_RX = /\b(united kingdom|u\.k\.|uk|england|scotland|wales|ireland|dublin|london|manchester|edinburgh|germany|deutschland|berlin|munich|münchen|frankfurt|france|paris|spain|madrid|barcelona|portugal|lisbon|italy|rome|milan|netherlands|amsterdam|belgium|brussels|switzerland|zurich|geneva|sweden|stockholm|norway|oslo|denmark|copenhagen|finland|helsinki|poland|warsaw|krakow|austria|vienna|czech|prague|hungary|budapest|romania|bucharest|greece|athens|singapore|hong kong|japan|tokyo|osaka|china|shanghai|beijing|shenzhen|taiwan|taipei|south korea|seoul|australia|sydney|melbourne|brisbane|perth|new zealand|auckland|wellington|united arab emirates|u\.a\.e\.|uae|dubai|abu dhabi|qatar|doha|bahrain|kuwait|oman|saudi arabia|riyadh|jeddah|israel|tel aviv|turkey|istanbul|brazil|brasil|são paulo|sao paulo|rio de janeiro|argentina|buenos aires|chile|santiago|colombia|bogota|mexico|méxico|mexico city|philippines|manila|cebu|malaysia|kuala lumpur|indonesia|jakarta|vietnam|hanoi|ho chi minh|thailand|bangkok|pakistan|karachi|lahore|bangladesh|dhaka|sri lanka|colombo|south africa|johannesburg|cape town|nigeria|lagos|abuja|kenya|nairobi|egypt|cairo|morocco|casablanca|ghana|accra)\b/i;
const CLOSED_POSTING_RX = /\b(no longer accepting applications?|this (job|position|posting|role|requisition|listing|opening) (has been |is )?(closed|filled|expired|no longer available)|position (has been )?filled|applications? (are |is )?(now )?closed|posting (is )?closed|job (has )?expired|we (are|'re) no longer (accepting|hiring)|not accepting (new )?applications?|requisition closed|position (is )?no longer available|this opportunity (has|is) (closed|no longer))\b/i;
function fastScreen(text) {
  const t = String(text || '');
  if (CLOSED_POSTING_RX.test(t)) return { needsLLM: true, hint: 'closed-signal' };
  if (FOREIGN_LOCATION_RX.test(t)) return { needsLLM: true, hint: 'foreign-location-signal' };
  return { needsLLM: false, hint: '' };
}

// friendlySkipReason — turn a raw technical error into a plain-English line the
// operator sees on the card / modal. The exact error is still stored separately
// in secondJudge.error for debugging; this is only the human-readable summary.
function friendlySkipReason(raw) {
  const m = String(raw || '').toLowerCase();
  if (m.includes('not a scrapeable') || m.includes('bad_input'))
    return 'The saved link isn’t a job-site page we can open, so the second-stage check was skipped. Job kept.';
  if (m.includes('no client profile') || m.includes('profile'))
    return 'No client profile was on file to check against, so the second-stage check was skipped. Job kept.';
  if (m.includes('timed out') || m.includes('scraper request failed') || m.includes('scraper http') ||
      m.includes('econnrefused') || m.includes('fetch failed') || m.includes('network') || m.includes('nav_timeout'))
    return 'Couldn’t open the job posting — the job site was slow or unavailable after several tries. Job kept.';
  if (m.includes('thin') || m.includes('empty') || m.includes('page text') || m.includes('content'))
    return 'The job page had almost no readable text (likely a login or bot wall), so it couldn’t be checked. Job kept.';
  if (m.includes('openai') || m.includes('grader') || m.includes('json'))
    return 'The AI screener was temporarily unavailable, so the second-stage check was skipped. Job kept.';
  return 'The second-stage check couldn’t finish after several tries. Job kept.';
}

// ─── Stale Job Recovery ──────────────────────────────────────────────
async function recoverStaleJobs() {
  const cutoff = new Date(Date.now() - STALE_THRESHOLD_MS);
  const result = await JobModel.updateMany(
    {
      'secondJudge.status': 'processing',
      'secondJudge.startedAt': { $lt: cutoff },
    },
    {
      $set: {
        'secondJudge.status': 'pending',
        'secondJudge.error': 'Recovered from stale processing state (worker restart)',
      },
    }
  );
  if (result.modifiedCount > 0) {
    console.log(`[SecondJudge] Recovered ${result.modifiedCount} stale processing job(s)`);
  }
}

// ─── Claim Next Pending Job (Atomic) ─────────────────────────────────
async function claimNextJob() {
  return JobModel.findOneAndUpdate(
    {
      'secondJudge.status': 'pending',
      'secondJudge.attempts': { $lt: MAX_ATTEMPTS },
      joblink: { $exists: true, $nin: [null, ''] },
      $or: [
        { 'secondJudge.retryAfter': { $exists: false } },
        { 'secondJudge.retryAfter': null },
        { 'secondJudge.retryAfter': { $lte: new Date() } },
      ],
    },
    {
      $set: { 'secondJudge.status': 'processing', 'secondJudge.startedAt': new Date() },
      $inc: { 'secondJudge.attempts': 1 },
    },
    { new: true, sort: { _id: 1 } }
  ).lean();
}

// ─── Mark technical failure (retry w/ backoff, fail-open after MAX) ──
// Used for screening errors (scrape down, OpenAI down, thin content, no
// profile). NEVER removes the job — after MAX attempts we 'skip' and keep it.
async function markScreenFailure(jobId, errorMessage, attempts) {
  const update = {
    'secondJudge.error': String(errorMessage).slice(0, 500),
    'secondJudge.lastFailedAt': new Date(),
  };
  if (attempts >= MAX_ATTEMPTS) {
    update['secondJudge.status'] = 'skipped';
    update['secondJudge.reason'] = friendlySkipReason(errorMessage);
    update['secondJudge.completedAt'] = new Date();
    console.error(`[SecondJudge] Job ${jobId} could not be screened after ${attempts} attempts (kept): ${errorMessage}`);
  } else {
    // Delay after THIS attempt: 1 min, 2 min, 5 h, 10 h. Falls back to 10 h if
    // MAX_ATTEMPTS is raised past the table.
    const backoffMinutes = RETRY_DELAYS_MIN[attempts - 1] ?? 10 * 60;
    update['secondJudge.status'] = 'pending';
    update['secondJudge.retryAfter'] = new Date(Date.now() + backoffMinutes * 60 * 1000);
    const human = backoffMinutes >= 60 ? `${backoffMinutes / 60} h` : `${backoffMinutes} min`;
    console.log(`[SecondJudge] Job ${jobId} screen retry in ${human} (attempt ${attempts}/${MAX_ATTEMPTS})`);
  }
  await JobModel.findByIdAndUpdate(jobId, { $set: update });
}

// ─── Scrape the real employer-site text ──────────────────────────────
async function scrapeJobText(joblink) {
  const url = `${SCRAPER_BASE_URL}${SCRAPER_EXTRACT_PATH}${encodeURIComponent(joblink)}`;
  let resp;
  try {
    resp = await fetchWithTimeout(url, { method: 'GET' }, SCRAPER_TIMEOUT_MS, 'scraper /extract');
  } catch (e) {
    const err = new Error(`Scraper request failed: ${e.message}`);
    err._stage = 'Scraper Fetch';
    throw err;
  }
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    const err = new Error(`Scraper HTTP ${resp.status}: ${txt.slice(0, 200)}`);
    err._stage = 'Scraper Fetch';
    throw err;
  }
  const data = await resp.json().catch(() => ({}));
  // /extract/infor= returns the FULL visible page text in pageText (and mirrors
  // it into mainJd/jobDescription/description for back-compat).
  const text = String(
    data?.pageText || data?.mainJd || data?.jobDescription || data?.description || ''
  ).trim();
  return { text, finalUrl: data?.finalUrl || joblink };
}

// ─── Call the OpenAI grader on the real-site text ────────────────────
async function judgeRealSite({ profile, job, scrapedText }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const err = new Error('OPENAI_API_KEY not configured on backend');
    err._stage = 'OpenAI Judge';
    throw err;
  }
  const body = {
    model: OPENAI_MODEL,
    messages: [
      { role: 'system', content: SECOND_JUDGE_SYSTEM_PROMPT },
      { role: 'user', content: buildSecondJudgeUserPrompt({ profile, job, scrapedText, threshold: THRESHOLD }) },
    ],
    response_format: { type: 'json_object' },
    temperature: 0,
  };
  let resp;
  try {
    resp = await fetchWithTimeout(
      OPENAI_URL,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
      },
      OPENAI_TIMEOUT_MS,
      'OpenAI chat.completions'
    );
  } catch (e) {
    const err = new Error(`OpenAI request failed: ${e.message}`);
    err._stage = 'OpenAI Judge';
    throw err;
  }
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    const err = new Error(`OpenAI HTTP ${resp.status}: ${txt.slice(0, 200)}`);
    err._stage = 'OpenAI Judge';
    throw err;
  }
  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content || '{}';
  let parsed = null;
  try { parsed = JSON.parse(content); } catch { /* ignore */ }
  if (!parsed || typeof parsed.pick !== 'boolean') {
    const err = new Error(`Bad grader JSON: ${content.slice(0, 200)}`);
    err._stage = 'OpenAI Judge';
    throw err;
  }
  return {
    pick: parsed.pick === true,
    score: Number.isFinite(Number(parsed.score)) ? Number(parsed.score) : 0,
    reason: typeof parsed.reason === 'string' ? parsed.reason : '',
    skipKind: typeof parsed.skipKind === 'string' ? parsed.skipKind : '',
  };
}

// ─── Remove a job that failed the second judge ───────────────────────
// Flag a job that failed the second judge — but DO NOT remove it. We never
// touch currentStatus / removal fields / timeline; the job stays exactly where
// it is. We only record the secondJudge verdict so the operator sees the flag
// (icon + reason) on the card and decides what to do. This is advisory, not an
// auto-removal.
async function flagForMismatch(job, verdict, scrapedChars) {
  const reason = (verdict.reason || 'Did not match client profile on the full posting').trim();
  await JobModel.findByIdAndUpdate(job._id, {
    $set: {
      'secondJudge.status': 'failed',
      'secondJudge.score': verdict.score,
      'secondJudge.reason': reason,
      'secondJudge.scrapedChars': scrapedChars,
      'secondJudge.completedAt': new Date(),
      'secondJudge.error': null,
    },
  });
}

// ─── Keep a job that passed the second judge ─────────────────────────
async function keepForPass(job, verdict, scrapedChars) {
  await JobModel.findByIdAndUpdate(job._id, {
    $set: {
      'secondJudge.status': 'passed',
      'secondJudge.score': verdict.score,
      'secondJudge.reason': (verdict.reason || '').trim(),
      'secondJudge.scrapedChars': scrapedChars,
      'secondJudge.completedAt': new Date(),
      'secondJudge.error': null,
    },
  });
}

// ─── Process a Single Job ────────────────────────────────────────────
async function processJob(job) {
  const tag = `[SecondJudge] [${job.userID}] [${job._id}]`;
  console.log(`${tag} Screening "${job.jobTitle}" at ${job.companyName} → ${job.joblink}`);

  // Step 0: only real employer/ATS URLs can be scraped for full text. If the
  // push left a jobright/indeed/linkedin link (employer URL never resolved),
  // skip — scraping it would yield a login wall and wrongly fail the job.
  if (!isScrapeableEmployerUrl(job.joblink)) {
    await JobModel.findByIdAndUpdate(job._id, {
      $set: {
        'secondJudge.status': 'skipped',
        'secondJudge.reason': friendlySkipReason('not a scrapeable employer URL'),
        'secondJudge.error': 'joblink is not a scrapeable employer URL — kept',
        'secondJudge.completedAt': new Date(),
      },
    });
    console.warn(`${tag} Skipped: non-employer joblink (${job.joblink}) — kept`);
    return;
  }

  // Step 1: client profile (the grader ground-truth). No profile → can't judge.
  // Try exact match first, then case-insensitive (push lowercases the email but
  // some profiles may be stored with original case).
  let profile = await ProfileModel.findOne({ email: job.userID }).lean();
  if (!profile && job.userID) {
    profile = await ProfileModel.findOne({
      email: new RegExp(`^${escapeRegExp(job.userID)}$`, 'i'),
    }).lean();
  }
  if (!profile) {
    // Fail-open: keep the job, mark skipped (permanent — retrying won't help).
    await JobModel.findByIdAndUpdate(job._id, {
      $set: {
        'secondJudge.status': 'skipped',
        'secondJudge.reason': friendlySkipReason('No client profile found'),
        'secondJudge.error': 'No client profile found for second judge',
        'secondJudge.completedAt': new Date(),
      },
    });
    console.warn(`${tag} Skipped: no profile for ${job.userID} (kept)`);
    return;
  }

  // Step 2: scrape the real employer-site text.
  const { text } = await scrapeJobText(job.joblink);
  if (!text || text.length < MIN_JD_CHARS) {
    const err = new Error(`Thin/empty scrape (${text ? text.length : 0} chars, need >= ${MIN_JD_CHARS})`);
    err._stage = 'Scraper Content';
    throw err; // retry/backoff; fail-open after MAX
  }

  // Step 2.5: fast deterministic screen (#2). If the scraped text shows no
  // foreign-location signal and no closed/expired signal, the LLM verdict is a
  // certain KEEP — skip the OpenAI call entirely. Only ambiguous pages (a
  // foreign-location or closed hint) pay for the LLM, which then confirms and
  // guards against regex false-positives (e.g. "London, Ontario" / boilerplate).
  const fast = fastScreen(text);
  if (!fast.needsLLM) {
    await keepForPass(
      job,
      { score: 85, reason: 'Kept — fast location/freshness check: no foreign-location or closed-posting signal in the posting.', skipKind: '' },
      text.length
    );
    console.log(`${tag} FAST-KEPT (no LLM call — no foreign/closed signal)`);
    return;
  }
  console.log(`${tag} fast-screen escalating to LLM (${fast.hint})`);

  // Step 3: re-judge on the real-site text.
  const verdict = await judgeRealSite({ profile, job, scrapedText: text });
  const pass = verdict.pick === true && verdict.score >= THRESHOLD;
  // Hard guard: this stage flags ONLY location/freshness. Ignore any stray
  // role/sponsorship/other flag the model emits (or an old prompt leaks) —
  // those are not this stage's job, so keep the job.
  const VALID_FLAGS = new Set(['location-mismatch', 'threshold']);

  if (pass || !VALID_FLAGS.has(verdict.skipKind)) {
    await keepForPass(job, verdict, text.length);
    console.log(`${tag} ${pass ? 'PASS' : `KEPT (ignored non-location flag: ${verdict.skipKind || 'none'})`} (score ${verdict.score})`);
  } else {
    await flagForMismatch(job, verdict, text.length);
    console.log(`${tag} FLAGGED (score ${verdict.score}${verdict.skipKind ? `, ${verdict.skipKind}` : ''}) — kept, operator review`);
  }
}

// ─── Polling Loop ────────────────────────────────────────────────────
async function pollLoop() {
  if (!workerRunning) return;
  // Periodic stale-recovery (not just at boot): a job left in 'processing' by a
  // crash/restart is invisible to claimNextJob (which only picks 'pending').
  // Fire-and-forget so it never delays claiming; the updateMany is indexed.
  if (Date.now() - lastRecoverMs > RECOVER_EVERY_MS) {
    lastRecoverMs = Date.now();
    recoverStaleJobs().catch((e) => console.warn('[SecondJudge] recover error:', e.message));
  }
  try {
    const job = await claimNextJob();
    if (job) {
      isProcessing = true;
      try {
        await processJob(job);
      } catch (err) {
        const attempts = job.secondJudge?.attempts || 1;
        await markScreenFailure(job._id, `${err._stage || 'Unknown'}: ${err.message}`, attempts);
      }
      isProcessing = false;
      pollTimer = setTimeout(pollLoop, DELAY_BETWEEN_JOBS_MS);
    } else {
      pollTimer = setTimeout(pollLoop, POLL_INTERVAL_MS);
    }
  } catch (err) {
    console.error('[SecondJudge] Poll loop error:', err.message);
    isProcessing = false;
    pollTimer = setTimeout(pollLoop, POLL_INTERVAL_MS);
  }
}

// ─── Public API ──────────────────────────────────────────────────────
export function startSecondJudgeWorker() {
  if (!WORKER_ENABLED) {
    console.log('[SecondJudge] Disabled (SECOND_JUDGE_ENABLED=false)');
    return;
  }
  if (workerRunning) {
    console.log('[SecondJudge] Already running');
    return;
  }
  workerRunning = true;
  console.log('[SecondJudge] Starting second-stage screening worker');
  console.log(`[SecondJudge] Config: poll=${POLL_INTERVAL_MS}ms, maxAttempts=${MAX_ATTEMPTS}, threshold=${THRESHOLD}, model=${OPENAI_MODEL}`);
  console.log(`[SecondJudge] Scraper: ${SCRAPER_BASE_URL}${SCRAPER_EXTRACT_PATH}<url>`);

  recoverStaleJobs()
    .then(() => pollLoop())
    .catch((err) => {
      console.error('[SecondJudge] Failed to start:', err);
      workerRunning = false;
    });
}

export function stopSecondJudgeWorker() {
  workerRunning = false;
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  console.log('[SecondJudge] Stopped');
}

export function getSecondJudgeStatus() {
  return {
    running: workerRunning,
    processing: isProcessing,
    enabled: WORKER_ENABLED,
    config: {
      pollIntervalMs: POLL_INTERVAL_MS,
      maxAttempts: MAX_ATTEMPTS,
      threshold: THRESHOLD,
      model: OPENAI_MODEL,
      scraper: `${SCRAPER_BASE_URL}${SCRAPER_EXTRACT_PATH}`,
    },
  };
}
