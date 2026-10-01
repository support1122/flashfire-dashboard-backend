// The Adzuna query builder and result mapper.
//
// Every expectation here was measured against the live API on 2026-09-29, not
// read off documentation. The traps that cost real time:
//
//   * app_id AND app_key are both required. Key alone -> HTTP 400; key sent as
//     both -> HTTP 401 AUTH_FAIL.
//   * results_per_page caps at 50. Asking 100 fails.
//   * The API 503s on back-to-back requests - the same query that just
//     returned 200 fails if you fire again immediately. That is rate
//     limiting, and reading it as "no results" would silently report a
//     client's search as empty.
//   * Booleans are the string "1" and must be ABSENT when off.

import test from "node:test";
import assert from "node:assert/strict";
import { buildQuery, mapJob, ADZUNA_LIMITS } from "../adzunaClient.js";

const creds = { appId: "ID", appKey: "KEY" };
const q = (settings) => Object.fromEntries(buildQuery(settings, creds));

// ── the query ─────────────────────────────────────────────────────────

test("credentials are always sent, because one alone is rejected", () => {
  const p = q({ what: "nurse" });
  assert.equal(p.app_id, "ID");
  assert.equal(p.app_key, "KEY");
});

test("a blank field is omitted, not sent empty", () => {
  // Adzuna treats an empty `what` as a filter matching nothing, so sending
  // one would turn "no keyword set" into "no jobs found".
  const p = q({ what: "", where: "   ", titleOnly: "Nurse" });
  assert.ok(!("what" in p));
  assert.ok(!("where" in p));
  assert.equal(p.title_only, "Nurse");
});

test("booleans are the string 1 and vanish when off", () => {
  const on = q({ what: "x", fullTime: true, permanent: true });
  assert.equal(on.full_time, "1");
  assert.equal(on.permanent, "1");
  const off = q({ what: "x", fullTime: false, permanent: false });
  assert.ok(!("full_time" in off), "sending 0 would filter to nothing");
  assert.ok(!("permanent" in off));
});

test("the 24-hour filter is max_days_old=1", () => {
  // Measured: "nurse" in AU returned 17,758 all-time, 3,996 at 7 days and
  // 807 at 1 day.
  assert.equal(q({ what: "nurse", maxDaysOld: 1 }).max_days_old, "1");
});

test("results_per_page is clamped to what the API accepts", () => {
  assert.equal(q({ what: "x", resultsPerPage: 100 }).results_per_page, "50");
  assert.equal(q({ what: "x", resultsPerPage: 0 }).results_per_page, "50");
  assert.equal(q({ what: "x", resultsPerPage: 10 }).results_per_page, "10");
  assert.equal(ADZUNA_LIMITS.MAX_RESULTS_PER_PAGE, 50);
});

test("zero and negative numbers are dropped rather than sent", () => {
  const p = q({ what: "x", distance: 0, salaryMin: -5, maxDaysOld: 0 });
  assert.ok(!("distance" in p));
  assert.ok(!("salary_min" in p));
  assert.ok(!("max_days_old" in p));
});

test("every saved field maps to its real Adzuna parameter name", () => {
  const p = q({
    what: "nurse", whatPhrase: "registered nurse", whatExclude: "agency",
    titleOnly: "nurse", where: "Sydney", distance: 25, category: "healthcare-nursing-jobs",
    salaryMin: 70000, salaryMax: 120000, sortBy: "date", maxDaysOld: 1,
  });
  assert.deepEqual(
    Object.keys(p).sort(),
    ["app_id", "app_key", "category", "distance", "max_days_old", "results_per_page",
     "salary_max", "salary_min", "sort_by", "title_only", "what", "what_exclude",
     "what_phrase", "where"].sort(),
  );
});

test("requests are paced, because the API 503s on rapid fire", () => {
  assert.ok(ADZUNA_LIMITS.MIN_REQUEST_GAP_MS >= 1000,
    "a gap under a second reproduces the 503s seen live");
});

// ── the mapper ────────────────────────────────────────────────────────

// A real result, copied verbatim from a live response.
const LIVE = {
  id: "5888766871",
  title: "Registered Nurse / Enrolled Nurse - Tannum Sands",
  created: "2026-09-18T15:34:57Z",
  redirect_url: "https://www.adzuna.com.au/land/ad/5888766871?se=abc&utm_medium=api",
  contract_time: "full_time",
  contract_type: "permanent",
  salary_min: 70000,
  salary_max: 70000,
  salary_is_predicted: "0",
  description: "Are you looking for a nursing role that offers genuine work-life balance?",
  company: { display_name: "Ausdocs GP Consulting" },
  location: { display_name: "Tannum Sands", area: ["Australia", "Queensland", "Central QLD Region"] },
  category: { tag: "healthcare-nursing-jobs", label: "Healthcare & Nursing Jobs" },
};

