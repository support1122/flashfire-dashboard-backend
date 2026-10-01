// Covers Controllers/JobApiScrape.js - the server-side half of the autopilot's
// "Scrape from Job APIs" mode.
//
// This mode has no browser and no extension, so nothing between Adzuna and a
// client's board is visible to an operator while it runs. The assertions that
// matter are therefore the ones about what reaches the board:
//
//   • the daily cap is the same allowance manual pushes spend, and a run must
//     never push past what is left of it
//   • a job already on the board is not judged again and not pushed again
//   • only what the judge picked is written, in the shape AddJob writes
//   • a failing judge writes NOTHING, rather than pushing unjudged jobs
//
// The models, the Adzuna client, the judge and the cap are all swapped with
// mock.module, so this exercises the shipping controller without a database,
// an API key or an OpenAI call.
//
// mock.module needs --experimental-test-module-mocks, which the repo's
// `npm test` script passes.

import test, { mock } from "node:test";
import assert from "node:assert/strict";

// ── the doubles ──────────────────────────────────────────────────────

let settingsDoc = null;
let settingsUpdate = null;
let savedSettings = null;

let capResult = { remaining: 30 };
let capThrows = null;

let profileDoc = null;
let existingLinks = [];
let created = [];
let createThrowsFor = new Set();

let pages = [];          // one entry per page: {ok, results} or {ok:false,...}
let termPages = {};      // per-search-term pages, for the broadening ladder
let fetchCalls = [];
let judgeResult = null;
let judgeCalls = [];

mock.module("../../Schema_Models/JobApiSettings.js", {
  namedExports: {
    JobApiSettings: class {
      constructor(doc) { Object.assign(this, doc); }
      toObject() { return { ...this }; }
      static findOne() { return { lean: async () => settingsDoc }; }
      static findOneAndUpdate(_q, update) {
        savedSettings = update.$set;
        return { lean: async () => ({ ...settingsDoc, ...update.$set }) };
      }
      static updateOne(query, update) { settingsUpdate = { query, update }; return Promise.resolve({}); }
    },
  },
});

mock.module("../../Schema_Models/ProfileModel.js", {
  namedExports: {
    ProfileModel: { findOne: () => ({ lean: async () => profileDoc }) },
  },
});

mock.module("../../Schema_Models/UserModel.js", {
  namedExports: {
    UserModel: { findOne: () => ({ select: () => ({ lean: async () => ({ name: "Amelia" }) }) }) },
  },
});

mock.module("../../Schema_Models/JobModel.js", {
  namedExports: {
    JobModel: {
      find: () => ({
        select: () => ({ lean: async () => existingLinks.map((l) => ({ joblink: l })) }),
      }),
      create: async (doc) => {
        if (createThrowsFor.has(doc.joblink)) throw new Error("duplicate key");
        created.push(doc);
        return doc;
      },
    },
  },
});

mock.module("../../Utils/adzunaClient.js", {
  namedExports: {
    adzunaCredentials: () => ({ appId: "id", appKey: "key" }),
    // The real ladder, so these tests exercise the broadening the controller
    // actually does rather than a stand-in that cannot drift with it.
    searchLadder: (what) => {
      const w = String(what || "").trim();
      if (!w) return [];
      const parts = w.split(/\s+/);
      const out = [w];
      for (let n = parts.length - 1; n >= 1; n -= 1) {
        const t = parts.slice(-n).join(" ");
        if (!out.includes(t)) out.push(t);
      }
      return out;
    },
    fetchPage: async (settings, page) => {
      fetchCalls.push({ page, what: settings.what });
      const key = settings.what;
      const set = termPages[key];
      if (set) return set[page - 1] || { ok: true, results: [] };
      return pages[page - 1] || { ok: true, results: [] };
    },
    mapJob: (raw) => ({
      jobId: `adz-${raw.id}`,
      title: raw.title,
      company: raw.company,
      location: raw.location,
      description: raw.description || "",
      applyUrl: raw.redirect_url,
    }),
  },
});

mock.module("../../Utils/apiJudge.js", {
  namedExports: {
    judgeJobs: async (args) => { judgeCalls.push(args); return judgeResult; },
  },
});

mock.module("../../Utils/dailyCapGuard.js", {
  namedExports: {
    checkCap: async () => { if (capThrows) throw capThrows; return capResult; },
  },
});

