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
import { readFileSync } from "node:fs";

import Operations from "../../Schema_Models/Operations.js";
import { UserModel } from "../../Schema_Models/UserModel.js";
import { AutopilotCreds } from "../../Schema_Models/AutopilotCreds.js";
import { ClientTrackingModel } from "../../Schema_Models/ClientTrackingModel.js";
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
async function call({ operator, client = { _id: CLIENT_ID }, creds, teamLead, noTrackingRow }, body) {
  const saved = [
    [Operations, "findOne", Operations.findOne],
    [UserModel, "findOne", UserModel.findOne],
    [AutopilotCreds, "findOne", AutopilotCreds.findOne],
    [ClientTrackingModel, "findOne", ClientTrackingModel.findOne],
  ];
  const lean = (v) => ({ select: () => ({ lean: async () => v }) });
  Operations.findOne = () => lean(operator);
  UserModel.findOne = () => lean(client);
  AutopilotCreds.findOne = () => lean(creds);
  // Default to this operator owning the client, so the tests written before the
  // team-lead gate keep asserting what they were written to assert.
  ClientTrackingModel.findOne = () =>
    lean(noTrackingRow ? null : { dashboardTeamLeadName: teamLead !== undefined ? teamLead : operator?.name });
  const res = fakeRes();
  try {
    await JrCredsStatus({ body }, res);
  } finally {
    for (const [m, k, v] of saved) m[k] = v;
  }
  return res;
}

const OPERATOR = { email: "sarah@flashfirehq", name: "Sarah", role: "operations", managedUsers: [CLIENT_ID] };
const ADMIN = { email: "admin@flashfirehq", name: "Priya", role: "admin", managedUsers: [] };
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

// ── only this client's dashboard manager is prompted ──────────────────
//
// Per bsc: the prompt belongs to the team lead who would actually go and
// create the account. An operator who merely works the client should not be
// nagged about something they are not responsible for - a prompt everyone sees
// is a prompt everyone learns to dismiss.

test("the client's own dashboard manager is prompted", async () => {
  const res = await call(
    { operator: OPERATOR, creds: null, teamLead: "Sarah" },
    { operatorEmail: "sarah@flashfirehq", clientEmail: "client@example.com" },
  );
  assert.equal(res.body.needsSetup, true);
});

test("an operator who is not the dashboard manager sees nothing", async () => {
  const res = await call(
    { operator: { ...OPERATOR, email: "arjun@flashfirehq", name: "Arjun" }, creds: null, teamLead: "Sonali" },
    { operatorEmail: "arjun@flashfirehq", clientEmail: "client@example.com" },
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.needsSetup, false);
  assert.equal(res.body.reason, "not-this-client-dashboard-manager");
  assert.equal(res.body.suggestedPassword, undefined, "no prompt means no password");
});

test("the team lead name is matched loosely enough for hand-typed data", async () => {
  // Every one of these is a real shape the field takes, or one bsc has seen:
  // "Sarah " with a trailing space sits on 47 clients, and the value sometimes
  // runs together with something else, as in "sarahali".
  for (const lead of ["Sarah", "Sarah ", "  sarah  ", "SARAH", "sarahali", "Sarah K."]) {
    const res = await call(
      { operator: OPERATOR, creds: null, teamLead: lead },
      { operatorEmail: "sarah@flashfirehq", clientEmail: "client@example.com" },
    );
    assert.equal(res.body.needsSetup, true, `should match ${JSON.stringify(lead)}`);
  }
});

test("Sonali's clients reach Sonali", async () => {
  const SONALI = { email: "sonali@flashfirehq", name: "Sonali", role: "operations", managedUsers: [CLIENT_ID] };
  for (const lead of ["Sonali", "sonali", "Sonali ", "Sonaliii"]) {
    const res = await call(
      { operator: SONALI, creds: null, teamLead: lead },
      { operatorEmail: "sonali@flashfirehq", clientEmail: "client@example.com" },
    );
    assert.equal(res.body.needsSetup, true, `should match ${JSON.stringify(lead)}`);
  }
});

test("loose matching does not blur two different operators together", async () => {
  // The whole risk of prefix matching. Sarah/Sathya and Sonali/Sohith share a
  // first letter or two; showing one manager another's client would be worse
  // than showing nothing.
  const pairs = [
    [{ email: "sarah@flashfirehq", name: "Sarah" }, "Sathya"],
    [{ email: "sonali@flashfirehq", name: "Sonali" }, "Sohith"],
    [{ email: "sonali@flashfirehq", name: "Sonali" }, "Sarah"],
    [{ email: "srikumaran@flashfirehq", name: "srikumaran" }, "sushmitha"],
  ];
  for (const [who, lead] of pairs) {
    const res = await call(
      { operator: { ...OPERATOR, ...who }, creds: null, teamLead: lead },
      { operatorEmail: who.email, clientEmail: "client@example.com" },
    );
    assert.equal(res.body.needsSetup, false, `${who.name} must not match ${lead}`);
    assert.equal(res.body.reason, "not-this-client-dashboard-manager");
  }
});

