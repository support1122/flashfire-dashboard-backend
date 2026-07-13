// secondJudgePrompt — grader prompt for the second-stage screening worker.
//
// Stage one (the JR-Direct extension) judges ROLE FIT on JobRight's own
// description. This stage re-judges the text scraped from the REAL employer
// site, and it checks exactly two things: LOCATION and FRESHNESS. It must never
// re-litigate role, sponsorship, or anything else — those produce wrong removals
// (see the "DO NOT judge anything else" block below).
//
// The grader's verdict is only ever half of a removal. A 'threshold' (expired)
// verdict is checked against deterministic evidence in secondJudgeWorker.js
// (freshnessEvidence) before anything is removed; a 'location-mismatch' verdict
// only ever FLAGS the job for an operator. So the prompt's job is to be right,
// not to be trusted blindly.
//
// Exports:
//   buildSecondJudgeSystemPrompt({ staleAfterDays }) — the grader instructions.
//     The freshness WORKED EXAMPLES are generated from the configured window, not
//     hardcoded: at a 60-day window "Posted 30+ days ago" is a KEEP, at a 3-day
//     window it is a REMOVE. Baking one window into the examples while the user
//     message carries another teaches the model the opposite of the rule, and the
//     examples win often enough to matter.
//   buildSecondJudgeUserPrompt({ profile, job, scrapedText, threshold, todayISO,
//     staleAfterDays }) — the user message: today's date + freshness rule,
//     candidate context, and the real-site JD for one job.

// Anchor date for the worked examples. Fixed, so the system prompt is identical
// on every request for a given window and stays prompt-cacheable.
const EX_TODAY = '2026-07-09';
const DAY_MS = 86400000;
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

/**
 * @param {{staleAfterDays?: number}} opts
 * @returns {string} the grader system prompt, with freshness examples matching the window.
 */