const { getJobApiSettings, putJobApiSettings, runJobApiScrape } =
  await import("../../Controllers/JobApiScrape.js");

// ── helpers ──────────────────────────────────────────────────────────

function res() {
  const r = { code: 0, body: null };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}

const CLIENT = "amelia@example.com";

function adzJob(n, over = {}) {
  return {
    id: String(n),
    title: `Registered Nurse ${n}`,
    company: "Hospital",
    location: "Sydney",
    redirect_url: `https://adzuna.test/job/${n}`,
    ...over,
  };
}

/** Every pick, unless `picks` names the ids that should pass. */
function judgeAll(ids, picks = null) {
  return {
    ok: true,
    decisions: ids.map((id) => ({
      id: `adz-${id}`,
      pick: picks ? picks.includes(id) : true,
      score: 80,
      reason: "matches the role",
      matchedRole: "Registered Nurse",
    })),
  };
}

function reset() {
  settingsDoc = { clientEmail: CLIENT, provider: "adzuna", what: "registered nurse", maxPages: 5 };
  settingsUpdate = null; savedSettings = null;
  capResult = { remaining: 30 }; capThrows = null;
  profileDoc = { email: CLIENT, aiThreshold: 50, aiSummary: "RN, 5 years" };
  existingLinks = []; created = []; createThrowsFor = new Set();
  pages = []; termPages = {}; fetchCalls = []; judgeResult = null; judgeCalls = [];
}

async function run(body = {}) {
  const r = res();
  await runJobApiScrape({ params: { email: CLIENT }, body }, r);
  return r;
}

// ── saving the search (the pencil) ───────────────────────────────────

test("numbers arriving from the form as strings are stored as numbers", async () => {
  reset();
  const r = res();
  await putJobApiSettings(
    { params: { email: CLIENT }, body: { what: "nurse", maxDaysOld: "2", resultsPerPage: "50", maxPages: "5" } },
    r,
  );
  assert.equal(r.code, 200);
  assert.equal(savedSettings.maxDaysOld, 2);
  assert.equal(savedSettings.resultsPerPage, 50);
  assert.equal(savedSettings.maxPages, 5);
});

test("a cleared number field is stored as null, not as NaN or an empty string", async () => {
  reset();
  await putJobApiSettings({ params: { email: CLIENT }, body: { what: "nurse", distance: "", salaryMin: "" } }, res());
  assert.equal(savedSettings.distance, null);
  assert.equal(savedSettings.salaryMin, null);
});

test("results per page is clamped to Adzuna's maximum of 50", async () => {
  reset();
  await putJobApiSettings({ params: { email: CLIENT }, body: { what: "nurse", resultsPerPage: 500 } }, res());
  assert.equal(savedSettings.resultsPerPage, 50);
});

test("max pages is capped, so one client cannot walk the whole board", async () => {
  reset();
  await putJobApiSettings({ params: { email: CLIENT }, body: { what: "nurse", maxPages: 9999 } }, res());
  assert.equal(savedSettings.maxPages, 20);
});

test("a key the UI never sends is ignored rather than written", async () => {
  reset();
  await putJobApiSettings(
    { params: { email: CLIENT }, body: { what: "nurse", isAdmin: true, __proto__x: 1 } },
    res(),
  );
  assert.equal("isAdmin" in savedSettings, false);
  assert.equal("__proto__x" in savedSettings, false);
});

test("a body with nothing settable in it is refused", async () => {
  reset();
  const r = res();
  await putJobApiSettings({ params: { email: CLIENT }, body: { nonsense: 1 } }, r);
  assert.equal(r.code, 400);
});

test("a bad email is refused before any lookup", async () => {
  reset();
  const r = res();
  await putJobApiSettings({ params: { email: "not-an-email" }, body: { what: "nurse" } }, r);
  assert.equal(r.code, 400);
  assert.equal(savedSettings, null);
});

test("reading a client with nothing saved still returns a usable form", async () => {
  reset();
  settingsDoc = null;
  const r = res();
  await getJobApiSettings({ params: { email: CLIENT } }, r);
  assert.equal(r.code, 200);
  assert.equal(r.body.configured, false);
  assert.equal(r.body.credentialsPresent, true);
  assert.ok(r.body.settings, "the form needs defaults to render");
});

