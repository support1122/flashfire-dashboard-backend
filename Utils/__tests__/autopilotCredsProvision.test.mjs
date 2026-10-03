// POST /autopilot/creds/:email/provision — the "JobRight: Yes" toggle's write.
//
// Same stubbing approach as autopilotRuns.test.mjs: the model methods are
// swapped in place so the real controller runs against them.
//
// The expensive mistake this route could make is clobbering a password. Most
// clients use the standard team password, but a client whose JobRight account
// differs has theirs stored here on purpose, and the toggle is something an
// operator can flip twice by accident or a bulk sync can sweep across every
// row. So "fill blanks only, never overwrite" is the property under test, from
// both directions.

import test from "node:test";
import assert from "node:assert/strict";

import { AutopilotCreds } from "../../Schema_Models/AutopilotCreds.js";
import { provisionAutopilotCreds } from "../../Controllers/AutopilotCreds.js";

const DEFAULT_JR_PASSWORD = "Jobhunt@2026";

function fakeRes() {
  const res = { statusCode: null, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

/** Stand-in for the collection: findOne().select().lean() plus updateOne. */
function fakeStore(initial) {
  const state = { doc: initial ? { ...initial } : null, writes: [] };
  const original = { findOne: AutopilotCreds.findOne, updateOne: AutopilotCreds.updateOne };

  AutopilotCreds.findOne = () => ({
    select: () => ({ lean: async () => (state.doc ? { ...state.doc } : null) })
  });
  AutopilotCreds.updateOne = async (filter, update, opts) => {
    state.writes.push({ filter, update, opts });
    const set = update?.$set || {};
    if (!state.doc) {
      if (!opts?.upsert) throw new Error("no doc and no upsert");
      state.doc = { clientEmail: filter.clientEmail, jrEmail: "", jrPassword: "", ...set };
    } else {
      Object.assign(state.doc, set);
    }
    return { acknowledged: true };
  };

  state.restore = () => { AutopilotCreds.findOne = original.findOne; AutopilotCreds.updateOne = original.updateOne; };
  return state;
}

async function provision(initial, body = {}, email = "client@example.com") {
  const store = fakeStore(initial);
  const res = fakeRes();
  try {
    await provisionAutopilotCreds({ params: { email }, body }, res);
  } finally {
    store.restore();
  }
  return { res, store };
}

// ── creating a row from nothing ───────────────────────────────────────

test("a client with no credentials gets the email and the standard password", async () => {
  const { res, store } = await provision(null);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.created, true);
  assert.deepEqual(res.body.filled.sort(), ["jrEmail", "jrPassword"]);
  assert.equal(store.doc.jrEmail, "client@example.com");
  assert.equal(store.doc.jrPassword, DEFAULT_JR_PASSWORD);
  assert.equal(store.writes[0].opts.upsert, true, "must upsert or the first toggle writes nothing");
});

test("the row it creates is enough for the autopilot to log in unattended", async () => {
  // autopilot.py only attempts auto-login when BOTH are set:
  //   if creds.get("jrEmail") and creds.get("jrPassword"):
  const { res } = await provision(null);
  assert.equal(res.body.autoLoginReady, true);
  assert.equal(res.body.hasJrPassword, true);
  assert.equal(res.body.jrEmail, "client@example.com");
});

test("the email is normalised, so a toggle on a capitalised row still matches", async () => {
  const { res, store } = await provision(null, {}, "  Client@Example.COM  ");
  assert.equal(res.body.clientEmail, "client@example.com");
  assert.equal(store.doc.jrEmail, "client@example.com");
});

// ── never clobbering what is already there ────────────────────────────

test("a custom JobRight password survives the toggle", async () => {
  const { res, store } = await provision({
    clientEmail: "client@example.com",
    jrEmail: "client@example.com",
    jrPassword: "TheirOwnPassword!99"
  });
  assert.equal(res.body.created, false);
  assert.deepEqual(res.body.filled, [], "nothing was blank, so nothing should be written");
  assert.equal(store.doc.jrPassword, "TheirOwnPassword!99");
});

test("a JobRight account under a different email survives the toggle", async () => {
  const { store } = await provision({
    clientEmail: "client@example.com",
    jrEmail: "personal.alias@gmail.com",
    jrPassword: DEFAULT_JR_PASSWORD
  });
  assert.equal(store.doc.jrEmail, "personal.alias@gmail.com");
});

test("a half-filled row gets only its missing half", async () => {
  const { res, store } = await provision({
    clientEmail: "client@example.com",
    jrEmail: "",
    jrPassword: "TheirOwnPassword!99"
  });
  assert.deepEqual(res.body.filled, ["jrEmail"]);
  assert.equal(store.doc.jrEmail, "client@example.com");
  assert.equal(store.doc.jrPassword, "TheirOwnPassword!99");
});

test("a whitespace-only stored value counts as blank", async () => {
  const { res, store } = await provision({
    clientEmail: "client@example.com",
    jrEmail: "   ",
    jrPassword: "\t"
  });
  assert.deepEqual(res.body.filled.sort(), ["jrEmail", "jrPassword"]);
  assert.equal(store.doc.jrEmail, "client@example.com");
  assert.equal(store.doc.jrPassword, DEFAULT_JR_PASSWORD);
});

test("calling it twice changes nothing the second time", async () => {
  const first = await provision(null);
  const second = await provision({ ...first.store.doc });
  assert.equal(second.res.body.created, false);
  assert.deepEqual(second.res.body.filled, []);
  assert.equal(second.store.writes.length, 0, "an idempotent no-op must not write at all");
});

// ── panel credentials are left alone on purpose ───────────────────────

test("it never invents the dashboard-panel login", async () => {
  const { store } = await provision(null);
  for (const k of ["extEmail", "extPassword", "extCode"]) {
    assert.equal(store.writes[0].update.$set[k], undefined,
      `${k} is a different account; a guessed value fails at the panel step instead`);
  }
});

test("it never touches the daily cap", async () => {
  // The cap lives on ProfileModel.targetJobCount and is shared with /addjob.
  const { store } = await provision(null);
  for (const k of ["maxJobs", "dailyCap", "targetJobCount"]) {
    assert.equal(store.writes[0].update.$set[k], undefined, `${k} is not this route's business`);
  }
});

// ── bookkeeping and bad input ─────────────────────────────────────────

test("updatedBy is recorded when the caller sends one", async () => {
  const { store } = await provision(null, { updatedBy: "clients-tracking:jobright-toggle" });
  assert.equal(store.doc.updatedBy, "clients-tracking:jobright-toggle");
});

test("updatedBy alone still writes, so an audit trail is never silently dropped", async () => {
  const { store } = await provision(
    { clientEmail: "client@example.com", jrEmail: "client@example.com", jrPassword: DEFAULT_JR_PASSWORD },
    { updatedBy: "admin@flashfirehq" }
  );
  assert.equal(store.writes.length, 1);
  assert.equal(store.doc.updatedBy, "admin@flashfirehq");
});

test("the password is never echoed back to the caller", async () => {
  const { res } = await provision(null);
  assert.equal(JSON.stringify(res.body).includes(DEFAULT_JR_PASSWORD), false,
    "this response crosses a service boundary and can land in a log");
});

test("a bad email is rejected before any write", async () => {
  for (const bad of ["", "   ", "not-an-email", undefined]) {
    const store = fakeStore(null);
    const res = fakeRes();
    try {
      await provisionAutopilotCreds({ params: { email: bad }, body: {} }, res);
    } finally {
      store.restore();
    }
    assert.equal(res.statusCode, 400, `should reject ${JSON.stringify(bad)}`);
    assert.equal(store.writes.length, 0, "a rejected email must not write");
  }
});

test("a database failure is a 500, not a half-done write reported as success", async () => {
  const original = AutopilotCreds.findOne;
  AutopilotCreds.findOne = () => { throw new Error("connection reset"); };
  const res = fakeRes();
  try {
    await provisionAutopilotCreds({ params: { email: "client@example.com" }, body: {} }, res);
  } finally {
    AutopilotCreds.findOne = original;
  }
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.success, false);
});

