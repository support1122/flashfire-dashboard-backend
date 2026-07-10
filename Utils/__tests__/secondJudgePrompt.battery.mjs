// Adversarial regression battery for the second-stage grader prompt.
//
// The prompt is the one part of this pipeline no unit test can cover: it is
// judged by a model, and every fix here was a real production bug found by
// running these cases (a 3-day-old posting called "expired"; a Bengaluru role
// flagged as "outside US/Canada/India"; "no longer accepting paper resumes"
// read as a closure). Re-run it after ANY edit to secondJudgePrompt.js.
//
//   OPENAI_API_KEY=... RUNS=3 node Utils/__tests__/secondJudgePrompt.battery.mjs
//
// Opt-in: it calls the live grader (~27 cases x RUNS), so it costs a few cents
// and is not wired into any automated run. RUNS>1 catches flakiness that a
// single temperature-0 call hides.
//
// Every location case must FLAG at most — location mismatches are never
// auto-removed. Freshness cases feed freshnessEvidence() in secondJudgeWorker.js,
// which independently vetoes any removal the model gets wrong.
const MOD = process.argv[2] || '../secondJudgePrompt.js';
const { SECOND_JUDGE_SYSTEM_PROMPT, buildSecondJudgeUserPrompt } = await import(MOD);
const KEY = process.env.OPENAI_API_KEY;
const TODAY = '2026-07-10'; // => FRESH FROM 2026-05-11, STALE UP TO 2026-05-10
const RUNS = Number(process.env.RUNS || 2);

const CA = { preferredLocations: ['Toronto, Canada'], visaStatus: 'Canadian citizen' };
const IN_ = { preferredLocations: ['Bengaluru, India'], visaStatus: 'Indian citizen' };