// ── the run: refusing to start ───────────────────────────────────────

test("a client with no saved search is told to open the pencil", async () => {
  reset();
  settingsDoc = null;
  const r = await run();
  assert.equal(r.code, 400);
  assert.equal(r.body.error, "NOT_CONFIGURED");
  assert.equal(created.length, 0);
});

test("a saved search with no keywords is refused rather than fetching everything", async () => {
  reset();
  settingsDoc = { clientEmail: CLIENT, provider: "adzuna", what: "", where: "Sydney" };
  const r = await run();
  assert.equal(r.code, 400);
  assert.equal(r.body.error, "NO_SEARCH_TERMS");
  assert.equal(fetchCalls.length, 0, "nothing should be fetched for an empty search");
});

test("a client already at today's cap fetches nothing at all", async () => {
  reset();
  capResult = { remaining: 0 };
  const r = await run();
  assert.equal(r.code, 200);
  assert.equal(r.body.outcome, "cap-hit");
  assert.equal(fetchCalls.length, 0);
  assert.equal(created.length, 0);
});

test("a cap we cannot read stops the run instead of guessing", async () => {
  reset();
  capThrows = new Error("cap service down");
  const r = await run();
  assert.equal(r.code, 503);
  assert.equal(r.body.error, "CAP_UNAVAILABLE");
  assert.equal(created.length, 0);
});

// ── the run: fetching ────────────────────────────────────────────────

test("paging stops as soon as a page comes back empty", async () => {
  reset();
  pages = [{ ok: true, results: [adzJob(1)] }, { ok: true, results: [] }];
  judgeResult = judgeAll([1]);
  await run();
  assert.deepEqual(fetchCalls.map((c) => c.page), [1, 2], "it must not keep asking for pages 3, 4, 5");
});

test("the same job on two pages is fetched once", async () => {
  reset();
  pages = [{ ok: true, results: [adzJob(1), adzJob(2)] }, { ok: true, results: [adzJob(2), adzJob(3)] },
           { ok: true, results: [] }];
  judgeResult = judgeAll([1, 2, 3], []);
  const r = await run();
  assert.equal(r.body.fetched, 3);
});

test("an Adzuna failure is reported as an api-error, not as an empty search", async () => {
  reset();
  pages = [{ ok: false, error: "ADZUNA_503", message: "service unavailable" }];
  const r = await run();
  assert.equal(r.code, 200);
  assert.equal(r.body.success, false);
  assert.equal(r.body.outcome, "api-error");
  assert.equal(r.body.error, "ADZUNA_503");
  assert.equal(created.length, 0);
});

test("a search that genuinely found nothing says so without claiming an error", async () => {
  reset();
  pages = [{ ok: true, results: [] }];
  const r = await run();
  assert.equal(r.body.success, true);
  assert.equal(r.body.outcome, "no-results");
});

// ── the run: judging and pushing ─────────────────────────────────────

test("a job already on the board is neither judged nor pushed again", async () => {
  reset();
  pages = [{ ok: true, results: [adzJob(1), adzJob(2)] }, { ok: true, results: [] }];
  existingLinks = ["https://adzuna.test/job/1"];
  judgeResult = judgeAll([2]);
  const r = await run();
  assert.equal(r.body.fetched, 2);
  assert.equal(r.body.alreadyHad, 1);
  assert.equal(r.body.judged, 1);
  assert.deepEqual(judgeCalls[0].jobs.map((j) => j.jobId), ["adz-2"]);
  assert.deepEqual(created.map((d) => d.joblink), ["https://adzuna.test/job/2"]);
});

test("only what the judge picked is written", async () => {
  reset();
  pages = [{ ok: true, results: [adzJob(1), adzJob(2), adzJob(3)] }, { ok: true, results: [] }];
  judgeResult = judgeAll([1, 2, 3], [2]);
  const r = await run();
  assert.equal(r.body.picked, 1);
  assert.equal(r.body.pushed, 1);
  assert.deepEqual(created.map((d) => d.joblink), ["https://adzuna.test/job/2"]);
});

