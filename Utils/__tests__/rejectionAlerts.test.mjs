// Rejection detection: find it, verify it, tell ops, never tell the client.
//
// Rejections were already classified and stored, but nothing surfaced them, so
// a client could be turned down and nobody noticed until someone read the
// mailbox by hand. This pins the three properties that make the new path safe:
//
//   1. The rejection rules stay the hard override over every positive category
//      ("thank you for interviewing, but unfortunately..." is not an interview).
//   2. The ops gate is looser than the milestone gate on purpose - a rejection
//      goes to an internal channel, so an unverifiable one is still worth a
//      line, while a verified non-rejection is not.
//   3. A rejection NEVER reaches the client, by any route.
//
// Pure functions and a stubbed webhook. No Mongo, no OpenAI, nothing sent.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

const hits = [];
const srv = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  hits.push(JSON.parse(Buffer.concat(chunks).toString() || "{}"));
  res.writeHead(204);
  res.end();
});
await new Promise((r) => srv.listen(0, "127.0.0.1", r));
process.env.ONE_MAIN_DISCORD_FOR_MAIL_NOTIFICATIONS = `http://127.0.0.1:${srv.address().port}/hook`;
after(() => srv.close());

const { classifyMailByRules, rejectionSignal } = await import("../mailRulesClassifier.js");
const { rejectionGate } = await import("../../src/services/mailMilestoneVerifier.js");
const { notifyRejectionLine } = await import("../discordMailNotify.js");
const { GENUINE_REJECTION_FIXTURES, acceptProposal, LEARNABLE_CATEGORIES } = await import(
  "../../src/services/mailRegexLearner.js"
);
const { NOTIFIABLE_CATEGORIES } = await import("../clientMailTemplates.js");

const classify = (from, subject, body) =>
  classifyMailByRules({ from, subject, bodyText: body, snippet: body.slice(0, 120) });

// ── detection ─────────────────────────────────────────────────────────────

test("every canonical rejection is detected", () => {
  for (const f of GENUINE_REJECTION_FIXTURES) {
    const c = classify(f.from, f.subject, f.body);
    assert.equal(c.category, "rejection", `${f.subject} -> ${c.category}`);
  }
});

test("a rejection still beats interview and offer wording in the same mail", () => {
  const c = classify(
    "talent@acme.com",
    "Your interview with Acme",
    "Thank you for interviewing with us. Unfortunately, we have decided to move forward with other candidates. We are unable to offer you the position."
  );
  assert.equal(c.category, "rejection");
});

test("one weak phrase on its own is not a rejection", () => {
  // Ordinary recruiter English. Silencing on this would eat real invitations.
  const stillOpen = classify(
    "jane@acme.com",
    "Next steps",
    "We have other candidates in the pipeline, but we liked your profile and would like to schedule an interview."
  );
  assert.equal(stillOpen.category, "interview");

  const signoff = classify("friend@example.com", "Good luck", "Best of luck with the new job!");
  assert.notEqual(signoff.category, "rejection");
});

test("two weak phrases together are enough to look at", () => {
  const c = classify(
    "no-reply@acme.com",
    "Your application",
    "We went with other candidates whose background more closely matches the role. We wish you the best."
  );
  assert.equal(c.category, "rejection");
  assert.equal(c.priority, "low", "weak evidence is flagged low, and the AI verifier decides");
});

test("a rejection in the subject line outranks one found only in the body", () => {
  assert.equal(rejectionSignal("We regret to inform you", "").priority, "high");
  assert.equal(rejectionSignal("Your application", "We regret to inform you").priority, "medium");
  assert.equal(rejectionSignal("Hello", "Nothing to see here").hit, false);
});

// ── the ops gate ──────────────────────────────────────────────────────────

test("a confirmed rejection is posted", () => {
  const g = rejectionGate({ ok: true, genuine: true, category: "rejection", confidence: "high", reason: "r" });
  assert.equal(g.eligible, true);
  assert.equal(g.unverified, false);
});

test("an unverifiable rejection is still posted, marked unverified", () => {
  // Looser than milestoneGate on purpose: this line never leaves the team, so
  // a missed real rejection costs more than one extra line to look at.
  const g = rejectionGate({ ok: false, error: "timeout after 20000ms" });
  assert.equal(g.eligible, true);
  assert.equal(g.unverified, true);
  assert.match(g.reason, /verifier_unavailable/);
});

