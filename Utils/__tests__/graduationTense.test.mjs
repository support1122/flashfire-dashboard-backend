// The recruiter outreach mail must not misstate the client's education.
//
// A real send (26 Sept 2026) closed with "I am completing my Master of Science
// in Computer Science at Northeastern University" for a client who had already
// graduated. Three things caused it: the prompt handed the model a bare date
// with no sense of today, the style-reference example in that same prompt used
// "currently pursuing", and once a template is written it is reused for months
// without anything revisiting the sentence.
//
// This is a factual claim about a real person, sent under their name to a
// recruiter, so it is settled in code rather than left to the prompt.
//
// Pure functions. No Mongo, no AI, nothing sent.

import { test } from "node:test";
import assert from "node:assert/strict";

const {
  parseGradDate,
  graduationStatus,
  profileEducationStatus,
  educationPromptLine,
  enforceEducationTense,
  educationClaimIsStale
} = await import("../graduationStatus.js");

const NOW = new Date("2026-09-26T12:00:00Z");

// ── parsing the free-text date ────────────────────────────────────────────

test("every format profile intake accepts is parsed", () => {
  const may2025 = { year: 2025, month: 5 };
  for (const raw of ["2025-05-15", "2025-05", "05/2025", "5/2025", "05-2025", "05 2025", "May 2025", "may 2025", "May, 2025", "2025 May"]) {
    assert.deepEqual(parseGradDate(raw), may2025, raw);
  }
  assert.deepEqual(parseGradDate("Sept 2025"), { year: 2025, month: 9 });
  assert.deepEqual(parseGradDate("2025"), { year: 2025, month: null });
});

test("junk is unparseable rather than guessed", () => {
  for (const raw of ["", "   ", "soon", "next year", "13/2025", "2025-13", "1849", "x".repeat(40), null, undefined]) {
    assert.equal(parseGradDate(raw), null, JSON.stringify(raw));
  }
});

// ── the graduated / still-studying decision ───────────────────────────────

test("a past graduation month reads as graduated", () => {
  const s = graduationStatus("May 2025", NOW);
  assert.equal(s.known, true);
  assert.equal(s.graduated, true);
  assert.equal(s.label, "May 2025");
});

test("a future graduation month reads as still studying", () => {
  assert.equal(graduationStatus("December 2026", NOW).graduated, false);
  assert.equal(graduationStatus("2027", NOW).graduated, false);
});

test("the current month is NOT yet graduated", () => {
  // Deliberately conservative. Saying "pursuing" a month late is awkward;
  // claiming a degree a month early is a false credential to a recruiter.
  assert.equal(graduationStatus("September 2026", NOW).graduated, false);
  assert.equal(graduationStatus("August 2026", NOW).graduated, true, "the month before has passed");
});

test("a bare year resolves at the end of that year", () => {
  assert.equal(graduationStatus("2026", NOW).graduated, false, "2026 is not over");
  assert.equal(graduationStatus("2025", NOW).graduated, true);
});

test("an unknown date claims nothing in either direction", () => {
  const s = graduationStatus("sometime soon", NOW);
  assert.equal(s.known, false);
  assert.equal(s.graduated, false);
});

// ── which degree the outreach line talks about ────────────────────────────

test("the highest degree on file wins", () => {
  const st = profileEducationStatus(
    {
      mastersUniDegree: "MS Computer Science, Northeastern University",
      mastersGradMonthYear: "May 2025",
      bachelorsUniDegree: "BE Computer Science, VTU",
      bachelorsGradMonthYear: "June 2019"
    },
    NOW
  );
  assert.equal(st.level, "masters");
  assert.equal(st.graduated, true);
  assert.match(st.degree, /Northeastern/);
});

test("a bachelors-only profile falls back to it", () => {
  const st = profileEducationStatus(
    { bachelorsUniDegree: "BS Computer Science, UT Austin", bachelorsGradMonthYear: "December 2027" },
    NOW
  );
  assert.equal(st.level, "bachelors");
  assert.equal(st.graduated, false);
});

test("no education on file says nothing", () => {
  assert.equal(profileEducationStatus({}, NOW).degree, "");
  assert.equal(profileEducationStatus(null, NOW).known, false);
});

// ── what the model is told ────────────────────────────────────────────────

