// enforceGeographicNote — the deterministic Round 5 pass in
// Controllers/BuildAiSummary.js.
//
// Regression origin (2026-10-09): Ahaan Malhotra's brief shipped with
// "treat an unconfirmed or out-of-home-country location on such titles as a
// skip; keep the role only when the posting confirms a US location" in
// # Notes for Grader, while his operator notes said the opposite - "Ahaan is
// open to all locations. Never skip a relevant job based on location." - and
// no R9 disqualifier bullet existed to partner it.
//
// Downstream that sentence is a gate, not a hint. The judge skipped US finance
// internships for having no spelled-out location, and tagged several
// "auth-mismatch" (rendered "WORK-AUTH MISMATCH") because the extension's
// reason code for a citizenship/clearance demand was the nearest bucket. The
// candidate holds a Green Card, so the tag was nonsense; the brief was lying
// to the judge.
//
// The helper is not exported (the controller exports only its HTTP handlers),
// so it is sliced out of the source and evaluated on its own. That keeps the
// test honest: it runs the shipped code, not a copy.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, '..', '..', 'Controllers', 'BuildAiSummary.js');
const src = readFileSync(SRC, 'utf8');

function loadHelper() {
  const start = src.indexOf('const R9_BULLET_RX');
  const end = src.indexOf('function enforceRemovalDirectives');
  assert.ok(start !== -1, 'R9_BULLET_RX not found — was the helper renamed?');
  assert.ok(end > start, 'enforceRemovalDirectives not found after the helper');
  return new Function(`${src.slice(start, end)}\nreturn enforceGeographicNote;`)();
}
const enforceGeographicNote = loadHelper();

const AHAAN_NOTES = `Ahaan is open to all locations. Never skip a relevant job based on location.
Only scrape jobs from smaller and less well-known financial firms.`;

const AHAAN_BRIEF = `# Hard Constraints
- Work authorisation: Green Card
- Employment types: Open to internships.

# Hard Disqualifiers
- Skip full-time roles.
- Do not restrict jobs based on location. Ahaan is open to all locations.

# Notes for Grader
Ahaan is focused on internship roles, specifically in finance, and is open to various locations. Co-op (also written 'co op') in a job title means an internship. Treat an unconfirmed or out-of-home-country location on such titles as a skip; keep the role only when the posting confirms a US location.`;

test('strips the location gate that caused the WORK-AUTH MISMATCH skips', () => {
  const out = enforceGeographicNote(AHAAN_BRIEF, AHAAN_NOTES, { email: 'ahaan@test' }, []);
  assert.ok(!/unconfirmed or out-of-home-country/i.test(out), 'the gate sentence must be gone');
  assert.ok(!/confirms a US location/i.test(out), 'no US-location requirement may survive');
});

test('keeps every other sentence in the note', () => {
  const out = enforceGeographicNote(AHAAN_BRIEF, AHAAN_NOTES, { email: 'ahaan@test' }, []);
  assert.match(out, /Co-op/i, 'the co-op sentence is required for every candidate');
  assert.match(out, /focused on internship roles/i);
});

test('leaves the other sections alone', () => {
  const out = enforceGeographicNote(AHAAN_BRIEF, AHAAN_NOTES, { email: 'ahaan@test' }, []);
  assert.match(out, /Work authorisation: Green Card/);
  assert.match(out, /Skip full-time roles\./);
});

test('a legitimate R9 brief is untouched', () => {
  const brief = `# Hard Disqualifiers
- Skip roles whose title signals a country, region, or language market outside US (e.g. Japanese Speaking, APAC Analyst, EMEA Analyst) unless the posting clearly confirms a US location.

# Notes for Grader
For any title with a non-US country/region/language keyword, treat an unconfirmed or non-US location as a skip; keep it only when the posting confirms a US or Remote-US location.`;
  const notes = 'Skip Japanese-speaking roles and APAC/EMEA analyst titles unless the job is in the USA.';
  assert.equal(enforceGeographicNote(brief, notes, { email: 'r9@test' }, []), brief);
});

test('open-to-all-locations overrides even a present R9 bullet', () => {
  const brief = `# Hard Disqualifiers
- Skip roles whose title signals a country, region, or language market outside US (e.g. APAC Analyst) unless the posting clearly confirms a US location.

# Notes for Grader
Treat an unconfirmed or non-US location as a skip; keep it only when the posting confirms a US location.`;
  const out = enforceGeographicNote(brief, 'Candidate is open to all locations.', { email: 'c@test' }, []);
  assert.ok(!/treat an unconfirmed/i.test(out));
});

test('a gate with no R9 partner bullet is stripped as spurious', () => {
  const brief = `# Hard Disqualifiers
- Skip contract roles.

# Notes for Grader
Role family trumps title cosmetics. Treat an unconfirmed location as a skip; keep the role only when the posting confirms a US location.`;
  const out = enforceGeographicNote(brief, 'Skip contract roles.', { email: 's@test' }, []);
  assert.ok(!/unconfirmed location/i.test(out));
  assert.match(out, /Role family trumps title cosmetics\./, 'real meta-guidance must survive');
});

test('prose that merely mentions a location is kept', () => {
  const brief = `# Notes for Grader
The candidate prefers a hybrid location in Boston but will consider others.`;
  assert.equal(enforceGeographicNote(brief, '', { email: 'p@test' }, []), brief);
});

test('a locked Notes section is the operator\'s call, never rewritten', () => {
  const out = enforceGeographicNote(AHAAN_BRIEF, AHAAN_NOTES, { email: 'l@test' }, ['# Notes for Grader']);
  assert.equal(out, AHAAN_BRIEF);
});

test('only the Notes section is edited', () => {
  const brief = `# Hard Disqualifiers
- Skip roles that lack a confirmed US location.

# Notes for Grader
Nothing special.`;
  const out = enforceGeographicNote(brief, '', { email: 'e@test' }, []);
  assert.match(out, /Skip roles that lack a confirmed US location\./);
});