test("a verified non-rejection is not posted", () => {
  const g = rejectionGate({ ok: true, genuine: false, category: "not-rejection", reason: "careers newsletter" });
  assert.equal(g.eligible, false);
  assert.match(g.reason, /verifier_rejected/);
});

test("low confidence still posts", () => {
  const g = rejectionGate({ ok: true, genuine: true, category: "rejection", confidence: "low", reason: "r" });
  assert.equal(g.eligible, true);
});

// ── the Discord line ──────────────────────────────────────────────────────

test("the rejection line is plain, not a celebration", async () => {
  hits.length = 0;
  const r = await notifyRejectionLine({
    clientName: "Asha Rao",
    clientEmail: "asha@example.com",
    subject: "Your application to Acme",
    from: "no-reply@acme.com",
    receivedAt: new Date("2026-09-26T10:00:00Z")
  });
  assert.equal(r.ok, true, r.error);
  const embed = hits[0].embeds[0];
  assert.match(embed.title, /^Rejection - Asha Rao$/);
  assert.match(embed.description, /Asha Rao\*\* was turned down/);
  assert.equal(embed.color, 0x64748b, "muted slate, not the green/purple of a win");
  const flat = JSON.stringify(embed);
  for (const wrong of ["🎉", "🏆", "Interview", "Offer", "congrat"]) {
    assert.equal(flat.includes(wrong), false, `a rejection must not read as ${wrong}`);
  }
  assert.match(flat, /no-reply@acme\.com/, "ops need the sender to find the thread");
});

test("an unverified rejection says so on the line", async () => {
  hits.length = 0;
  await notifyRejectionLine({ clientName: "Asha", subject: "s", from: "f", unverified: true });
  const embed = hits[0].embeds[0];
  assert.match(embed.title, /\(unverified\)/);
  assert.match(embed.footer.text, /AI check unavailable/);
});

// ── the learning loop ─────────────────────────────────────────────────────

test("rejection is a category the regex learner may write rules for", () => {
  assert.equal(LEARNABLE_CATEGORIES.has("rejection"), true);
});

test("a learned rejection exclusion may not eat a real rejection", () => {
  // The whole safety argument for letting an AI write regexes: every proposal
  // is regression-tested against the canonical mails of its own category.
  const greedy = acceptProposal({
    pattern: "unfortunately",
    targetField: "body",
    offendingMail: { subject: "x", from: "y@z.com", body: "unfortunately this newsletter is ending" },
    fixtures: GENUINE_REJECTION_FIXTURES
  });
  assert.equal(greedy.ok, false);
  assert.match(greedy.reason, /matches genuine mail/);

  // A narrow one that only hits the offending mail is accepted.
  const narrow = acceptProposal({
    pattern: "this newsletter is ending",
    targetField: "body",
    offendingMail: { subject: "x", from: "y@z.com", body: "unfortunately this newsletter is ending" },
    fixtures: GENUINE_REJECTION_FIXTURES
  });
  assert.equal(narrow.ok, true, narrow.reason);
});

// ── the guarantee that matters ────────────────────────────────────────────

test("a rejection can never be emailed to the client", async () => {
  // Two independent locks. First, the client templates only know the three
  // positive categories.
  assert.deepEqual(NOTIFIABLE_CATEGORIES, ["interview", "assessment", "offer"]);
  assert.equal(NOTIFIABLE_CATEGORIES.includes("rejection"), false);

  // Second, the poll worker sets clientNotifyEligible false on the rejection
  // branch and never calls the client notifier from it.
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const worker = readFileSync(
    fileURLToPath(new URL("../../src/services/mailPollWorker.js", import.meta.url)),
    "utf8"
  );
  const branch = worker.slice(worker.indexOf('} else if (ai.category === "rejection") {'));
  const endOfBranch = branch.indexOf("const uploadedNames");
  const rejectionBranch = branch.slice(0, endOfBranch > 0 ? endOfBranch : branch.length);
  assert.match(rejectionBranch, /clientNotifyEligible: false/);
  assert.equal(/clientNotifyEligible: true/.test(rejectionBranch), false);
});
