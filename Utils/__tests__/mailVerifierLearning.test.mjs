// The learning loop + staged rollout — POLICY, locked down.
//
// Covers the pure decision functions behind:
//   • learned sender suppression (mailVerifierLearning.decideSuppression)
//   • the single-client rollout gate (clientMailNotifier.rolloutAllows)
//   • the stale-digest guard that stops old milestones flushing when the
//     allowlist is later widened (clientMailNotifier.isTooOldToNotify)
//
// Pure functions only. No Mongo, no network.

import assert from "node:assert/strict";
import test from "node:test";

const { domainOf, decideSuppression, PROTECTED_DOMAINS, SUPPRESS_AFTER_REJECTIONS } = await import(
  "../../src/services/mailVerifierLearning.js"
);
const { rolloutAllows, isTooOldToNotify } = await import("../../src/services/clientMailNotifier.js");

// ── domainOf ─────────────────────────────────────────────────────────

test("domainOf: parses, lowercases, and fails to empty string", () => {
  assert.equal(domainOf("Hello <no-reply@Career-Academy.IO>".match(/<(.+)>/)[1]), "career-academy.io");
  assert.equal(domainOf("plain@bootcamp.io"), "bootcamp.io");
  assert.equal(domainOf("not-an-email"), "");
  assert.equal(domainOf(""), "");
  assert.equal(domainOf(null), "");
  assert.equal(domainOf("trailing@"), "");
});

// ── decideSuppression ────────────────────────────────────────────────

test("suppression: enough rejections + zero genuine → suppress", () => {
  assert.equal(
    decideSuppression({ domain: "spammy-jobs.io", rejectCount: SUPPRESS_AFTER_REJECTIONS, genuineCount: 0 }),
    true
  );
});

test("suppression: below the rejection threshold → never suppress", () => {
  assert.equal(
    decideSuppression({ domain: "spammy-jobs.io", rejectCount: SUPPRESS_AFTER_REJECTIONS - 1, genuineCount: 0 }),
    false
  );
});

test("suppression: ONE genuine milestone ever → never suppress, any reject count", () => {
  assert.equal(decideSuppression({ domain: "spammy-jobs.io", rejectCount: 100, genuineCount: 1 }), false);
});

test("suppression: protected domains are never suppressed", () => {
  for (const domain of ["gmail.com", "greenhouse.io", "codility.com", "calendly.com"]) {
    assert.ok(PROTECTED_DOMAINS.has(domain), `${domain} must be protected`);
    assert.equal(decideSuppression({ domain, rejectCount: 999, genuineCount: 0 }), false);
  }
});

test("suppression: empty domain → never suppress", () => {
  assert.equal(decideSuppression({ domain: "", rejectCount: 999, genuineCount: 0 }), false);
});

// ── rollout gate ─────────────────────────────────────────────────────

// The allowlist was a staged rollout to one client while the AI verifier was
// new. It is empty now, so the gate is open to everyone (2026-09-23). If it is
// ever re-narrowed, restore a test for the identity matching: the address is
// checked against clientEmail, paymentEmail and mailbox, lowercased and
// trimmed, so a client is not gated out over a stray capital.
test("rollout: the gate is open - no client is excluded", () => {
  assert.equal(rolloutAllows({ clientEmail: "rijuljain17@gmail.com" }), true);
  assert.equal(
    rolloutAllows({ clientEmail: "other@client.com", paymentEmail: "pay@client.com", mailbox: "mb@client.com" }),
    true,
    "a client who was never on the list still passes"
  );
  assert.equal(rolloutAllows({}), true, "and so does one we know nothing about");
});

// ── stale-digest guard ───────────────────────────────────────────────

test("staleness: fresh digest sends, 3-day-old digest does not", () => {
  const now = Date.now();
  assert.equal(isTooOldToNotify(new Date(now - 2 * 3600 * 1000), now), false, "2h old → sends");
  assert.equal(isTooOldToNotify(new Date(now - 72 * 3600 * 1000), now), true, "72h old → parked");
});

test("staleness: unknown date never blocks", () => {
  assert.equal(isTooOldToNotify(null), false);
  assert.equal(isTooOldToNotify(undefined), false);
  assert.equal(isTooOldToNotify("not a date"), false);
});