test("a failing judge pushes nothing at all", async () => {
  reset();
  pages = [{ ok: true, results: [adzJob(1), adzJob(2)] }, { ok: true, results: [] }];
  judgeResult = { ok: false, error: "OPENAI_401", message: "key revoked" };
  const r = await run();
  assert.equal(r.code, 502);
  assert.equal(r.body.outcome, "judge-failed");
  assert.equal(created.length, 0, "unjudged jobs must never reach a client's board");
});

test("a run never pushes more than the cap has left", async () => {
  reset();
  capResult = { remaining: 2 };
  pages = [{ ok: true, results: [adzJob(1), adzJob(2), adzJob(3), adzJob(4)] }, { ok: true, results: [] }];
  judgeResult = judgeAll([1, 2, 3, 4]);
  const r = await run();
  assert.equal(created.length, 2);
  assert.equal(r.body.pushed, 2);
  assert.equal(r.body.outcome, "cap-reached");
  assert.equal(r.body.remainingBefore, 2);
});

test("the judge is asked with the client's own threshold and summary", async () => {
  reset();
  profileDoc = { email: CLIENT, aiThreshold: 72, aiSummary: "ICU nurse, Sydney" };
  pages = [{ ok: true, results: [adzJob(1)] }, { ok: true, results: [] }];
  judgeResult = judgeAll([1], []);
  await run();
  assert.equal(judgeCalls[0].threshold, 72);
  assert.equal(judgeCalls[0].aiSummary, "ICU nurse, Sydney");
});

test("a profile with no threshold falls back to 50 rather than to zero", async () => {
  reset();
  profileDoc = { email: CLIENT };
  pages = [{ ok: true, results: [adzJob(1)] }, { ok: true, results: [] }];
  judgeResult = judgeAll([1], []);
  await run();
  assert.equal(judgeCalls[0].threshold, 50, "a 0 threshold would pass every job through");
});

test("a pushed card carries the judge's reasoning and says where it came from", async () => {
  reset();
  pages = [{ ok: true, results: [adzJob(1)] }, { ok: true, results: [] }];
  judgeResult = judgeAll([1]);
  await run({ operatorName: "Sarah", operatorEmail: "Sarah@Flashfire.com" });
  const doc = created[0];
  assert.equal(doc.userID, CLIENT);
  assert.equal(doc.source, "adzuna-api");
  assert.equal(doc.currentStatus, "saved");
  assert.equal(doc.createdByRole, "operations");
  assert.equal(doc.operatorName, "Sarah");
  assert.equal(doc.operatorEmail, "sarah@flashfire.com", "the email is stored lowercased");
  assert.equal(doc.aiDecision.score, 80);
  assert.equal(doc.aiDecision.reason, "matches the role");
  assert.ok(doc.aiDecision.judgedAt instanceof Date);
});

test("one job failing to write does not abandon the rest of the run", async () => {
  reset();
  pages = [{ ok: true, results: [adzJob(1), adzJob(2)] }, { ok: true, results: [] }];
  createThrowsFor = new Set(["https://adzuna.test/job/1"]);
  judgeResult = judgeAll([1, 2]);
  const r = await run();
  assert.equal(r.body.pushed, 1);
  assert.equal(r.body.picked, 2);
  assert.equal(r.body.errors.length, 1);
  assert.match(r.body.errors[0], /adz-1/);
});

test("a finished run records when it last ran", async () => {
  reset();
  pages = [{ ok: true, results: [adzJob(1)] }, { ok: true, results: [] }];
  judgeResult = judgeAll([1]);
  await run();
  assert.ok(settingsUpdate, "lastRunAt is what stops the UI showing a stale 'never run'");
  assert.ok(settingsUpdate.update.$set.lastRunAt instanceof Date);
});

test("a job title longer than the board's column is truncated, not rejected", async () => {
  reset();
  const longTitle = "Registered Nurse ".repeat(10);
  pages = [{ ok: true, results: [adzJob(1, { title: longTitle })] }, { ok: true, results: [] }];
  judgeResult = judgeAll([1]);
  const r = await run();
  assert.equal(r.body.pushed, 1);
  assert.equal(created[0].jobTitle.length, 50);
});

// ── who is allowed to touch a saved search ───────────────────────────
//
// These shipped ungated. A saved search names the role, the location and the
// salary floor we look for on a client's behalf, so an open GET leaks it and
// an open PUT lets anyone who can guess an address redirect that client's
// next run onto jobs they never asked for. The run itself was always gated;
// the two routes that decide what it runs must be too.