test("a one or two letter lead name matches nobody", async () => {
  // Too little to be confident. Showing the prompt to nobody beats showing it
  // to the wrong manager.
  for (const lead of ["S", "So", ".", "  x  "]) {
    const res = await call(
      { operator: OPERATOR, creds: null, teamLead: lead },
      { operatorEmail: "sarah@flashfirehq", clientEmail: "client@example.com" },
    );
    assert.equal(res.body.needsSetup, false, `${JSON.stringify(lead)} must not match`);
  }
});

test("every operator on the roster is distinct under the matching rule", async () => {
  // Guards the prefix length. If someone is hired whose name collides with an
  // existing operator's first five letters, this fails here rather than
  // silently routing one manager's prompts to another.
  const ROSTER = ["Arjun", "Shubhangi", "Rachna", "Pragyapal", "Rajdeep", "Sarah", "Jyoti",
                  "Sonali", "Sohith", "Sathya", "Aditjain", "sushmitha", "srikumaran", "asif"];
  // Lifted from the controller by brace matching so it cannot drift from the
  // rule that actually ships.
  const src = readFileSync(new URL("../../Controllers/operations/JrCredsStatus.js", import.meta.url), "utf8");
  const from = src.indexOf("const NAME_MATCH_CHARS");
  const at = src.indexOf("function sameName(", from);
  let depth = 0, started = false, end = -1;
  for (let i = src.indexOf("{", at); i < src.length; i += 1) {
    if (src[i] === "{") { depth += 1; started = true; }
    else if (src[i] === "}") { depth -= 1; if (started && depth === 0) { end = i; break; } }
  }
  assert.ok(from >= 0 && end > 0, "could not lift the matcher out of the controller");
  const fn = new Function(`${src.slice(from, end + 1)}; return sameName;`)();
  for (let i = 0; i < ROSTER.length; i += 1) {
    assert.ok(fn(ROSTER[i], ROSTER[i]), `${ROSTER[i]} must match itself`);
    for (let j = i + 1; j < ROSTER.length; j += 1) {
      assert.equal(fn(ROSTER[i], ROSTER[j]), false, `${ROSTER[i]} must not match ${ROSTER[j]}`);
    }
  }
});

test("case does not hide the prompt either", async () => {
  // Live data: the Operations collection has "sushmitha" in lowercase.
  const res = await call(
    { operator: { ...OPERATOR, email: "sushmitha@flashfirehq", name: "sushmitha" }, creds: null, teamLead: "Sushmitha" },
    { operatorEmail: "sushmitha@flashfirehq", clientEmail: "client@example.com" },
  );
  assert.equal(res.body.needsSetup, true);
});

test("a full name matches on the first name", async () => {
  const res = await call(
    { operator: { ...OPERATOR, name: "Sarah Khan" }, creds: null, teamLead: "Sarah" },
    { operatorEmail: "sarah@flashfirehq", clientEmail: "client@example.com" },
  );
  assert.equal(res.body.needsSetup, true);
});

test("a client with no dashboard manager prompts nobody, and says so", async () => {
  for (const lead of ["", "   ", null, undefined]) {
    const res = await call(
      { operator: OPERATOR, creds: null, teamLead: lead === undefined ? "" : lead },
      { operatorEmail: "sarah@flashfirehq", clientEmail: "client@example.com" },
    );
    assert.equal(res.body.needsSetup, false, `lead ${JSON.stringify(lead)}`);
    assert.equal(res.body.reason, "no-dashboard-manager-assigned");
  }
});

test("a missing DashboardTracking row is treated as no manager, not as a match", async () => {
  const res = await call(
    { operator: OPERATOR, creds: null, noTrackingRow: true },
    { operatorEmail: "sarah@flashfirehq", clientEmail: "client@example.com" },
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.needsSetup, false);
  assert.equal(res.body.reason, "no-dashboard-manager-assigned");
});

test("an admin is prompted for any client, whoever the manager is", async () => {
  const res = await call(
    { operator: ADMIN, creds: null, teamLead: "Sonali" },
    { operatorEmail: "admin@flashfirehq", clientEmail: "client@example.com" },
  );
  assert.equal(res.body.needsSetup, true, "admins chase this when a manager has not");
});