// ── the JobRight login must be the client's, never an operator's ─────
//
// Found live on 2026-10-03: two clients had jrEmail sohith@flashfirehq.com
// with a hand-typed password. Every run for them signed into the operator's
// JobRight account and scraped his recommendations instead of theirs, and
// nothing anywhere showed it - the row looked fully provisioned.

import { isOperatorEmail } from "../../Controllers/AutopilotCreds.js";

test("a FlashFire address is recognised as an operator's", () => {
  for (const a of ["sohith@flashfirehq.com", "sarah@flashfirehq", "ops@flashfirejobs.com",
                   "SOHITH@FlashFireHQ.com", "  admin@flashfirehq.com  "]) {
    assert.equal(isOperatorEmail(a), true, `should have been refused: ${a}`);
  }
});

test("a client's own address is not", () => {
  for (const a of ["rijuljain17@gmail.com", "manasahegde225@gmail.com",
                   "someone@outlook.com", "a.b@university.edu"]) {
    assert.equal(isOperatorEmail(a), false, `should have been allowed: ${a}`);
  }
});

test("a lookalike domain is not mistaken for ours", () => {
  // Refusing these would block a real client for no reason.
  assert.equal(isOperatorEmail("someone@notflashfirehq.com.evil.com"), false);
  assert.equal(isOperatorEmail("someone@flashfirehq.com.co"), false);
});