const cases = [
  // ---- LOCATION: the allow-list is US/Canada/India, NOT the candidate's city
  ['loc: Austin TX, candidate prefers Toronto', CA, 'SWE', 'Acme', 'Software Engineer\nAustin, TX (Hybrid)\nPosted 1 July 2026', { pick: true }],
  ['loc: Bengaluru, candidate homeCountry US+Canada', CA, 'BA', 'Acme', 'Business Analyst\nBengaluru, India\nPosted 1 July 2026', { pick: true }],
  ['loc: London ONTARIO (Canada)', CA, 'Ops', 'Acme', 'Operations Analyst\nLondon, Ontario, Canada\nPosted 1 July 2026', { pick: true }],
  ['loc: London UK on-site -> FLAG', CA, 'Mktg', 'Acme', 'Marketing Manager\nLondon, United Kingdom\nOn-site, no remote.\nPosted 1 July 2026', { pick: false, skipKind: 'location-mismatch' }],
  ['loc: Berlin on-site -> FLAG', CA, 'Eng', 'Acme', 'Standort: Berlin, Deutschland. Vor Ort.\nPosted 1 July 2026', { pick: false, skipKind: 'location-mismatch' }],
  ['loc: Singapore on-site, Indian candidate -> FLAG', IN_, 'Eng', 'Acme', 'Data Engineer\nSingapore\nOn-site only.\nPosted 1 July 2026', { pick: false, skipKind: 'location-mismatch' }],
  ['loc: Chicago role, London/Singapore boilerplate', CA, 'PM', 'Acme', 'Product Manager\nChicago, IL\nOur global offices span London, Singapore and New York.\nPosted 1 July 2026', { pick: true }],
  ['loc: none stated', CA, 'SWE', 'Acme', 'Software Engineer\nBuild services. Own delivery.\nPosted 1 July 2026', { pick: true }],
  ['loc: Remote US, candidate prefers on-site Toronto', CA, 'SRE', 'Acme', 'SRE\nRemote (United States)\nPosted 1 July 2026', { pick: true }],

  // ---- FRESHNESS: FRESH FROM 2026-05-11, STALE UP TO 2026-05-10
  ['date: exactly FRESH FROM 2026-05-11 -> keep', CA, 'SWE', 'Acme', 'Software Engineer\nAustin, TX\nDate posted: 11 May 2026', { pick: true }],
  ['date: exactly STALE UP TO 2026-05-10 -> FLAG', CA, 'SWE', 'Acme', 'Software Engineer\nAustin, TX\nDate posted: 10 May 2026', { pick: false, skipKind: 'threshold' }],
  ['date: Manulife "Posted Date:June 17th 2026"', CA, 'Cloud Engineer', 'Manulife', 'Cloud Engineer\nAvailable in 2 locations\nPosted Date:June 17th 2026\nHybrid', { pick: true }],
  ['date: "Posted 07 July 2026" (the old bug)', CA, 'Senior AI/ML Engineer', 'Alter Domus', 'Senior AI/ML Engineer\nPosted 07 July 2026\nApply now', { pick: true }],
  ['date: 30 January 2024 -> FLAG', CA, 'COBOL Dev', 'Acme', 'COBOL Developer\nAustin, TX\nDate posted: 30 January 2024', { pick: false, skipKind: 'threshold' }],
  ['date: none at all', CA, 'SWE', 'Acme', 'Software Engineer\nAustin, TX\nGreat benefits.', { pick: true }],
  ['date: FUTURE 12 December 2026 (site bug)', CA, 'SRE', 'Acme', 'SRE\nRemote (United States)\nPosted 12 December 2026', { pick: true }],
  ['date: relative "Posted 30+ days ago" (< 60)', CA, 'SWE', 'Acme', 'Software Engineer\nAustin, TX\nPosted 30+ days ago', { pick: true }],
  ['date: relative "Posted 90 days ago" (> 60) -> FLAG', CA, 'SWE', 'Acme', 'Software Engineer\nAustin, TX\nPosted 90 days ago', { pick: false, skipKind: 'threshold' }],
  ['date: explicit closure -> FLAG', CA, 'Analyst', 'Acme', 'Data Analyst\nBoston, MA\nThis position has been filled and is no longer accepting applications.', { pick: false, skipKind: 'threshold' }],

  // ---- BOTH checks must run; one passing never rescues the other
  ['both: Berlin (German) + no date -> location flag', CA, 'Eng', 'Acme', 'Standort: Berlin, Deutschland. Vor Ort.', { pick: false, skipKind: 'location-mismatch' }],
  ['both: Berlin + stale 2024 date -> flagged (either kind)', CA, 'Eng', 'Acme', 'Standort: Berlin, Deutschland. Vor Ort.\nDate posted: 30 January 2024', { pick: false }],
  ['both: London UK + fresh date -> location flag, not keep', CA, 'Eng', 'Acme', 'Engineer\nLondon, United Kingdom\nOn-site only.\nPosted 8 July 2026', { pick: false, skipKind: 'location-mismatch' }],

  // ---- DISTRACTORS: must never move the job
  ['distract: sponsorship dropdown', CA, 'SWE', 'Acme', 'Software Engineer\nAustin, TX\nPosted 1 July 2026\nWill you now or in the future require sponsorship? Yes No', { pick: true }],
  ['distract: EEO / veteran dropdowns', CA, 'SWE', 'Acme', 'Software Engineer\nAustin, TX\nPosted 1 July 2026\nAre you a protected veteran? Yes No Decline to answer\nGender: Male Female Decline', { pick: true }],
  ['distract: recommended rail w/ London + old date', CA, 'SWE', 'Acme', 'Software Engineer\nAustin, TX\nPosted 1 July 2026\n\nRecommended Jobs\nAnalyst\nLondon, United Kingdom\nPosted 2 January 2024', { pick: true }],
  ['distract: role mismatch (stage one owns role)', CA, 'Registered Nurse', 'Acme', 'Registered Nurse\nAustin, TX\nPosted 1 July 2026\nRN license required.', { pick: true }],
  ['distract: "no longer accepting PAPER resumes"', CA, 'SWE', 'Acme', 'Software Engineer\nAustin, TX\nPosted 1 July 2026\nWe are no longer accepting paper resumes; apply online.', { pick: true }],
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

let bad = 0;
const failures = [];
for (const [name, profile, title, company, jd, want] of cases) {
  const user = buildSecondJudgeUserPrompt({
    profile, job: { jobTitle: title, companyName: company, jobLocation: '' },
    scrapedText: jd, threshold: 50, todayISO: TODAY, staleAfterDays: 60,
  });
  const runs = [];
  for (let i = 0; i < RUNS; i++) runs.push(await judge(SECOND_JUDGE_SYSTEM_PROMPT, user));
  const ok = runs.every(v => v.pick === want.pick && (want.skipKind === undefined || v.skipKind === want.skipKind));
  if (!ok) { bad++; failures.push(name); }
  const shown = runs.map(v => `pick=${v.pick}${v.skipKind ? `/${v.skipKind}` : ''}`).join(' ');
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`        got: ${shown}\n        want: pick=${want.pick}${want.skipKind ? `/${want.skipKind}` : ''}\n        reason: ${runs[0].reason}`);
}
console.log(`\n${cases.length - bad}/${cases.length} cases correct across ${RUNS} run(s) each`);
if (failures.length) console.log('FAILING:\n - ' + failures.join('\n - '));
process.exit(bad ? 1 : 0);