export function buildSecondJudgeSystemPrompt({ staleAfterDays = 60 } = {}) {
  const W = Math.max(1, Number(staleAfterDays) || 60);
  const freshFrom = addDays(EX_TODAY, -W);       // oldest date that is still fresh
  const staleUpTo = addDays(EX_TODAY, -(W + 1)); // newest date that is stale
  // A date comfortably inside the window, whatever W is.
  const clearlyFresh = addDays(EX_TODAY, -Math.min(2, W));
  const dates = `Today is ${EX_TODAY}, FRESH FROM ${freshFrom}, STALE UP TO ${staleUpTo}`;

  // "Posted 30+ days ago" is read as exactly 30 (see the user-message rule), so
  // whether it survives depends entirely on W.
  const thirtyPlusKept = 30 <= W;
  const ex30 = thirtyPlusKept
    ? `Example 19 — KEEP. The freshness window is ${W} days. JD header: "Posted 30+ days
ago." Read "30+" as exactly 30 — never guess a bigger number — and 30 is inside
the ${W}-day window. →
{"pick":true,"score":85,"reason":"Posted about 30 days ago, inside the freshness window.","skipKind":""}`
    : `Example 19 — FLAG. The freshness window is ${W} days. JD header: "Posted 30+ days
ago." Read "30+" as exactly 30 — never guess a bigger number — and 30 is well
beyond the ${W}-day window. →
{"pick":false,"score":20,"reason":"Posted about 30 days ago, beyond the ${W}-day freshness window — the listing is stale.","skipKind":"threshold"}`;

  // The boundary pair, in relative form. At W=3 these are "3 days ago" (keep) and
  // "4 days ago" (flag) — the distinction the model gets wrong most often.
  const exBoundaryRel = `Example 20 — KEEP (BOUNDARY, relative form). The freshness window is ${W} days.
JD header: "Posted ${W} day${W === 1 ? '' : 's'} ago." Exactly ${W} is INSIDE the window. →
{"pick":true,"score":84,"reason":"Posted ${W} day${W === 1 ? '' : 's'} ago, on the edge of the freshness window — still open.","skipKind":""}

Example 21 — FLAG (BOUNDARY, the other side). The freshness window is ${W} days.
JD header: "Posted ${W + 1} days ago." One day past the window is stale, even though it
"feels" recent, and even though the location is fine. →
{"pick":false,"score":25,"reason":"Posted ${W + 1} days ago, past the ${W}-day freshness window — the listing is stale.","skipKind":"threshold"}`;

  return `You are the SECOND-STAGE screener for a job-search assistant. A FIRST stage
already judged ROLE FIT and PASSED this job. Decide whether to KEEP this job or
flag it.

The "jd" field is text scraped from the real employer posting. Long pages are
trimmed before they reach you, so evidence may simply be absent — absence of
evidence always means KEEP.

Your ONLY job is to check TWO things:

1) LOCATION — be LENIENT. The allowed countries are ALWAYS United States,
   Canada and India, for every candidate. That list never changes, and the
   candidate's own city or country never narrows it.
   KEEP (pick=true) whenever the role is in ANY of the three — any US, Canada or
   India city, ON-SITE or REMOTE, even when that city is not the candidate's
   preferred one, and even when the candidate prefers remote (a US/Canada/India
   on-site role is still fine). Also KEEP when the role is remote / hybrid /
   flexible, or the location is missing or unclear.
   Flag ONLY when the posting clearly places the role in a country OUTSIDE those
   three (e.g. UK, Germany, Singapore, UAE, Australia) and it is not remote →
   pick=false, skipKind="location-mismatch".
   NEVER flag for: "no location provided", "unclear whether remote", a US /
   Canada / India city that differs from the candidate's preference, or
   "candidate prefers remote but the job is on-site". When in doubt, KEEP.
   The posting may name its location in another language — "Standort: Berlin,
   Deutschland. Vor Ort." means on-site in Berlin, Germany. Translate first, then
   apply the rule.

2) FRESHNESS / DATE POSTED. The user message opens with a "TODAY'S DATE" block
   giving today's date and a FRESHNESS RULE. Judge freshness ONLY against that
   block — you do NOT otherwise know the current date, so never rely on your own
   sense of it, and never assume a date you find surprising must be in the
   future.
   Flag (pick=false, skipKind="threshold") ONLY when either:
     (a) the posting explicitly says THIS position is closed / expired / filled /
         no longer accepting applications; or
     (b) the posting's own posted date is STALE by the FRESHNESS RULE you were
         given.
   For (a) the statement must be about the POSITION. A note about HOW to apply is
   NOT a closure — "we no longer accept paper resumes", "applications by post are
   no longer accepted", "we do not accept emailed CVs" all describe a submission
   channel, and the job is OPEN. KEEP those.
   A missing or unclear date is NOT evidence of closure. When in doubt, KEEP.

DO NOT judge anything else. In particular:
 • DO NOT judge visa sponsorship / work authorization. That info usually lives
   in application-form DROPDOWNS / questions that plain-text scraping cannot
   read reliably — you only see the label plus BOTH "Yes" and "No" option text,
   which is ambiguous and produces wrong removals. Ignore sponsorship entirely.
 • IGNORE application-form questions and their option text completely — e.g.
   "Will you now or in the future require sponsorship? Yes / No", "Are you
   legally authorized to work? Yes / No", EEO / gender / veteran / disability
   dropdowns, "How did you hear about us?". These are inputs the APPLICANT
   fills in, NOT job requirements. Never treat a form question or a dropdown
   option ("Yes"/"No") as a disqualifier.
 • DO NOT re-litigate the role or title — stage one already decided that. Never
   flag for role-mismatch.
 • IGNORE every OTHER job on the page. Job sites append rails titled
   "Recommended jobs", "Similar jobs", "Related jobs", "Jobs for you",
   "People also viewed", "Recently viewed" and the like. Those cards carry other
   postings' cities and posted dates. Judge ONLY the role named in "title" at
   "company". A London card in a recommended rail is NOT this job's location,
   and a date on such a card is NOT this job's posted date.

DECISION: run BOTH checks before answering. A posting that passes one still has
to pass the other.
  1. LOCATION. If it fails → pick=false, skipKind="location-mismatch". Return
     that even when the posting is freshly dated; a recent date never rescues a
     role sitting outside US / Canada / India.
  2. FRESHNESS. If it fails → pick=false, skipKind="threshold". Return that even
     when the location is fine.
  Only when BOTH pass → pick=true, skipKind="".
Default to pick=true (KEEP). When unsure, KEEP.

Return STRICT JSON only — no prose, no markdown:
{"pick":<true|false>,"score":<0-100>,"reason":"<one short sentence naming the reason>","skipKind":"<location-mismatch|threshold|''>"}

skipKind is '' when pick=true.

SCORING (0-100): location fit + freshness ONLY. A clean keep is 80-95; a clear
location mismatch or expired posting scores under 30.

REASON QUALITY — ONE concrete sentence, written for a human operator who will
read it next to the job card. Name the actual reason, e.g. "On-site in London,
UK, outside US/Canada/India and not remote." or "Listing says the position has
been filled." Never "good fit" / "see JD", and never mention sponsorship or the
role.

WORKED EXAMPLES — study these; they define the boundary precisely. This block
is identical on every request (the variable posting comes in the user message),
so judge consistently with it:

Example 1 — KEEP. JD: "Software Engineer · Austin, TX (Hybrid)." Austin is in
the United States. → {"pick":true,"score":90,"reason":"Role is in Austin, TX (US).","skipKind":""}

Example 2 — KEEP. JD: "Remote (United States)." US remote is allowed. →
{"pick":true,"score":90,"reason":"Remote US role.","skipKind":""}

Example 3 — KEEP. JD: "Data Analyst · Toronto, Ontario, Canada." Canada is
allowed. → {"pick":true,"score":88,"reason":"Toronto, Canada is allowed.","skipKind":""}

Example 4 — KEEP. JD: "Business Analyst · Bengaluru, India." India is allowed —
and it stays allowed even when the candidate lives in Canada and lists only
Canadian cities. The allow-list is fixed, never narrowed by the candidate. →
{"pick":true,"score":88,"reason":"Bengaluru, India is an allowed country.","skipKind":""}

Example 5 — KEEP. JD lists only responsibilities and requirements; no city,
state, or country appears anywhere. Missing location → KEEP. →
{"pick":true,"score":80,"reason":"No location stated; defaulting to keep.","skipKind":""}

Example 6 — FLAG. JD: "Marketing Manager — London, United Kingdom. On-site, no
remote." UK, on-site, outside US/Canada/India. →
{"pick":false,"score":20,"reason":"On-site in London, UK, outside US/Canada/India and not remote.","skipKind":"location-mismatch"}

Example 7 — KEEP. JD: "Operations Analyst · London, Ontario, Canada." Here
"London" is the Canadian city — Canada is allowed. →
{"pick":true,"score":88,"reason":"London, Ontario is in Canada.","skipKind":""}

Example 8 — FLAG. JD body: "This position has been filled and is no longer
accepting applications." Clearly closed. →
{"pick":false,"score":10,"reason":"Posting is filled / no longer accepting applications.","skipKind":"threshold"}

Example 9 — KEEP. JD says "our global offices span London, Singapore and New
York" in company boilerplate, but the ROLE's stated location is "Chicago, IL".
Judge the ROLE location, not boilerplate city mentions. →
{"pick":true,"score":85,"reason":"Role is in Chicago, IL; other cities are company boilerplate.","skipKind":""}

Example 10 — KEEP. JD: "Remote — must be authorized to work in the US." Remote
+ US authorization → allowed. →
{"pick":true,"score":88,"reason":"Remote US-authorized role.","skipKind":""}

Example 11 — FLAG. JD: "Standort: Berlin, Deutschland. Vor Ort." Germany,
on-site, outside the allow-list. →
{"pick":false,"score":18,"reason":"On-site in Berlin, Germany, outside US/Canada/India.","skipKind":"location-mismatch"}

Example 12 — KEEP. JD: "Hybrid · New York, NY or Remote." US hybrid/remote. →
{"pick":true,"score":90,"reason":"Hybrid/remote in New York, NY (US).","skipKind":""}

Example 13 — KEEP. ${dates}. JD header: "Posted ${clearlyFresh}." That is later than
${freshFrom}, so the posting is current. A date alone never means closed. →
{"pick":true,"score":88,"reason":"Posted ${clearlyFresh}, still an open listing.","skipKind":""}

Example 14 — FLAG. ${dates}. JD header: "Date posted: 30 January 2024." 2024-01-30
is earlier than ${staleUpTo}. →
{"pick":false,"score":15,"reason":"Posted 30 January 2024, long before the freshness cutoff — the listing is stale.","skipKind":"threshold"}

Example 15 — KEEP. Today is ${EX_TODAY}. The JD carries no posted date and no
open/closed wording anywhere. Missing date → KEEP. →
{"pick":true,"score":80,"reason":"No posted date or closure notice; defaulting to keep.","skipKind":""}

Example 16 — KEEP. Today is ${EX_TODAY}. JD header: "Posted 12 December 2026" — a
date AFTER today (a site bug or timezone artifact). A future date is not an
expired posting. →
{"pick":true,"score":80,"reason":"Posted date is not in the past; treating the listing as open.","skipKind":""}

Example 17 — KEEP (BOUNDARY). ${dates}. JD header: "Date posted: ${freshFrom}" —
exactly the FRESH FROM date, so it is fresh. Do not count days. →
{"pick":true,"score":82,"reason":"Posted ${freshFrom}, on the freshness cutoff — still open.","skipKind":""}

Example 18 — FLAG (BOUNDARY, the other side). ${dates}. JD header: "Date posted:
${staleUpTo}" — exactly the STALE UP TO date, so it is stale, even though the
location is fine. →
{"pick":false,"score":25,"reason":"Posted ${staleUpTo}, before the freshness cutoff — the listing is stale.","skipKind":"threshold"}

${ex30}

${exBoundaryRel}

Example 22 — FLAG. The freshness window is ${W} days. JD header: "Posted 4 months
ago." Four months is far beyond ${W} days. →
{"pick":false,"score":20,"reason":"Posted about four months ago, beyond the ${W}-day freshness window — the listing is stale.","skipKind":"threshold"}

Example 23 — KEEP. ${dates}. JD: "Software Engineer · Austin, TX · Posted
${clearlyFresh}. We are no longer accepting paper resumes; please apply online."
That sentence is about the SUBMISSION CHANNEL, not the position. The job is open. →
{"pick":true,"score":88,"reason":"Role is in Austin, TX (US) and the listing is open; the paper-resume note is only about how to apply.","skipKind":""}

Example 24 — KEEP. ${dates}. title="Cloud Engineer", company="Manulife". JD:
"Cloud Engineer · Available in 2 locations · Posted Date: ${clearlyFresh} ·
Hybrid", followed by "Recommended Jobs — Analyst, London UK, posted 2 January
2024". The role's own date is inside the window, and the London card plus its old
date belong to a DIFFERENT job in a recommended rail — judge neither. →
{"pick":true,"score":88,"reason":"Posted ${clearlyFresh} and hybrid; the London listing is a recommended-jobs card, not this role.","skipKind":""}

Default whenever the evidence is thin, mixed, or ambiguous: KEEP (pick=true).`;
}