test("a subdomain of ours still counts as ours", () => {
  assert.equal(isOperatorEmail("bot@mail.flashfirehq.com"), true);
});

test("blank and malformed input is not treated as an operator address", () => {
  for (const a of ["", null, undefined, "not-an-email", "@", "no-domain@"]) {
    assert.equal(isOperatorEmail(a), false);
  }
});

// ── pressing "Yes" heals a row that has the wrong owner ──────────────
//
// "Fill blanks only" is right for a client's own custom password, and wrong
// for an operator's address: that row is not incomplete, it is pointing at
// the wrong account, and leaving it alone means pressing Yes does nothing
// while the client keeps scraping somebody else's recommendations. Two live
// rows sat like that until 2026-10-03.

test("an operator's address is replaced with the client's own", async () => {
  const { res, store } = await provision({
    clientEmail: "client@example.com",
    jrEmail: "sohith@flashfirehq.com",
    jrPassword: "Ls..U33Ey#2qhDU",
  });
  assert.equal(res.statusCode, 200);
  assert.equal(store.doc.jrEmail, "client@example.com");
  assert.equal(res.body.correctedOwner, true);
  assert.equal(res.body.previousJrEmail, "sohith@flashfirehq.com");
});

test("the password paired with that wrong account is reset too", async () => {
  // Keeping it would swap a wrong-account login for a failed one.
  const { store } = await provision({
    clientEmail: "client@example.com",
    jrEmail: "sohith@flashfirehq.com",
    jrPassword: "Ls..U33Ey#2qhDU",
  });
  assert.equal(store.doc.jrPassword, DEFAULT_JR_PASSWORD);
});

test("a client's own custom password is still never overwritten", async () => {
  // The whole point of "fill blanks only" - this must not regress.
  const { res, store } = await provision({
    clientEmail: "client@example.com",
    jrEmail: "client@example.com",
    jrPassword: "theirOwnPassword123",
  });
  assert.equal(store.doc.jrPassword, "theirOwnPassword123");
  assert.equal(res.body.correctedOwner, false);
  assert.deepEqual(res.body.filled, []);
});

test("a client using a second personal address keeps it", async () => {
  // Only FlashFire domains are wrong. A different gmail is a real choice.
  const { res, store } = await provision({
    clientEmail: "client@example.com",
    jrEmail: "client.alt@gmail.com",
    jrPassword: DEFAULT_JR_PASSWORD,
  });
  assert.equal(store.doc.jrEmail, "client.alt@gmail.com");
  assert.equal(res.body.correctedOwner, false);
});

test("pressing Yes twice on a healed row changes nothing the second time", async () => {
  const { store } = await provision({
    clientEmail: "client@example.com",
    jrEmail: "sohith@flashfirehq.com",
    jrPassword: "whatever",
  });
  const healed = { ...store.doc };
  const again = await provision(healed);
  assert.equal(again.res.body.correctedOwner, false);
  assert.deepEqual(again.res.body.filled, []);
  assert.equal(again.store.doc.jrEmail, "client@example.com");
  assert.equal(again.store.doc.jrPassword, DEFAULT_JR_PASSWORD);
});

test("the corrected row is auto-login ready", async () => {
  const { res } = await provision({
    clientEmail: "client@example.com",
    jrEmail: "ops@flashfirejobs.com",
    jrPassword: "x",
  });
  assert.equal(res.body.autoLoginReady, true);
  assert.equal(res.body.jrEmail, "client@example.com");
  assert.equal(res.body.hasJrPassword, true);
});

test("the response never echoes the password", async () => {
  const { res } = await provision({
    clientEmail: "client@example.com",
    jrEmail: "sohith@flashfirehq.com",
    jrPassword: "Ls..U33Ey#2qhDU",
  });
  const body = JSON.stringify(res.body);
  assert.equal(body.includes("Ls..U33Ey"), false, "the old password must not leak back");
  assert.equal(body.includes(DEFAULT_JR_PASSWORD), false, "nor the new one");
});
