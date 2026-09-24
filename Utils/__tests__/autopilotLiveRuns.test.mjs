// Live autopilot runs, and where the "pushed" number comes from.
//
// THE INCIDENT
// 2026-09-23, mittapallisharmelee9599@gmail.com. The autopilot UI (which asks
// the server) showed "cap 26/30" while the run record said captured 0,
// pushed 0. The record was wrong: 33 operator jobs were created for that
// client between 04:50 and 05:09 IST, inside the run's own window. The panel
// read that fed the record swallows its errors and returns 0.
//
// So `pushed` is now counted by the server from the jobs themselves, and runs
// are opened at start and updated live so the portal is never twenty minutes
// (or a closed laptop) behind.
//
// Same stubbing approach as autopilotRuns.test.mjs: the real controllers run
// against model methods swapped in place.

import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

import { AutopilotRun } from "../../Schema_Models/AutopilotRun.js";
import { JobModel } from "../../Schema_Models/JobModel.js";
import {
  recordAutopilotRun,
  startAutopilotRun,
  progressAutopilotRun,
  getAutopilotRunsSummary,
  countPushedDuring,
  STALE_RUNNING_MS
} from "../../Controllers/AutopilotRuns.js";

function fakeRes() {
  const res = { statusCode: null, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

/** Swap several model methods at once, always restore. */
async function withStubs(pairs, fn) {
  const saved = pairs.map(([m, k]) => [m, k, m[k]]);
  for (const [m, k, impl] of pairs) m[k] = impl;
  try { return await fn(); } finally { for (const [m, k, v] of saved) m[k] = v; }
}

const EMAIL = "mittapallisharmelee9599@gmail.com";
const START = "2026-09-22T23:21:00Z"; // 04:51 IST
const END = "2026-09-22T23:35:00Z";   // 05:05 IST

// ── countPushedDuring ─────────────────────────────────────────────────

test("countPushedDuring counts operator jobs inside the run window", async () => {
  let filter = null;
  await withStubs([[JobModel, "countDocuments", async (f) => { filter = f; return 33; }]], async () => {
    const n = await countPushedDuring(EMAIL, new Date(START), new Date(END));
    assert.equal(n, 33);
  });
  assert.equal(filter.userID, EMAIL);
  assert.equal(filter.createdByRole, "operations");
  const lo = filter._id.$gte.getTimestamp().getTime();
  const hi = filter._id.$lt.getTimestamp().getTime();
  assert.equal(lo, new Date(START).getTime(), "window opens at the run start");
  assert.equal(hi, new Date(END).getTime() + 1000,
    "window closes one second after the end - ObjectIds carry whole seconds");
});

test("countPushedDuring returns null when the start is unknown", async () => {
  // An old build that never sent startedAt must keep its own number rather
  // than be scored against a window that does not exist.
  for (const bad of [null, undefined, new Date("nope")]) {
    assert.equal(await countPushedDuring(EMAIL, bad, new Date()), null);
  }
});

// ── the incident, replayed ────────────────────────────────────────────

test("a run whose panel read 0 is recorded with the 33 jobs that really landed", async () => {
  let created = null;
  const res = fakeRes();
  await withStubs([
    [JobModel, "countDocuments", async () => 33],
    [AutopilotRun, "create", async (doc) => { created = doc; return { _id: new mongoose.Types.ObjectId() }; }],
  ], async () => {
    await recordAutopilotRun({ body: {
      clientEmail: EMAIL, captured: 0, pushed: 0, outcome: "cap-hit",
      startedAt: START, finishedAt: END,
    } }, res);
  });
  assert.equal(res.statusCode, 201);
  assert.equal(created.pushed, 33, "the server count wins");
  assert.equal(created.pushedReported, 0, "what the panel claimed is kept for diagnosis");
  assert.equal(res.body.pushed, 33);
});

test("an old build that sends no startedAt keeps its own pushed figure", async () => {
  let created = null;
  let counted = false;
  await withStubs([
    [JobModel, "countDocuments", async () => { counted = true; return 999; }],
    [AutopilotRun, "create", async (doc) => { created = doc; return { _id: new mongoose.Types.ObjectId() }; }],
  ], async () => {
    await recordAutopilotRun({ body: { clientEmail: EMAIL, captured: 40, pushed: 12 } }, fakeRes());
  });
  assert.equal(counted, false, "no window, no count");
  assert.equal(created.pushed, 12);
  assert.equal(created.rejected, 28);
});

test("rejected never goes negative when the server finds more than was captured", async () => {
  let created = null;
  await withStubs([
    [JobModel, "countDocuments", async () => 33],
    [AutopilotRun, "create", async (doc) => { created = doc; return { _id: new mongoose.Types.ObjectId() }; }],
  ], async () => {
    await recordAutopilotRun({ body: { clientEmail: EMAIL, captured: 0, startedAt: START, finishedAt: END } }, fakeRes());
  });
  assert.equal(created.rejected, 0);
});

test("evidence fields are stored with the run", async () => {
  let created = null;
  await withStubs([
    [JobModel, "countDocuments", async () => 3],
    [AutopilotRun, "create", async (doc) => { created = doc; return { _id: new mongoose.Types.ObjectId() }; }],
  ], async () => {
    await recordAutopilotRun({ body: {
      clientEmail: EMAIL, startedAt: START, finishedAt: END,
      pageUrl: "https://jobright.ai/jobs/recommend",
      snapshot: "Sharmelee-Mittapalli_2026-09-23_05-05-12.html",
      report: "sharmelee__20260923-050512__cap-hit.pdf",
      panelReadErrors: 14,
    } }, fakeRes());
  });
  assert.equal(created.pageUrl, "https://jobright.ai/jobs/recommend");
  assert.equal(created.snapshot, "Sharmelee-Mittapalli_2026-09-23_05-05-12.html");
  assert.equal(created.report, "sharmelee__20260923-050512__cap-hit.pdf");
  assert.equal(created.panelReadErrors, 14);
  assert.equal(created.status, "finished");
});

// ── finalizing an opened run in place ─────────────────────────────────

test("a run opened with /start is closed in place, not duplicated", async () => {
  const runId = new mongoose.Types.ObjectId();
  let updatedWith = null;
  let createdCalled = false;
  const res = fakeRes();
  await withStubs([
    [JobModel, "countDocuments", async () => 7],
    [AutopilotRun, "findOneAndUpdate", async (q, u) => { updatedWith = { q, u }; return { _id: runId }; }],
    [AutopilotRun, "create", async () => { createdCalled = true; return { _id: new mongoose.Types.ObjectId() }; }],
  ], async () => {
    await recordAutopilotRun({ body: {
      runId: String(runId), clientEmail: EMAIL, captured: 50, startedAt: START, finishedAt: END,
    } }, res);
  });
  assert.equal(createdCalled, false);
  assert.equal(res.statusCode, 200);
  assert.equal(String(updatedWith.q._id), String(runId));
  assert.equal(updatedWith.q.clientEmail, EMAIL, "a runId cannot be used to overwrite another client's run");
  assert.equal(updatedWith.u.$set.status, "finished");
  assert.equal(updatedWith.u.$set.pushed, 7);
});

test("a runId that no longer exists falls back to recording the run fresh", async () => {
  let created = null;
  await withStubs([
    [JobModel, "countDocuments", async () => 2],
    [AutopilotRun, "findOneAndUpdate", async () => null],
    [AutopilotRun, "create", async (doc) => { created = doc; return { _id: new mongoose.Types.ObjectId() }; }],
  ], async () => {
    await recordAutopilotRun({ body: {
      runId: String(new mongoose.Types.ObjectId()), clientEmail: EMAIL, startedAt: START, finishedAt: END,
    } }, fakeRes());
  });
  assert.ok(created, "the run must not be lost");
  assert.equal(created.pushed, 2);
});

// ── start ─────────────────────────────────────────────────────────────

test("start opens a running row that sorts as the newest", async () => {
  let created = null;
  const res = fakeRes();
  await withStubs([
    [AutopilotRun, "create", async (doc) => { created = doc; return { _id: new mongoose.Types.ObjectId() }; }],
  ], async () => {
    await startAutopilotRun({ body: { clientEmail: EMAIL, clientName: "Sharmelee", startedAt: START, host: "AMPL-SYS-LAP-504" } }, res);
  });
  assert.equal(res.statusCode, 201);
  assert.ok(res.body.id);
  assert.equal(created.status, "running");
  assert.equal(created.outcome, "running");
  assert.equal(created.finishedAt.getTime(), new Date(START).getTime(),
    "finishedAt tracks the latest activity while running");
});

test("start rejects a body with no client", async () => {
  const res = fakeRes();
  await startAutopilotRun({ body: {} }, res);
  assert.equal(res.statusCode, 400);
});

// ── progress ──────────────────────────────────────────────────────────

function runDoc(extra = {}) {
  return { clientEmail: EMAIL, startedAt: new Date(START), status: "running", captured: 0, ...extra };
}

test("progress recounts pushed from the jobs, whatever the panel says", async () => {
  let set = null;
  const res = fakeRes();
  await withStubs([
    [AutopilotRun, "findById", () => ({ select: () => ({ lean: async () => runDoc() }) })],
    [JobModel, "countDocuments", async () => 12],
    [AutopilotRun, "updateOne", async (q, u) => { set = u.$set; return {}; }],
  ], async () => {
    await progressAutopilotRun({ params: { id: String(new mongoose.Types.ObjectId()) },
      body: { captured: 60, pushedReported: 0, panelReadErrors: 5, stage: "Pushing 12/30", pageUrl: "https://jobright.ai/jobs/recommend" } }, res);
  });
  assert.equal(res.statusCode, 200);
  assert.equal(set.pushed, 12);
  assert.equal(set.pushedReported, 0);
  assert.equal(set.captured, 60);
  assert.equal(set.rejected, 48);
  assert.equal(set.panelReadErrors, 5);
  assert.equal(set.stage, "Pushing 12/30");
  assert.ok(set.finishedAt instanceof Date, "the heartbeat moves the activity time");
});

test("a failed or stale panel read cannot pull the live capture count backwards", async () => {
  let set = null;
  await withStubs([
    [AutopilotRun, "findById", () => ({ select: () => ({ lean: async () => runDoc({ captured: 80 }) }) })],
    [JobModel, "countDocuments", async () => 5],
    [AutopilotRun, "updateOne", async (q, u) => { set = u.$set; return {}; }],
  ], async () => {
    await progressAutopilotRun({ params: { id: String(new mongoose.Types.ObjectId()) }, body: { captured: 0 } }, fakeRes());
  });
  assert.equal(set.captured, 80);
});

test("progress cannot reopen a run that already finished", async () => {
  let wrote = false;
  const res = fakeRes();
  await withStubs([
    [AutopilotRun, "findById", () => ({ select: () => ({ lean: async () => runDoc({ status: "finished" }) }) })],
    [AutopilotRun, "updateOne", async () => { wrote = true; return {}; }],
  ], async () => {
    await progressAutopilotRun({ params: { id: String(new mongoose.Types.ObjectId()) }, body: { captured: 5 } }, res);
  });
  assert.equal(res.statusCode, 409);
  assert.equal(wrote, false);
});

test("progress rejects a malformed id and a missing run", async () => {
  const bad = fakeRes();
  await progressAutopilotRun({ params: { id: "not-an-id" }, body: {} }, bad);
  assert.equal(bad.statusCode, 400);

  const missing = fakeRes();
  await withStubs([
    [AutopilotRun, "findById", () => ({ select: () => ({ lean: async () => null }) })],
  ], async () => {
    await progressAutopilotRun({ params: { id: String(new mongoose.Types.ObjectId()) }, body: {} }, missing);
  });
  assert.equal(missing.statusCode, 404);
});

// ── the summary shows live and interrupted runs honestly ──────────────

function group(lastRun) {
  return [{
    _id: EMAIL,
    lastRun: { clientEmail: EMAIL, clientName: "Sharmelee", captured: 10, pushed: 4, rejected: 6, minutes: 0, ...lastRun },
    runs: 1, totalCaptured: 10, totalPushed: 4, totalRejected: 6, totalMinutes: 0, failedRuns: 0,
  }];
}

test("a run still sending progress shows as running", async () => {
  const res = fakeRes();
  await withStubs([[AutopilotRun, "aggregate", async () => group({ status: "running", finishedAt: new Date(), stage: "Pushing 4/30", pageUrl: "https://jobright.ai/jobs/recommend" })]], async () => {
    await getAutopilotRunsSummary({ query: { days: "1" } }, res);
  });
  const row = res.body.data[0];
  assert.equal(row.lastStatus, "running");
  assert.equal(row.lastStage, "Pushing 4/30");
  assert.equal(row.lastPageUrl, "https://jobright.ai/jobs/recommend");
});

test("a running row that went quiet is reported as interrupted, not running forever", async () => {
  const res = fakeRes();
  const quiet = new Date(Date.now() - STALE_RUNNING_MS - 60_000);
  await withStubs([[AutopilotRun, "aggregate", async () => group({ status: "running", finishedAt: quiet })]], async () => {
    await getAutopilotRunsSummary({ query: { days: "1" } }, res);
  });
  assert.equal(res.body.data[0].lastStatus, "interrupted");
});

test("an old finished row with no status field reads as finished", async () => {
  const res = fakeRes();
  await withStubs([[AutopilotRun, "aggregate", async () => group({ finishedAt: new Date() })]], async () => {
    await getAutopilotRunsSummary({ query: { days: "1" } }, res);
  });
  assert.equal(res.body.data[0].lastStatus, "finished");
  assert.equal(res.body.data[0].lastSnapshot, "");
});
