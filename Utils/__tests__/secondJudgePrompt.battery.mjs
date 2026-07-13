// Adversarial regression battery for the second-stage grader prompt.
//
// The prompt is the one part of this pipeline no unit test can cover: it is
// judged by a model, and every case here was a real production bug found by
// running it (a 3-day-old posting called "expired"; a Bengaluru role flagged as
// "outside US/Canada/India"; "no longer accepting paper resumes" read as a
// closure). Re-run after ANY edit to secondJudgePrompt.js.
//
//   OPENAI_API_KEY=... RUNS=3 node Utils/__tests__/secondJudgePrompt.battery.mjs
//
// Opt-in: it calls the live grader (~27 cases x RUNS), so it costs a few cents
// and is not wired into any automated run. RUNS>1 catches flakiness that a
// single temperature-0 call hides.
//
// Freshness cases are written RELATIVE to the window (W), because the system
// prompt's worked examples are generated from it. Change SECOND_JUDGE_STALE_DAYS
// and this battery still asserts the right thing.
//
// Every location case must FLAG at most — location mismatches are never
// auto-removed. Freshness cases feed freshnessEvidence() in secondJudgeWorker.js,
// which independently vetoes any removal the model gets wrong.
const MOD = process.argv[2] || '../secondJudgePrompt.js';
const { buildSecondJudgeSystemPrompt, buildSecondJudgeUserPrompt } = await import(MOD);
const KEY = process.env.OPENAI_API_KEY;
const RUNS = Number(process.env.RUNS || 2);
const W = Number(process.env.SECOND_JUDGE_STALE_DAYS || 3);
const TODAY = '2026-07-13';

const SYSTEM = buildSecondJudgeSystemPrompt({ staleAfterDays: W });

const DAY = 86400000;
const iso = (n) => new Date(Date.parse(`${TODAY}T00:00:00Z`) - n * DAY).toISOString().slice(0, 10);
const FRESH_FROM = iso(W);      // oldest still-fresh calendar date
const STALE_UP_TO = iso(W + 1); // newest stale calendar date

const CA = { preferredLocations: ['Toronto, Canada'], visaStatus: 'Canadian citizen' };
const IN_ = { preferredLocations: ['Bengaluru, India'], visaStatus: 'Indian citizen' };