import { readFileSync } from "node:fs";

const ROUTES_SRC = readFileSync(new URL("../../Routes.js", import.meta.url), "utf8");

function routeLine(method, path) {
  const re = new RegExp(`app\\.${method}\\("${path.replace(/[/:]/g, (c) => "\\" + c)}".*`);
  const m = ROUTES_SRC.match(re);
  assert.ok(m, `no ${method.toUpperCase()} route registered for ${path}`);
  return m[0];
}

test("reading a client's saved search needs the ops key", () => {
  assert.match(routeLine("get", "/job-api/settings/:email"), /requireOpsKey/);
});

test("overwriting a client's saved search needs the ops key", () => {
  assert.match(routeLine("put", "/job-api/settings/:email"), /requireOpsKey/);
});

test("starting a run needs the ops key", () => {
  assert.match(routeLine("post", "/job-api/scrape/:email"), /requireOpsKey/);
});

// ── broadening a search that finds nothing ───────────────────────────
//
// Adzuna's `what` needs every word to match. Measured over 50 clients on
// 2026-09-30: 11 got zero results because their saved role title was three or
// four words long, while a shorter form of the same role returned hundreds.
// The run now walks a ladder of progressively broader terms and stops at the
// first that finds anything.

test("a saved term that works is used verbatim and nothing is broadened", async () => {
  reset();
  termPages["senior data engineer"] = [{ ok: true, results: [adzJob(1)] }, { ok: true, results: [] }];
  settingsDoc = { ...settingsDoc, what: "senior data engineer" };
  judgeResult = judgeAll([1], []);
  const r = await run();
  assert.deepEqual([...new Set(fetchCalls.map((c) => c.what))], ["senior data engineer"]);
  assert.equal(r.body.broadened, false);
  assert.equal(r.body.searchTerm, "senior data engineer");
});

test("a term that finds nothing is retried broader until something lands", async () => {
  reset();
  // Only the two-word form has anything, exactly like the real failures.
  termPages["supply chain planning analyst"] = [{ ok: true, results: [] }];
  termPages["chain planning analyst"] = [{ ok: true, results: [] }];
  termPages["planning analyst"] = [{ ok: true, results: [adzJob(7)] }, { ok: true, results: [] }];
  settingsDoc = { ...settingsDoc, what: "supply chain planning analyst" };
  judgeResult = judgeAll([7]);
  const r = await run();
  assert.equal(r.body.fetched, 1, "the broader term's results must be kept");
  assert.equal(r.body.searchTerm, "planning analyst");
  assert.equal(r.body.broadened, true, "the operator should see it was widened");
});

test("broadening stops at the first term that returns results", async () => {
  reset();
  termPages["clinical data analyst"] = [{ ok: true, results: [] }];
  termPages["data analyst"] = [{ ok: true, results: [adzJob(1)] }, { ok: true, results: [] }];
  termPages["analyst"] = [{ ok: true, results: [adzJob(2), adzJob(3)] }];
  settingsDoc = { ...settingsDoc, what: "clinical data analyst" };
  judgeResult = judgeAll([1, 2, 3]);
  const r = await run();
  assert.equal(r.body.searchTerm, "data analyst");
  assert.equal(r.body.fetched, 1, "it must not keep widening past a term that worked");
  assert.equal(fetchCalls.some((c) => c.what === "analyst"), false);
});

test("an API failure stops the run instead of being read as an empty search", async () => {
  reset();
  termPages["data engineer"] = [{ ok: false, error: "ADZUNA_503", message: "unavailable" }];
  settingsDoc = { ...settingsDoc, what: "data engineer" };
  const r = await run();
  assert.equal(r.body.outcome, "api-error");
  assert.equal(fetchCalls.some((c) => c.what === "engineer"), false,
    "a 503 is not evidence the term was too narrow");
});

test("a genuinely empty search still reports no-results after widening", async () => {
  reset();
  settingsDoc = { ...settingsDoc, what: "underwater basket weaver" };
  const r = await run();
  assert.equal(r.body.outcome, "no-results");
  assert.ok(fetchCalls.length >= 2, "it should have tried broader forms before giving up");
});
