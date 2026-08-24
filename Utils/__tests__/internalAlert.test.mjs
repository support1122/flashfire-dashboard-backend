// The internal-alert routing policy, locked down.
//
// The no-activity alert exists to tell OPERATIONS that a client's account went
// quiet. Delivered to the client instead, the same words read as a confession.
// These tests pin the three layers that keep it internal: the catalogue flag,
// the email-destination resolver, and the template's own labelling.
//
// Pure functions only. No Mongo, no network.

import assert from "node:assert/strict";
import test from "node:test";

const { REMINDER_ITEMS, reminderItemMeta, defaultItemConfig } = await import("../reminderItems.js");
const { resolveInternalAlertEmail } = await import("../../src/services/clientReminderWorker.js");
const { renderReminderEmail } = await import("../reminderTemplates.js");

test("internal alert routing", async (t) => {
  await t.test("inactivity_alert is flagged internal, and is the only internal item", () => {
    assert.equal(reminderItemMeta("inactivity_alert").internal, true);
    // A new internal item must be a deliberate act, not an accident of copy-paste:
    // every internal item bypasses the client's payment email entirely.
    assert.deepEqual(
      REMINDER_ITEMS.filter((i) => i.internal === true).map((i) => i.key),
      ["inactivity_alert"]
    );
  });

  await t.test("its email channel ships OFF by default", () => {
    // Mattermost-first. Email to the team inbox is an opt-in, and email to the
    // client is impossible regardless (the worker routes internal items away
    // from the payment address before any send).
    const d = defaultItemConfig("inactivity_alert");
    assert.equal(d.channels.email, false);
    assert.equal(d.channels.mattermost, true);
    assert.equal(d.enabled, false, "the whole item is off until an operator turns it on");
  });

  await t.test("resolveInternalAlertEmail prefers OPS_ALERT_EMAIL, falls back to SMTP_USER, never invents", () => {
    const saved = { OPS_ALERT_EMAIL: process.env.OPS_ALERT_EMAIL, SMTP_USER: process.env.SMTP_USER };
    try {
      process.env.OPS_ALERT_EMAIL = "alerts@flashfirejobs.com";
      process.env.SMTP_USER = "support@flashfirejobs.com";
      assert.equal(resolveInternalAlertEmail(), "alerts@flashfirejobs.com");

      delete process.env.OPS_ALERT_EMAIL;
      assert.equal(resolveInternalAlertEmail(), "support@flashfirejobs.com");

      // A malformed explicit address falls through to the SMTP account rather
      // than being sent to verbatim.
      process.env.OPS_ALERT_EMAIL = "not-an-address";
      assert.equal(resolveInternalAlertEmail(), "support@flashfirejobs.com");

      delete process.env.OPS_ALERT_EMAIL;
      delete process.env.SMTP_USER;
      assert.equal(resolveInternalAlertEmail(), "", "no address means no send, never a guess");
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });

  await t.test("the rendered mail is unmistakably internal on its face", () => {
    const out = renderReminderEmail({
      kind: "inactivity_alert",
      client: { name: "Rijul Jain", email: "rijuljain17@gmail.com" },
      stats: { addedCount: 0, appliedCount: 0, isEmpty: true },
      lifetime: {},
      period: { label: "19 Aug - 22 Aug 2026" },
      extra: { days: 4 }
    });
    // Belt and braces: even if a routing bug ever delivered it to the wrong
    // inbox, the subject and body say what it is instead of masquerading as a
    // client report.
    assert.ok(out.subject.startsWith("[Internal]"), out.subject);
    assert.ok(out.html.includes("not sent to the client"));
  });
});