const cases = [
  // ---- LOCATION: the allow-list is US/Canada/India, NOT the candidate's city.
  //      Every JD here is dated today, so freshness can never be the reason.
  ['loc: Austin TX, candidate prefers Toronto', CA, 'SWE', 'Acme', 'Software Engineer\nAustin, TX (Hybrid)\nPosted today', { pick: true }],
  ['loc: Bengaluru, candidate homeCountry US+Canada', CA, 'BA', 'Acme', 'Business Analyst\nBengaluru, India\nPosted today', { pick: true }],
  ['loc: London ONTARIO (Canada)', CA, 'Ops', 'Acme', 'Operations Analyst\nLondon, Ontario, Canada\nPosted today', { pick: true }],
  ['loc: London UK on-site -> FLAG', CA, 'Mktg', 'Acme', 'Marketing Manager\nLondon, United Kingdom\nOn-site, no remote.\nPosted today', { pick: false, skipKind: 'location-mismatch' }],
  ['loc: Berlin on-site -> FLAG', CA, 'Eng', 'Acme', 'Standort: Berlin, Deutschland. Vor Ort.\nPosted today', { pick: false, skipKind: 'location-mismatch' }],
  ['loc: Singapore on-site, Indian candidate -> FLAG', IN_, 'Eng', 'Acme', 'Data Engineer\nSingapore\nOn-site only.\nPosted today', { pick: false, skipKind: 'location-mismatch' }],
  ['loc: Chicago role, London/Singapore boilerplate', CA, 'PM', 'Acme', 'Product Manager\nChicago, IL\nOur global offices span London, Singapore and New York.\nPosted today', { pick: true }],
  ['loc: none stated', CA, 'SWE', 'Acme', 'Software Engineer\nBuild services. Own delivery.\nPosted today', { pick: true }],
  ['loc: Remote US, candidate prefers on-site Toronto', CA, 'SRE', 'Acme', 'SRE\nRemote (United States)\nPosted today', { pick: true }],

  // ---- FRESHNESS, calendar-date form (window = W days)
  [`date: FRESH FROM ${FRESH_FROM} (exactly ${W}d) -> keep`, CA, 'SWE', 'Acme', `Software Engineer\nAustin, TX\nDate posted: ${FRESH_FROM}`, { pick: true }],
  [`date: STALE UP TO ${STALE_UP_TO} (${W + 1}d) -> FLAG`, CA, 'SWE', 'Acme', `Software Engineer\nAustin, TX\nDate posted: ${STALE_UP_TO}`, { pick: false, skipKind: 'threshold' }],
  ['date: 30 January 2024 -> FLAG', CA, 'COBOL Dev', 'Acme', 'COBOL Developer\nAustin, TX\nDate posted: 30 January 2024', { pick: false, skipKind: 'threshold' }],
  ['date: none at all -> keep', CA, 'SWE', 'Acme', 'Software Engineer\nAustin, TX\nGreat benefits.', { pick: true }],
  ['date: FUTURE 12 December 2026 (site bug) -> keep', CA, 'SRE', 'Acme', 'SRE\nRemote (United States)\nPosted 12 December 2026', { pick: true }],

  // ---- FRESHNESS, relative form — the shape real ATS pages actually use
  ['date: "Posted today" -> keep', CA, 'SWE', 'Acme', 'Software Engineer\nAustin, TX\nPosted today', { pick: true }],
  [`date: "Posted ${W} days ago" (boundary) -> keep`, CA, 'SWE', 'Acme', `Software Engineer\nAustin, TX\nPosted ${W} days ago`, { pick: true }],
  [`date: "Posted ${W + 1} days ago" (boundary) -> FLAG`, CA, 'SWE', 'Acme', `Software Engineer\nAustin, TX\nPosted ${W + 1} days ago`, { pick: false, skipKind: 'threshold' }],
  ['date: "Posted 26 Days Ago" (the real Salesforce job) -> FLAG', CA, 'Software Engineering AMTS', 'Salesforce', 'Software Engineering AMTS (College Grad)\nCalifornia - San Francisco\nPosted 26 Days Ago\nJR330400', { pick: false, skipKind: 'threshold' }],
  ['date: "Posted 30+ Days Ago" -> FLAG', CA, 'SWE', 'Acme', 'Software Engineer\nAustin, TX\nPosted 30+ Days Ago', { pick: false, skipKind: 'threshold' }],
  ['date: "Posted 4 months ago" -> FLAG', CA, 'SWE', 'Acme', 'Software Engineer\nAustin, TX\nPosted 4 months ago', { pick: false, skipKind: 'threshold' }],
  ['date: explicit closure -> FLAG', CA, 'Analyst', 'Acme', 'Data Analyst\nBoston, MA\nThis position has been filled and is no longer accepting applications.', { pick: false, skipKind: 'threshold' }],

  // ---- BOTH checks must run; one passing never rescues the other
  ['both: Berlin + fresh date -> location flag', CA, 'Eng', 'Acme', 'Standort: Berlin, Deutschland. Vor Ort.\nPosted today', { pick: false, skipKind: 'location-mismatch' }],
  [`both: Austin + ${W + 5}d old -> threshold flag`, CA, 'SWE', 'Acme', `Software Engineer\nAustin, TX\nPosted ${W + 5} days ago`, { pick: false, skipKind: 'threshold' }],

  // ---- DISTRACTORS: must never move a fresh, US-located job
  ['distract: sponsorship dropdown', CA, 'SWE', 'Acme', 'Software Engineer\nAustin, TX\nPosted today\nWill you now or in the future require sponsorship? Yes No', { pick: true }],
  ['distract: EEO / veteran dropdowns', CA, 'SWE', 'Acme', 'Software Engineer\nAustin, TX\nPosted today\nAre you a protected veteran? Yes No Decline to answer\nGender: Male Female Decline', { pick: true }],
  ['distract: recommended rail w/ London + old date', CA, 'SWE', 'Acme', 'Software Engineer\nAustin, TX\nPosted today\n\nRecommended Jobs\nAnalyst\nLondon, United Kingdom\nPosted 2 January 2024', { pick: true }],
  ['distract: role mismatch (stage one owns role)', CA, 'Registered Nurse', 'Acme', 'Registered Nurse\nAustin, TX\nPosted today\nRN license required.', { pick: true }],
  ['distract: "no longer accepting PAPER resumes"', CA, 'SWE', 'Acme', 'Software Engineer\nAustin, TX\nPosted today\nWe are no longer accepting paper resumes; apply online.', { pick: true }],
];

async function judge(sys, user) {
  for (let a = 0; a < 4; a++) {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
      body: JSON.stringify({ model: 'gpt-4o-mini', temperature: 0, response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: sys }, { role: 'user', content: user }] }),
    });
    if (r.status === 429 || r.status >= 500) { await new Promise(s => setTimeout(s, 1500 * (a + 1))); continue; }
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 160)}`);
    return JSON.parse((await r.json()).choices[0].message.content);
  }
  throw new Error('openai retries exhausted');
}

console.log(`window W=${W} days · today=${TODAY} · FRESH FROM ${FRESH_FROM} · STALE UP TO ${STALE_UP_TO}\n`);
let bad = 0;
const failures = [];
for (const [name, profile, title, company, jd, want] of cases) {
  const user = buildSecondJudgeUserPrompt({
    profile, job: { jobTitle: title, companyName: company, jobLocation: '' },
    scrapedText: jd, threshold: 50, todayISO: TODAY, staleAfterDays: W,
  });
  const runs = [];
  for (let i = 0; i < RUNS; i++) runs.push(await judge(SYSTEM, user));
  const ok = runs.every(v => v.pick === want.pick && (want.skipKind === undefined || v.skipKind === want.skipKind));
  if (!ok) { bad++; failures.push(name); }
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) {
    const shown = runs.map(v => `pick=${v.pick}${v.skipKind ? `/${v.skipKind}` : ''}`).join(' ');
    console.log(`        got: ${shown}\n        want: pick=${want.pick}${want.skipKind ? `/${want.skipKind}` : ''}\n        reason: ${runs[0].reason}`);
  }
}
console.log(`\n${cases.length - bad}/${cases.length} cases correct across ${RUNS} run(s) each`);
if (failures.length) console.log('FAILING:\n - ' + failures.join('\n - '));
process.exit(bad ? 1 : 0);