// fmtList — normalize a locations field into clean, individual entries. The
// value may be a plain delimited string, a proper array, OR an array whose
// elements are themselves comma/slash/pipe-joined strings (some save paths store
// the whole list in one element). Flatten AND split every element.
function fmtList(v) {
    const items = Array.isArray(v) ? v : (typeof v === 'string' ? [v] : []);
    const out = [];
    for (const item of items) {
        if (typeof item !== 'string') continue;
        for (const piece of item.split(/\s*[/|,]\s*|\s{2,}/)) {
            const t = piece.trim();
            if (t) out.push(t);
        }
    }
    return out;
}

// extractRelevantJd — slim the full scraped page text down to the
// location/freshness evidence the second stage actually grades on. Keeps a
// header window (location is normally near the top) plus any later line that
// carries a location / date / open-or-closed keyword. Short pages pass through
// untouched. Bounds input to MAX_JD_CHARS so a single call stays cheap.
const MAX_JD_CHARS = 3500;
const HEAD_CHARS = 1600;
const JD_SIGNAL_RX = /(locat|remote|hybrid|on-?site|relocat|\bcity\b|\bstate\b|province|country|headquarter|office|posted|date|deadline|closing|closed|expired|no longer|filled|accepting application|united states|\busa\b|canada|india|united kingdom|\buk\b|london|germany|france|singapore|australia|dubai|emea|apac|europe)/i;
function extractRelevantJd(scrapedText) {
    const full = String(scrapedText || '');
    if (full.length <= MAX_JD_CHARS) return full;
    const head = full.slice(0, HEAD_CHARS);
    const picked = [];
    let used = head.length;
    for (const raw of full.slice(HEAD_CHARS).split('\n')) {
        const line = raw.trim();
        if (!line || !JD_SIGNAL_RX.test(line)) continue;
        if (used + line.length + 1 > MAX_JD_CHARS) break;
        picked.push(line);
        used += line.length + 1;
    }
    return picked.length ? `${head}\n…\n${picked.join('\n')}` : head;
}

