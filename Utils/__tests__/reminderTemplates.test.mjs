// Client reminder templates - the SEND POLICY, locked down.
//
// These tests exist to stop well-meaning edits from re-introducing the things
// we deliberately removed after the first version read like machine output:
// per-job link lists in recurring mail, hype copy, more than one outbound
// link. The policy itself is documented at the top of Utils/reminderTemplates.js;
// if a test here fails, read that block before changing the assertion.
//
// Pure functions only. No Mongo, no network.

import assert from "node:assert/strict";
import test from "node:test";

const { renderReminderEmail, renderReminderMattermost } = await import("../reminderTemplates.js");

const CLIENT = { name: "Rijul Jain", email: "rijuljain17@gmail.com" };

const job = (jobTitle, companyName) => ({
  jobTitle,
  companyName,
  joblink: "https://boards.greenhouse.io/acme/jobs/123",
  at: "2026-08-20T10:00:00+05:30"
});

const STATS = {
  addedCount: 5,
  appliedCount: 12,
  interviewCount: 3,
  offerCount: 1,
  rejectedCount: 2,
  removedCount: 0,
  addedJobs: [job("Staff Engineer", "Figma")],
  appliedJobs: [job("Senior Backend Engineer", "Stripe"), job("Platform Engineer", "Datadog")],
  interviewJobs: [job("Senior Backend Engineer", "Stripe"), job("Platform Engineer", "Datadog")],
  offerJobs: [job("Backend Developer", "Shopify")],
  topCompanies: [
    { name: "Stripe", count: 3 },
    { name: "Datadog", count: 2 }
  ],
  byDay: [
    { date: "2026-08-18", added: 6, applied: 9 },
    { date: "2026-08-19", added: 5, applied: 11 },
    { date: "2026-08-20", added: 6, applied: 13 }
  ],
  isEmpty: false
};

const LIFETIME = {
  totalJobs: 412,
  totalApplied: 337,
  totalInterviews: 14,
  totalOffers: 2,
  planType: "Executive",
  effectiveCap: 1200,
  remaining: 788,
  percentUsed: 34
};

const KINDS = [
  "daily_summary",
  "weekly_report",
  "monthly_report",
  "interview_digest",
  "plan_usage",
  "milestone",
  "inactivity_alert"
];

const render = (kind, over = {}) =>
  renderReminderEmail({
    kind,
    client: CLIENT,
    stats: STATS,
    lifetime: LIFETIME,
    period: { label: "18 Aug - 24 Aug 2026" },
    extra: { threshold: 400, days: 4 },
    ...over
  });

const renderMm = (kind, over = {}) =>
  renderReminderMattermost({
    kind,
    client: CLIENT,
    stats: STATS,
    lifetime: LIFETIME,
    period: { label: "18 Aug - 24 Aug 2026" },
    extra: { threshold: 400, days: 4 },
    ...over
  });

