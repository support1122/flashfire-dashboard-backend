// Controller tests for the autopilot worker ("Profile") registry.
//
// Same stubbing approach as autopilotRuns.test.mjs: no mongod and no
// test.mock.module on this Node build, so the model methods are swapped in
// place and the real controller code runs against them.

import test from "node:test";
import assert from "node:assert/strict";

import { AutopilotWorker, WORKER_ONLINE_SECONDS } from "../../Schema_Models/AutopilotWorker.js";
import { AutopilotAssignment } from "../../Schema_Models/AutopilotAssignment.js";
import {
  listAutopilotWorkers,
  createAutopilotWorker,
  deleteAutopilotWorker,
  setAutopilotAssignments,
  autopilotWorkerHeartbeat
} from "../../Controllers/AutopilotWorkers.js";

function fakeRes() {
  const res = { statusCode: null, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

async function withStubs(pairs, fn) {
  const saved = pairs.map(([model, name]) => [model, name, model[name]]);
  for (const [model, name, impl] of pairs) model[name] = impl;
  try {
    return await fn();
  } finally {
    for (const [model, name, original] of saved) model[name] = original;
  }
}

const fresh = () => new Date();
const stale = () => new Date(Date.now() - (WORKER_ONLINE_SECONDS + 30) * 1000);

// ── listing ───────────────────────────────────────────────────────────

test("listAutopilotWorkers reports online state and assigned counts", async () => {
  const workers = [
    { slug: "server-1", name: "Server 1", lastSeenAt: fresh(), running: ["a@b.com"], queued: [], lanes: 7 },
    { slug: "laptop-2", name: "Laptop 2", lastSeenAt: stale(), running: ["c@d.com"], queued: ["e@f.com"], lanes: 2 }
  ];
  const res = fakeRes();
  await withStubs([
    [AutopilotWorker, "find", () => ({ sort: () => ({ lean: async () => workers }) })],
    [AutopilotAssignment, "aggregate", async () => [{ _id: "server-1", n: 12 }, { _id: "laptop-2", n: 5 }]]
  ], () => listAutopilotWorkers({ query: {} }, res));

  assert.equal(res.statusCode, 200);
  const [srv, lap] = res.body.data;
  assert.equal(srv.online, true);
  assert.deepEqual(srv.running, ["a@b.com"]);
  assert.equal(srv.assignedCount, 12);

  // A laptop that was closed mid-run must not keep claiming it is running.
  assert.equal(lap.online, false);
  assert.deepEqual(lap.running, [], "a stale heartbeat reports nothing running");
  assert.deepEqual(lap.queued, []);
  assert.equal(lap.assignedCount, 5);
});

test("listAutopilotWorkers surfaces assignments pointing at a deleted profile", async () => {
  // Those clients are invisible in every other view, so the count has to
  // appear somewhere or they are silently never worked.
  const res = fakeRes();
  await withStubs([
    [AutopilotWorker, "find", () => ({ sort: () => ({ lean: async () => [{ slug: "server-1", name: "Server 1" }] }) })],
    [AutopilotAssignment, "aggregate", async () => [{ _id: "server-1", n: 3 }, { _id: "gone", n: 4 }]]
  ], () => listAutopilotWorkers({ query: {} }, res));

  assert.equal(res.body.orphanedAssignments, 4);
});

// ── creation ──────────────────────────────────────────────────────────

test("createAutopilotWorker slugifies the name", async () => {
  let saved = null;
  const res = fakeRes();
  await withStubs([[AutopilotWorker, "create", async (d) => { saved = d; return { toObject: () => d }; }]],
    () => createAutopilotWorker({ body: { name: "  Sohith's MacBook Air  " } }, res));
  assert.equal(res.statusCode, 201);
  assert.equal(saved.slug, "sohith-s-macbook-air");
  assert.equal(saved.name, "Sohith's MacBook Air", "the display name keeps its punctuation");
});

test("createAutopilotWorker refuses a name that slugifies to nothing usable", async () => {
  for (const name of ["", "   ", "!!!", "-", "a"]) {
    const res = fakeRes();
    await withStubs([[AutopilotWorker, "create", async () => { throw new Error("must not create " + name); }]],
      () => createAutopilotWorker({ body: { name } }, res));
    assert.equal(res.statusCode, 400, `"${name}" should be rejected`);
  }
});

test("createAutopilotWorker reserves 'admin'", async () => {
  // Admin is the built-in all-clients view; a real profile by that name would
  // shadow it in the chooser.
  for (const name of ["admin", "Admin", "  ADMIN "]) {
    const res = fakeRes();
    await withStubs([[AutopilotWorker, "create", async () => { throw new Error("must not create"); }]],
      () => createAutopilotWorker({ body: { name } }, res));
    assert.equal(res.statusCode, 400, name);
    assert.match(res.body.message, /reserved/i);
  }
});

test("createAutopilotWorker maps a duplicate to 409", async () => {
  const res = fakeRes();
  await withStubs([[AutopilotWorker, "create", async () => { const e = new Error("dup"); e.code = 11000; throw e; }]],
    () => createAutopilotWorker({ body: { name: "Server 1" } }, res));
  assert.equal(res.statusCode, 409);
});

// ── deletion ──────────────────────────────────────────────────────────

test("deleteAutopilotWorker releases that profile's clients", async () => {
  let deletedFilter = null;
  const res = fakeRes();
  await withStubs([
    [AutopilotWorker, "findOne", () => ({ lean: async () => ({ slug: "laptop-2", name: "Laptop 2", lastSeenAt: stale(), running: [] }) })],
    [AutopilotAssignment, "deleteMany", async (f) => { deletedFilter = f; return { deletedCount: 5 }; }],
    [AutopilotWorker, "deleteOne", async () => ({ deletedCount: 1 })]
  ], () => deleteAutopilotWorker({ params: { slug: "laptop-2" } }, res));

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.released, 5, "clients go back to Unassigned, not into limbo");
  assert.deepEqual(deletedFilter, { worker: "laptop-2" });
});

test("deleteAutopilotWorker refuses while that profile is mid-run", async () => {
  const res = fakeRes();
  await withStubs([
    [AutopilotWorker, "findOne", () => ({ lean: async () => ({ slug: "server-1", name: "Server 1", lastSeenAt: fresh(), running: ["a@b.com", "c@d.com"] }) })],
    [AutopilotAssignment, "deleteMany", async () => { throw new Error("must not delete"); }]
  ], () => deleteAutopilotWorker({ params: { slug: "server-1" } }, res));

  assert.equal(res.statusCode, 409);
  assert.match(res.body.message, /running 2 client/i);
});

test("deleteAutopilotWorker ignores a stale running list", async () => {
  // A laptop closed mid-run leaves running[] behind forever; that must not
  // make its profile undeletable.
  const res = fakeRes();
  await withStubs([
    [AutopilotWorker, "findOne", () => ({ lean: async () => ({ slug: "laptop-2", name: "L2", lastSeenAt: stale(), running: ["a@b.com"] }) })],
    [AutopilotAssignment, "deleteMany", async () => ({ deletedCount: 0 })],
    [AutopilotWorker, "deleteOne", async () => ({ deletedCount: 1 })]
  ], () => deleteAutopilotWorker({ params: { slug: "laptop-2" } }, res));
  assert.equal(res.statusCode, 200);
});

// ── assignment ────────────────────────────────────────────────────────

test("setAutopilotAssignments upserts assignments and deletes unassignments", async () => {
  let ops = null;
  const res = fakeRes();
  await withStubs([
    [AutopilotWorker, "find", () => ({ lean: async () => [{ slug: "server-1" }] })],
    [AutopilotAssignment, "bulkWrite", async (o) => { ops = o; return {}; }]
  ], () => setAutopilotAssignments({
    body: {
      assignments: [
        { clientEmail: "A@B.com", worker: "server-1" },
        { clientEmail: "c@d.com", worker: "" },
        { clientEmail: "e@f.com", worker: null }
      ],
      assignedBy: "admin@x.com"
    }
  }, res));

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.assigned, 1);
  assert.equal(res.body.cleared, 2);
  assert.equal(ops[0].updateOne.filter.clientEmail, "a@b.com", "emails are normalised");
  assert.equal(ops[0].updateOne.upsert, true);
  assert.equal(ops[1].deleteOne.filter.clientEmail, "c@d.com");
});

