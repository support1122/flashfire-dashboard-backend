// Rules classifier: the three real mails that reached the ops Discord channel
// on 2026-09-10 as "Offer" / "Interview", the ordering that now stops them,
// and the regression set that proves real invites still get through.
//
// Pure module, no network, no Mongo.

import { test } from "node:test";
import assert from "node:assert/strict";

const { classifyMailByRules } = await import("../mailRulesClassifier.js");
const { GENUINE_FIXTURES } = await import("../../src/services/mailRegexLearner.js");

const classify = (from, subject, body) =>
  classifyMailByRules({ from, subject, bodyText: body, snippet: body.slice(0, 120) });

// ── the incident ──────────────────────────────────────────────────────────

test("Reddit jobs digest is a newsletter, not an offer", () => {
  const c = classify(
    "Reddit <noreply@redditmail.com>",
    "13 High-Paying Remote Jobs Open to Beginners ($83,000+) | WFH.team",
    "r/remotework: 13 High-Paying Remote Jobs Open to Beginners. Some companies even extend a job offer after a short call. Unsubscribe."
  );
  assert.equal(c.category, "newsletter");
  assert.equal(c.priority, "low");
});

test("Workday candidate-account reminder is application housekeeping, not an offer", () => {
  const c = classify(
    "Workday <kbr@myworkday.com>",
    "REMINDER: KBR Candidate Account Home Creation",
    "Welcome aboard! To complete your candidate profile, please create your Candidate Home account. This is the next step in your application process. Your offer of employment, if extended, will be visible here."
  );
  assert.equal(c.category, "job-application");
});

test("Bloomberg thank-you-for-applying is an acknowledgement, not an interview", () => {
  const c = classify(
    "Bloomberg Recruiting <blprecruiting@recruiting.bloomberg.com>",
    "Bloomberg- Thank you for your Application (Senior Data Management Professional - 10052626)",
    "Thank you for applying to Bloomberg. We have received your application. If you are selected to move forward, we will contact you about the next step in the process."
  );
  assert.equal(c.category, "job-application");
});

// ── ordering rules ────────────────────────────────────────────────────────

test("job-board senders are job alerts whatever the body says", () => {
  for (const from of ["jobs-noreply@linkedin.com", "alerts@indeed.com", "noreply@jobright.ai", "hello@mail.ziprecruiter.com"]) {
    const c = classify(from, "Interview invitation inside", "We would like to invite you to an interview. Pleased to offer you a role.");
    assert.equal(c.category, "job-alert", from);
  }
});

test("an ack subject loses to a milestone phrase in the same subject", () => {
  const c = classify(
    "talent@acme.com",
    "Thank you for your application - schedule your interview",
    "Please pick a slot for your phone screen."
  );
  assert.equal(c.category, "interview");
  assert.equal(c.priority, "high");
});

test("weak phrases alone in the body do not make a milestone", () => {
  const nextStep = classify("hr@acme.com", "Update on your application", "We will be in touch about the next step. Thanks for your patience.");
  assert.equal(nextStep.category, "job-application");
  const yourOffer = classify("promo@shop.example", "Weekend deals", "Your offer expires tonight. Welcome aboard the savings train.");
  assert.equal(yourOffer.category, "other");
  const assignment = classify("teacher@school.example", "Week 3", "Your assignment is due Friday.");
  assert.equal(assignment.category, "other");
});

test("weak phrases in the SUBJECT still count", () => {
  const c = classify("hr@acme.com", "Next round: onsite with the team", "Details below.");
  assert.equal(c.category, "interview");
  assert.equal(c.priority, "high");
});

test("strong phrase in the body still makes a medium-priority milestone", () => {
  const c = classify("hr@acme.com", "Update on your application", "Good news - we would like to schedule an interview with you this week.");
  assert.equal(c.category, "interview");
  assert.equal(c.priority, "medium");
  const offer = classify("hr@acme.com", "Great news", "We are pleased to extend a formal offer for the Senior Engineer position.");
  assert.equal(offer.category, "offer");
  assert.equal(offer.priority, "medium");
});

test("a rejection still beats everything", () => {
  const c = classify("hr@acme.com", "Your interview with Acme", "Thank you for interviewing. Unfortunately, we have decided to move forward with other candidates.");
  assert.equal(c.category, "rejection");
});

// ── regression: the canonical genuine mails stay positive ─────────────────

test("every GENUINE_FIXTURE still classifies as a milestone", () => {
  for (const f of GENUINE_FIXTURES) {
    const c = classify(f.from, f.subject, f.body);
    assert.ok(["interview", "assessment", "offer"].includes(c.category), `${f.subject} → ${c.category}`);
  }
});

test("ATS no-reply senders are not treated as newsletters when the subject is a real invite", () => {
  const c = classify("no-reply@codility.com", "Grant Street Group invites you to complete a Codility assessment", "The assessment expires in 5 days.");
  assert.equal(c.category, "assessment");
  const cal = classify("notifications@calendly.com", "Interview confirmed: Thursday 2 PM ET", "Your interview with Hooli has been scheduled.");
  assert.equal(cal.category, "interview");
});