// longDate — "2026-07-10" → "Friday, 10 July 2026". Giving the grader both forms
// lets it match a posting that spells its date out ("June 17th 2026") without
// first having to normalize it. Pinned to UTC so the server's TZ can't shift the
// day. Falls back to the raw ISO string if the date or the ICU data is missing
// (a small-icu Node build ignores the options and would emit "7/10/2026").
function longDate(iso) {
    const ms = Date.parse(`${iso}T00:00:00Z`);
    if (Number.isNaN(ms)) return String(iso);
    const out = new Date(ms).toLocaleDateString('en-GB', {
        timeZone: 'UTC',
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
    });
    return /[A-Za-z]{3}/.test(out) ? out : String(iso);
}

export function buildSecondJudgeUserPrompt({ profile, job, scrapedText, threshold, todayISO, staleAfterDays }) {
    // The model has no reliable notion of "now" (its own sense of the current
    // date lags its training data), so the freshness check MUST be anchored to a
    // date we supply. Without this it reads a recent posted date as a strange
    // future date and calls a live posting "closed/expired".
    //
    // We hand it the CUTOFF DATE, computed here, rather than only a day count:
    // LLMs compare two calendar dates reliably but subtract them badly ("is
    // 17 June 2026 more than 60 days before 10 July 2026?"). The day count is
    // still given, because postings that state a RELATIVE age ("posted 30+ days
    // ago") can only be judged that way. Each form gets its own rule line, so
    // the model never has to convert between them.
    const today = todayISO || new Date().toISOString().slice(0, 10);
    const staleDays = Number.isFinite(Number(staleAfterDays)) ? Number(staleAfterDays) : 60;
    const todayMs = Date.parse(`${today}T00:00:00Z`);
    // Two dates, not one. A single "cutoff" forces the model to decide whether a
    // date is ON it or one day BEFORE it, and it gets that wrong in both
    // directions. Naming the oldest FRESH date and the newest STALE date means
    // every date matches exactly one rule and nothing hinges on "on or after".
    // freshFrom matches freshnessEvidence(), which is stale only when
    // age > staleDays (strictly), i.e. fresh at exactly staleDays old.
    const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
    const freshFrom = Number.isNaN(todayMs) ? today : iso(todayMs - staleDays * 86400000);
    const staleUpTo = Number.isNaN(todayMs) ? today : iso(todayMs - (staleDays + 1) * 86400000);
    // parsePostedAgeDays() scores "N months ago" as N*30 days, so the month rule
    // must be derived the same way or the two gates disagree at the edge. Below a
    // 30-day window EVERY "N months ago" is stale, and a "N ≤ 0 → FRESH" line
    // would be dead text the model has to reason past — so emit one flat rule.
    const monthsLimit = Math.floor(staleDays / 30);
    const monthsRule = monthsLimit < 1
        ? `  • "posted N months ago" (any N ≥ 1)          → STALE, pick=false, skipKind="threshold"`
        : `  • "posted N months ago", N ≤ ${monthsLimit}          → FRESH, keep
  • "posted N months ago", N > ${monthsLimit}          → STALE, pick=false, skipKind="threshold"`;
    // "30+ days ago" is read as exactly 30, so whether it survives depends on the
    // window. Stating the verdict outright beats making the model derive it.
    const thirtyPlusNote = 30 <= staleDays
        ? `        "30+ days ago" means "at least 30". Take it as exactly 30, so it is
        FRESH. Never guess a number larger than the posting actually states.`
        : `        "30+ days ago" means "at least 30". Take it as exactly 30 — never guess
        a bigger number — and 30 is beyond ${staleDays}, so it is STALE.`;

    const dateBlock = `## TODAY'S DATE — this is "now". Judge the posting against it.
Today is ${longDate(today)} (${today}).
You do NOT otherwise know the current date.

Two dates decide freshness. Every posted date matches exactly one of them:
  FRESH FROM  ${longDate(freshFrom)} (${freshFrom}) — this date, and every LATER date, is fresh.
  STALE UP TO ${longDate(staleUpTo)} (${staleUpTo}) — this date, and every EARLIER date, is stale.
These two are consecutive days. There is no gap and no overlap between them.

FRESHNESS RULE — take the ONE line that matches what the posting actually says:
  • a calendar date of ${freshFrom} or later   → FRESH, keep
  • a calendar date of ${staleUpTo} or earlier → STALE, pick=false, skipKind="threshold"
  • a calendar date after today (${today})     → a site bug, FRESH, keep
  • "posted N days ago", N ≤ ${staleDays}            → FRESH, keep
${thirtyPlusNote}
  • "posted N days ago", N > ${staleDays}            → STALE, pick=false, skipKind="threshold"
${monthsRule}
  • "posted today" / "yesterday" / "N hours ago" → FRESH, keep
  • no posted date anywhere                     → keep
Compare calendar dates directly. Do NOT count the days between two dates, and do
not let a date "feeling recent" override the two dates above.`;

    // Candidate context only — the allow-list is fixed (US / Canada / India) and
    // this block must never narrow it. It is spelled out because the model
    // otherwise reads the candidate's own country as the allow-list and flags,
    // for example, a Bengaluru role for a Toronto-based client.
    const preferredLocations = fmtList(profile?.preferredLocations);
    const contextBlock = `## Candidate context — FYI ONLY. It does NOT change the allowed countries.
Allowed countries are always United States, Canada and India, whatever appears
here. Never flag a role for sitting in an allowed country that differs from the
candidate's preference.
${JSON.stringify({ preferredLocations: preferredLocations.length ? preferredLocations : '(not specified)' }, null, 2)}`;

    // Real-site JD — trimmed to the location/freshness evidence. This stage
    // judges ONLY location + open/closed, so we don't need the whole posting
    // body. Cuts input from ~8000 chars to ≤3500 with no loss of the evidence.
    const slim = {
        title: job?.jobTitle || '',
        company: job?.companyName || '',
        location: job?.jobLocation || '',
        jdSource: 'full',
        jd: extractRelevantJd(scrapedText),
    };

    return `${dateBlock}

${contextBlock}

## Scoring
A job you keep (pick=true) must score at least ${threshold}. A clean keep is
80-95; a clear location mismatch or expired posting scores under 30.

## The content to check — the real employer-site text for ONE job.
Judge ONLY the role named in "title" at "company". Ignore every other job the
page lists (recommended / similar / related jobs), including its city and its
posted date.
Check BOTH its location and its freshness, then return ONE decision:
${JSON.stringify(slim, null, 2)}`;
}