test("the prompt line states the answer, not the raw date", () => {
  const grad = educationPromptLine(profileEducationStatus(
    { mastersUniDegree: "MS CS, Northeastern", mastersGradMonthYear: "May 2025" }, NOW));
  assert.match(grad, /COMPLETED/);
  assert.match(grad, /PAST tense/);
  assert.match(grad, /Never write "pursuing"/);

  const studying = educationPromptLine(profileEducationStatus(
    { mastersUniDegree: "MS CS, Northeastern", mastersGradMonthYear: "May 2027" }, NOW));
  assert.match(studying, /IN PROGRESS/);
  assert.match(studying, /Never claim the degree is already held/);

  const unknown = educationPromptLine(profileEducationStatus(
    { mastersUniDegree: "MS CS, Northeastern", mastersGradMonthYear: "" }, NOW));
  assert.match(unknown, /STATUS UNKNOWN/);
});

// ── the guarantee ─────────────────────────────────────────────────────────

const GRADUATED = { known: true, graduated: true, label: "May 2025" };
const STUDYING = { known: true, graduated: false, label: "May 2027" };

test("the exact sentence from the real send is corrected", () => {
  const before = "I am completing my Master of Science in Computer Science at Northeastern University and am authorized to work in the U.S. on F1 OPT.";
  const after = enforceEducationTense(before, GRADUATED);
  assert.equal(after.changed, true);
  assert.equal(
    after.text,
    "I completed my Master of Science in Computer Science at Northeastern University and am authorized to work in the U.S. on F1 OPT."
  );
});

test("every way a model phrases 'still studying' is caught", () => {
  const phrasings = [
    "I am currently pursuing a Master of Science in Data Science at NYU.",
    "I am pursuing my Master of Science in Data Science at NYU.",
    "I am working towards a Master of Science in Data Science at NYU.",
    "I am finishing my Master of Science in Data Science at NYU."
  ];
  for (const p of phrasings) {
    const r = enforceEducationTense(p, GRADUATED);
    assert.equal(r.changed, true, p);
    assert.match(r.text, /^I completed my Master of Science/, p);
    assert.equal(/pursuing|working towards|finishing/i.test(r.text), false, p);
  }
});

test("graduation-date phrasings are corrected too", () => {
  assert.match(
    enforceEducationTense("I will be graduating in May 2025 with a Master's degree.", GRADUATED).text,
    /I graduated in May 2025/
  );
  // "expected graduation" is a noun phrase, so only the forward-looking word
  // goes. Swapping the whole phrase for a verb would read "My graduated from".
  const noun = enforceEducationTense("My expected graduation from Northeastern University is May 2025.", GRADUATED).text;
  assert.equal(noun, "My graduation from Northeastern University is May 2025.");
  assert.equal(/expected/i.test(noun), false);
});

test("claiming a degree the client has not finished is corrected the other way", () => {
  const r = enforceEducationTense("I hold a Master of Science in Computer Science from Northeastern University.", STUDYING);
  assert.equal(r.changed, true);
  assert.match(r.text, /^I am currently pursuing a Master of Science/);
});

test("achievement bullets are never rewritten", () => {
  // THE reason the rewrite is scoped to education sentences. "completing" and
  // "pursuing" are ordinary words in a work history, and a body-wide replace
  // would rewrite the client's own accomplishments.
  const body = [
    "• Implemented CI/CD pipelines using Gearset and Jenkins, completing the migration ahead of schedule for a university client.",
    "• Led a team pursuing a 40% reduction in deployment time across the college portal.",
    "",
    "I am completing my Master of Science in Computer Science at Northeastern University."
  ].join("\n");
  const r = enforceEducationTense(body, GRADUATED);
  assert.match(r.text, /completing the migration ahead of schedule/, "bullet untouched");
  assert.match(r.text, /pursuing a 40% reduction/, "bullet untouched");
  assert.match(r.text, /I completed my Master of Science/, "education sentence fixed");
});

test("an unknown graduation date changes nothing", () => {
  const before = "I am currently pursuing a Master of Science in Computer Science.";
  const r = enforceEducationTense(before, { known: false, graduated: false });
  assert.equal(r.changed, false);
  assert.equal(r.text, before);
});

test("a body that is already right is left byte-identical", () => {
  const good = "I completed my Master of Science in Computer Science at Northeastern University.\n\nBest regards,\nPrajwal";
  const r = enforceEducationTense(good, GRADUATED);
  assert.equal(r.changed, false);
  assert.equal(r.text, good);
});

// ── the daily sweep's trigger ─────────────────────────────────────────────

test("staleness is detected for the sweep, and only when it is real", () => {
  const stale = "I am completing my Master of Science at Northeastern University.";
  assert.equal(educationClaimIsStale(stale, GRADUATED), true);
  assert.equal(educationClaimIsStale(stale, STUDYING), false, "correct for a client still studying");
  assert.equal(educationClaimIsStale(stale, { known: false }), false, "unknown date is never stale");
  assert.equal(
    educationClaimIsStale("• Completing the migration ahead of schedule for a university client.", GRADUATED),
    false,
    "a work bullet is not a stale education claim"
  );
});
