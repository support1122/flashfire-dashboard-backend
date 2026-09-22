// POST /operations/jr-creds-status — the gate behind the "JobRight login not
// set" prompt.
//
// The requirement is that a CLIENT must never see this prompt. The operator
// session in the dashboard lives in a zustand store persisted to localStorage,
// so `role === "operations"` is something the person at the keyboard can type
// into their own devtools. That makes the browser the wrong place to enforce
// it, and makes these assertions the real control:
//
//   • the prompt renders off this response, so a denied caller has nothing to
//     render, whatever their localStorage says
//   • the password is in the response, never in the bundle, so it cannot be
//     read out of the shipped JavaScript either
//
// Both directions are tested: a client must be refused, and a real operator
// must not be locked out of their own client.

import test from "node:test";
import assert from "node:assert/strict";

import Operations from "../../Schema_Models/Operations.js";
import { UserModel } from "../../Schema_Models/UserModel.js";
import { AutopilotCreds } from "../../Schema_Models/AutopilotCreds.js";
import JrCredsStatus from "../../Controllers/operations/JrCredsStatus.js";

function fakeRes() {
  const res = { statusCode: null, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

const CLIENT_ID = "6512aaaaaaaaaaaaaaaaaaaa";
const OTHER_ID = "6512bbbbbbbbbbbbbbbbbbbb";

/** Swap the three model lookups for fixed answers. */
async function call({ operator, client = { _id: CLIENT_ID }, creds }, body) {
  const saved = [
    [Operations, "findOne", Operations.findOne],
    [UserModel, "findOne", UserModel.findOne],
    [AutopilotCreds, "findOne", AutopilotCreds.findOne],
  ];
  const lean = (v) => ({ select: () => ({ lean: async () => v }) });
  Operations.findOne = () => lean(operator);
  UserModel.findOne = () => lean(client);
  AutopilotCreds.findOne = () => lean(creds);
  const res = fakeRes();
  try {
    await JrCredsStatus({ body }, res);
  } finally {
    for (const [m, k, v] of saved) m[k] = v;
  }
  return res;
}

const OPERATOR = { email: "sarah@flashfirehq", role: "operations", managedUsers: [CLIENT_ID] };
const ADMIN = { email: "admin@flashfirehq", role: "admin", managedUsers: [] };
const SET_UP = { jrEmail: "client@example.com", jrPassword: "Jobhunt@2026" };

// ── a client must never get a payload ─────────────────────────────────

test("a client asking on their own behalf is refused", async () => {
  // Exactly what a client would send after editing `role` in localStorage:
  // their own address in both fields.
  const res = await call(
    { operator: null },
    { operatorEmail: "client@example.com", clientEmail: "client@example.com" },
  );
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.success, false);
  assert.equal(res.body.needsSetup, undefined, "a refusal must carry no state to render");
});

test("a refusal never leaks the password", async () => {
  const res = await call({ operator: null }, { operatorEmail: "x@y.com", clientEmail: "c@d.com" });
  assert.equal(JSON.stringify(res.body).includes("Jobhunt"), false);
});

test("a real operator cannot read a client who is not theirs", async () => {
  const res = await call(
    { operator: { ...OPERATOR, managedUsers: [OTHER_ID] } },
    { operatorEmail: "sarah@flashfirehq", clientEmail: "someone.elses@example.com" },
  );
  assert.equal(res.statusCode, 403);
});

test("an unknown operator and an unmanaged client give the SAME refusal", async () => {
  // A response that distinguishes them lets someone enumerate which operator
  // owns which client.
  const unknown = await call({ operator: null }, { operatorEmail: "a@flashfirehq", clientEmail: "c@d.com" });
  const unmanaged = await call(
    { operator: { ...OPERATOR, managedUsers: [OTHER_ID] } },
    { operatorEmail: "sarah@flashfirehq", clientEmail: "c@d.com" },
  );
  assert.equal(unknown.statusCode, unmanaged.statusCode);
  assert.deepEqual(unknown.body, unmanaged.body);
});

test("a client that does not exist is refused, not reported on", async () => {
  const res = await call(
    { operator: OPERATOR, client: null },
    { operatorEmail: "sarah@flashfirehq", clientEmail: "nobody@example.com" },
  );
  assert.equal(res.statusCode, 403);
});

test("missing fields are rejected before any lookup", async () => {
  for (const body of [{}, { operatorEmail: "sarah@flashfirehq" }, { clientEmail: "c@d.com" }, { operatorEmail: "x", clientEmail: "y" }]) {
    const res = await call({ operator: OPERATOR }, body);
    assert.equal(res.statusCode, 400, `should reject ${JSON.stringify(body)}`);
  }
});

// ── an operator must be able to do their job ──────────────────────────

test("an operator with no credentials on file is told to set them up", async () => {
  const res = await call(
    { operator: OPERATOR, creds: null },
    { operatorEmail: "sarah@flashfirehq", clientEmail: "client@example.com" },
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.needsSetup, true);
  assert.equal(res.body.suggestedEmail, "client@example.com");
  assert.equal(res.body.suggestedPassword, "Jobhunt@2026");
  assert.equal(res.body.jobrightUrl, "https://jobright.ai/login");
});

test("an admin reaches any client without being on the managed list", async () => {
  const res = await call(
    { operator: ADMIN, creds: null },
    { operatorEmail: "admin@flashfirehq", clientEmail: "client@example.com" },
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.needsSetup, true);
});

test("a fully set-up client produces no prompt and no password", async () => {
  const res = await call(
    { operator: OPERATOR, creds: SET_UP },
    { operatorEmail: "sarah@flashfirehq", clientEmail: "client@example.com" },
  );
  assert.equal(res.body.needsSetup, false);
  assert.equal(res.body.suggestedPassword, undefined,
    "nothing to set up means nothing to send");
  assert.equal(JSON.stringify(res.body).includes("Jobhunt"), false);
});

// ── a half-filled row is not "set up" ─────────────────────────────────

test("a row with a password but no email still needs setup", async () => {
  // autopilot.py only auto-logs-in when BOTH are present. Reporting on the
  // row's existence alone would say "fine" while every run fails at login.
  const res = await call(
    { operator: OPERATOR, creds: { jrEmail: "", jrPassword: "Jobhunt@2026" } },
    { operatorEmail: "sarah@flashfirehq", clientEmail: "client@example.com" },
  );
  assert.equal(res.body.needsSetup, true);
  assert.equal(res.body.hasPassword, true);
  assert.equal(res.body.hasEmail, false, "the prompt can say which half is missing");
});

test("a row with an email but no password still needs setup", async () => {
  const res = await call(
    { operator: OPERATOR, creds: { jrEmail: "client@example.com", jrPassword: "" } },
    { operatorEmail: "sarah@flashfirehq", clientEmail: "client@example.com" },
  );
  assert.equal(res.body.needsSetup, true);
  assert.equal(res.body.hasEmail, true);
  assert.equal(res.body.hasPassword, false);
});

test("whitespace does not count as a saved credential", async () => {
  const res = await call(
    { operator: OPERATOR, creds: { jrEmail: "   ", jrPassword: "\t" } },
    { operatorEmail: "sarah@flashfirehq", clientEmail: "client@example.com" },
  );
  assert.equal(res.body.needsSetup, true);
});

// ── plumbing ──────────────────────────────────────────────────────────

test("emails are normalised, so case never causes a false refusal", async () => {
  const res = await call(
    { operator: OPERATOR, creds: SET_UP },
    { operatorEmail: "  Sarah@FlashfireHQ  ", clientEmail: "  Client@Example.COM " },
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.clientEmail, "client@example.com");
});

test("a database failure is a 500, not an accidental prompt", async () => {
  const original = Operations.findOne;
  Operations.findOne = () => { throw new Error("connection reset"); };
  const res = fakeRes();
  try {
    await JrCredsStatus({ body: { operatorEmail: "s@flashfirehq", clientEmail: "c@d.com" } }, res);
  } finally {
    Operations.findOne = original;
  }
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.needsSetup, undefined);
});