test("reminderTemplates", async (t) => {
  await t.test("every kind renders subject, html and text; unknown kind is null", () => {
    for (const kind of KINDS) {
      const out = render(kind);
      assert.ok(out, `${kind} rendered`);
      assert.ok(out.subject.length > 0, `${kind} has a subject`);
      assert.ok(out.html.includes("<!DOCTYPE html>"), `${kind} html is a document`);
      assert.ok(out.text.trim().length > 0, `${kind} has a text part`);
      const mm = renderMm(kind);
      assert.ok(mm && mm.text.length > 0, `${kind} has a Mattermost message`);
    }
    assert.equal(renderReminderEmail({ kind: "not_a_kind" }), null);
    assert.equal(renderReminderMattermost({ kind: "not_a_kind" }), null);
  });

  await t.test("POLICY: no job links anywhere in client email - one dashboard link only", () => {
    // The stats fixture carries a joblink on every job. None of it may reach
    // the mail: a dead posting behind a link the client clicks is the exact
    // complaint this rework exists to prevent.
    for (const kind of KINDS) {
      const out = render(kind);
      assert.ok(!out.html.includes("greenhouse.io"), `${kind}: job link leaked into html`);
      assert.ok(!out.text.includes("greenhouse.io"), `${kind}: job link leaked into text`);
      const anchors = (out.html.match(/<a\s/g) || []).length;
      if (kind === "inactivity_alert") {
        assert.equal(anchors, 0, "the internal alert links to nothing");
      } else {
        assert.equal(anchors, 1, `${kind}: exactly one link (the dashboard), found ${anchors}`);
        assert.ok(out.html.includes("https://portal.flashfirejobs.com"), `${kind}: the one link is the dashboard`);
      }
    }
  });

  await t.test("POLICY: daily summary is numbers only - no role or company names", () => {
    const out = render("daily_summary");
    for (const needle of ["Stripe", "Datadog", "Figma", "Senior Backend Engineer", "Staff Engineer"]) {
      assert.ok(!out.html.includes(needle), `daily html must not name ${needle}`);
      assert.ok(!out.text.includes(needle), `daily text must not name ${needle}`);
    }
    // The numbers themselves must be there.
    assert.ok(out.html.includes("12"), "applied count present");
    assert.ok(out.html.includes("Applications submitted"), "labelled");
    const mm = renderMm("daily_summary");
    assert.ok(!mm.text.includes("Stripe"), "Mattermost daily is numbers only too");
  });

  await t.test("POLICY: weekly and monthly aggregate companies but never list individual roles", () => {
    for (const kind of ["weekly_report", "monthly_report"]) {
      const out = render(kind);
      assert.ok(out.html.includes("Stripe"), `${kind}: top companies named (aggregate is fine)`);
      assert.ok(!out.html.includes("Senior Backend Engineer"), `${kind}: no per-role rows`);
    }
  });

  await t.test("interview digest names role and company, capped, still linkless", () => {
    const many = {
      ...STATS,
      interviewJobs: Array.from({ length: 30 }, (_, i) => job(`Role ${i}`, `Company ${i}`)),
      offerJobs: []
    };
    const out = render("interview_digest", { stats: many });
    assert.ok(out.html.includes("Role 0"), "cards are named");
    assert.ok(!out.html.includes("Role 29"), "list is capped");
    assert.ok(out.html.includes("more on your dashboard"), "overflow is stated");
    assert.ok(!out.html.includes("greenhouse.io"), "still no job links");
  });

  await t.test("a hostile company or role name is escaped in html and mattermost", () => {
    const hostileTitle = 'Senior Engineer](https://phish.example/login';
    const hostileCompany = '<script>alert(1)</script>"Co';
    const s = { ...STATS, interviewJobs: [job(hostileTitle, hostileCompany)], offerJobs: [] };
    const out = render("interview_digest", { stats: s });
    assert.ok(!out.html.includes("<script>"), "script tag escaped in html");
    assert.ok(out.html.includes("&lt;script&gt;"), "escaped form present");
    const mm = renderMm("interview_digest", { stats: s });
    assert.ok(!mm.text.includes(hostileTitle), "raw payload does not survive markdown");
    assert.ok(mm.text.includes("\\]\\("), "brackets escaped so no link can be forged");
  });

  await t.test("no hype: no emoji, no exclamation marks, no em dashes in client output", () => {
    const EM_DASH = "—";
    // The exclamation check applies to what a reader SEES, so markup is
    // stripped first - "<!DOCTYPE html>" is not hype.
    const visible = (html) => html.replace(/<[^>]*>/g, " ").replace(/&[a-z#0-9]+;/gi, " ");
    for (const kind of KINDS) {
      const out = render(kind);
      const mm = renderMm(kind);
      for (const [what, text] of [["subject", out.subject], ["html", visible(out.html)], ["text", out.text], ["mattermost", mm.text]]) {
        assert.ok(!text.includes(EM_DASH), `${kind} ${what}: em dash`);
        assert.ok(!text.includes("!"), `${kind} ${what}: exclamation mark`);
        assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(text), `${kind} ${what}: emoji`);
      }
    }
  });

  await t.test("every client mail states its reporting window", () => {
    for (const kind of KINDS.filter((k) => k !== "plan_usage" && k !== "milestone")) {
      const out = render(kind);
      assert.ok(
        out.html.includes("18 Aug - 24 Aug 2026") || out.subject.includes("18 Aug - 24 Aug 2026"),
        `${kind}: window label missing`
      );
    }
  });

  await t.test("no internal language reaches a client mail", () => {
    for (const kind of KINDS.filter((k) => k !== "inactivity_alert")) {
      const out = render(kind);
      for (const leak of ["removed by", "deleted by", "queue", "operator", "skip"]) {
        assert.ok(!out.html.toLowerCase().includes(leak), `${kind}: internal term "${leak}"`);
      }
    }
  });

  await t.test("mattermost messages stay under the size ceiling with a huge pipeline", () => {
    const many = {
      ...STATS,
      interviewJobs: Array.from({ length: 300 }, (_, i) => job(`A very long senior staff principal role title number ${i}`, `Company ${i}`)),
      byDay: Array.from({ length: 31 }, (_, i) => ({ date: `2026-07-${String(i + 1).padStart(2, "0")}`, added: 5, applied: 9 }))
    };
    for (const kind of KINDS) {
      const mm = renderMm(kind, { stats: many });
      assert.ok(mm.text.length <= 4000, `${kind}: ${mm.text.length} chars`);
    }
  });

  await t.test("plan usage handles an uncapped client without inventing a cap", () => {
    const out = render("plan_usage", { lifetime: { ...LIFETIME, effectiveCap: null, remaining: null, percentUsed: null } });
    assert.ok(!out.html.includes("Remaining"), "no remaining row without a cap");
    assert.ok(!out.subject.includes("of"), `subject has no denominator: ${out.subject}`);
    assert.ok(out.html.includes("412"), "the count is still there");
  });

  await t.test("thousands are formatted for readability", () => {
    const out = render("plan_usage");
    assert.ok(out.html.includes("1,200"), "cap rendered with separator");
  });
});