test("a live result maps onto the shape the judge and the dashboard expect", () => {
  const m = mapJob(LIVE);
  assert.equal(m.jobId, "adz-5888766871");
  assert.equal(m.source, "adzuna");
  assert.equal(m.title, "Registered Nurse / Enrolled Nurse - Tannum Sands");
  assert.equal(m.company, "Ausdocs GP Consulting");
  assert.equal(m.location, "Tannum Sands");
  assert.equal(m.applyUrl, LIVE.redirect_url);
  assert.equal(m.category, "Healthcare & Nursing Jobs");
  assert.equal(m.workModel, "full time");
});

test("the job id is namespaced so the same job found twice dedupes", () => {
  // The extension's own Adzuna scraper uses "adz-<id>". Plain integer ids
  // collide with SEEK and Reed, and the capture buffer is keyed by jobId.
  assert.ok(mapJob(LIVE).jobId.startsWith("adz-"));
});

test("location falls back to the area list when there is no display name", () => {
  const m = mapJob({ ...LIVE, location: { area: ["Australia", "Queensland", "Central QLD Region"] } });
  assert.equal(m.location, "Central QLD Region, Queensland");
});

test("an equal salary range reads as one number, not a range", () => {
  assert.equal(mapJob(LIVE).salary, "70000");
  assert.equal(mapJob({ ...LIVE, salary_max: 90000 }).salary, "70000 - 90000");
});

test("a predicted salary says so, so nobody quotes it as the employer's", () => {
  assert.match(mapJob({ ...LIVE, salary_is_predicted: "1" }).salary, /estimated/);
});

test("a result with no id or no title is dropped rather than pushed blank", () => {
  assert.equal(mapJob({ ...LIVE, id: "" }), null);
  assert.equal(mapJob({ ...LIVE, title: "   " }), null);
  assert.equal(mapJob({}), null);
  assert.equal(mapJob(null), null);
});

test("missing optional fields never throw", () => {
  const m = mapJob({ id: "1", title: "Nurse" });
  assert.equal(m.company, "");
  assert.equal(m.location, "");
  assert.equal(m.salary, "");
  assert.equal(m.description, "");
});

// ── the search-term ladder ───────────────────────────────────────────
//
// Adzuna's `what` needs every word to match, so a role title copied out of a
// client brief stops returning anything as soon as it gets specific. Measured
// over 50 clients on 2026-09-30: "supply chain analyst" returned 39 jobs,
// "supply chain planning analyst" returned 0, and 11 of 50 clients got
// nothing for that reason alone.

import { searchLadder, normalizeTerm } from "../adzunaClient.js";

test("the term the operator saved is always tried first, unchanged", () => {
  assert.equal(searchLadder("Software Engineer")[0], "Software Engineer");
  assert.equal(searchLadder("supply chain planning analyst")[0], "supply chain planning analyst");
});

test("a four-word title ends up at something Adzuna can match", () => {
  const l = searchLadder("supply chain planning analyst");
  assert.ok(l.length > 1, "a term this specific needs a fallback");
  assert.equal(l[l.length - 1], "analyst");
});

test("abbreviations are expanded, because job titles spell them out", () => {
  assert.deepEqual(normalizeTerm("Analytics Sr. Mgr"), ["analytics", "senior", "manager"]);
  assert.deepEqual(normalizeTerm("QA Eng"), ["quality", "assurance", "engineer"]);
});

test("seniority words are dropped on the second rung, not the first", () => {
  const l = searchLadder("Senior Data Engineer");
  assert.equal(l[0], "Senior Data Engineer", "what they saved is still tried first");
  assert.ok(l.includes("data engineer"), "and then the same role without the seniority");
});

test("a term that is already two words still gets one broader rung", () => {
  const l = searchLadder("policy intern");
  assert.deepEqual(l, ["policy intern", "policy"]);
});

test("the ladder never repeats a query", () => {
  for (const t of ["engineer", "data analyst", "Senior Senior Engineer", "AI Engineer"]) {
    const l = searchLadder(t);
    assert.equal(new Set(l.map((x) => x.toLowerCase())).size, l.length, `duplicate rung for ${t}`);
  }
});

test("rungs get shorter, never longer", () => {
  const words = (s) => s.split(/\s+/).length;
  for (const t of ["supply chain planning analyst", "associate product marketing", "clinical data analyst"]) {
    const l = searchLadder(t).map(words);
    for (let i = 1; i < l.length; i += 1) assert.ok(l[i] <= l[i - 1], `rung ${i} of ${t} got longer`);
  }
});

test("an empty or punctuation-only term yields nothing to try", () => {
  assert.deepEqual(searchLadder(""), []);
  assert.deepEqual(searchLadder("   "), []);
  assert.deepEqual(searchLadder("---"), ["---"]);   // saved verbatim, nothing broader
});