test("setAutopilotAssignments rejects an unknown profile before writing anything", async () => {
  // A typo'd slug would hide those clients from every list at once.
  const res = fakeRes();
  await withStubs([
    [AutopilotWorker, "find", () => ({ lean: async () => [{ slug: "server-1" }] })],
    [AutopilotAssignment, "bulkWrite", async () => { throw new Error("must not write"); }]
  ], () => setAutopilotAssignments({
    body: { assignments: [{ clientEmail: "a@b.com", worker: "typo-machine" }] }
  }, res));

  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /unknown profile\(s\): typo-machine/);
});

test("setAutopilotAssignments rejects an empty or oversized batch", async () => {
  for (const assignments of [undefined, [], "nope"]) {
    const res = fakeRes();
    await setAutopilotAssignments({ body: { assignments } }, res);
    assert.equal(res.statusCode, 400);
  }
  const res = fakeRes();
  await setAutopilotAssignments({
    body: { assignments: Array.from({ length: 1001 }, (_, i) => ({ clientEmail: `c${i}@x.com`, worker: "" })) }
  }, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /at most 1000/);
});

test("setAutopilotAssignments skips rows with no usable email", async () => {
  const res = fakeRes();
  await withStubs([
    [AutopilotWorker, "find", () => ({ lean: async () => [] })],
    [AutopilotAssignment, "bulkWrite", async () => { throw new Error("must not write"); }]
  ], () => setAutopilotAssignments({ body: { assignments: [{ clientEmail: "nope", worker: "" }] } }, res));
  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /no valid client emails/);
});

// ── heartbeat ─────────────────────────────────────────────────────────

test("autopilotWorkerHeartbeat records what the machine is doing", async () => {
  let update = null;
  const res = fakeRes();
  await withStubs([[AutopilotWorker, "findOneAndUpdate", (_f, u) => { update = u; return { lean: async () => ({ slug: "server-1" }) }; }]],
    () => autopilotWorkerHeartbeat({
      params: { slug: "server-1" },
      body: { host: "vmi3557549", running: ["A@B.com", "bad"], queued: ["c@d.com"], lanes: 7, appVersion: "1.2" }
    }, res));

  assert.equal(res.statusCode, 200);
  assert.deepEqual(update.$set.running, ["a@b.com"], "non-emails are dropped, the rest normalised");
  assert.deepEqual(update.$set.queued, ["c@d.com"]);
  assert.equal(update.$set.lanes, 7);
  assert.ok(update.$set.lastSeenAt instanceof Date);
});

test("autopilotWorkerHeartbeat never overwrites the admin's display name", async () => {
  let update = null;
  const res = fakeRes();
  await withStubs([[AutopilotWorker, "findOneAndUpdate", (_f, u) => { update = u; return { lean: async () => ({ slug: "server-1" }) }; }]],
    () => autopilotWorkerHeartbeat({ params: { slug: "server-1" }, body: {} }, res));
  assert.equal(update.$set.name, undefined);
  assert.equal(update.$setOnInsert.name, "server-1", "a name is only set when the row is created");
});

test("autopilotWorkerHeartbeat rejects a malformed profile id", async () => {
  for (const slug of ["", "-bad", "bad-", "UPPER CASE", "a", "x".repeat(60)]) {
    const res = fakeRes();
    await withStubs([[AutopilotWorker, "findOneAndUpdate", () => { throw new Error("must not query"); }]],
      () => autopilotWorkerHeartbeat({ params: { slug }, body: {} }, res));
    assert.equal(res.statusCode, 400, JSON.stringify(slug));
  }
});

test("autopilotWorkerHeartbeat treats a racing upsert as success", async () => {
  const res = fakeRes();
  await withStubs([[AutopilotWorker, "findOneAndUpdate", () => { const e = new Error("dup"); e.code = 11000; throw e; }]],
    () => autopilotWorkerHeartbeat({ params: { slug: "server-1" }, body: {} }, res));
  assert.equal(res.statusCode, 200, "the other beat won; nothing is wrong");
});
