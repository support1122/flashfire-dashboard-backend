// Inbox milestone forwarding - the once-only and opt-in guarantees.
//
// Two bugs this locks down:
//
//   1. DOUBLE POSTING. mailPollWorker posts each milestone to Discord and
//      stamps discordPostedAt. The 5 AM summary in mailClientMonitor used to
//      re-query the same 24h window WITHOUT that filter and post every one of
//      them again, so the same offer mail appeared twice, hours apart.
//
//   2. ONE SHARED "notified" FLAG. Email and Mattermost fail independently. A
//      single stamp would mean a webhook outage blocks the email forever, or a
//      retry re-posts a channel message that already landed.
//
// Pure/structural checks only. No Mongo, no network.

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

test("inbox milestone alerts", async (t) => {
  await t.test("the 5 AM summary only posts milestones the poll never delivered", () => {
    const src = read("../../src/services/mailClientMonitor.js");
    // The catch-up query must be scoped to undelivered digests AND to the
    // verifier's verdict (opsNotifyEligible), never to the rules category on
    // its own - see Utils/__tests__/mailDailySummaryCatchUp.test.mjs for the
    // behavioural version of this check.
    const findLine = src
      .split("\n")
      .find((l) => l.includes("MailDigest.find(") && l.includes("...verifiedMilestone"));
    assert.ok(findLine, "the verified-milestone catch-up query must still exist");
    assert.ok(
      findLine.includes("discordPostedAt: null"),
      "sendDailySummary must filter on discordPostedAt: null"
    );
    assert.match(src, /opsNotifyEligible: true/, "the catch-up must be gated on opsNotifyEligible");
    assert.doesNotMatch(src, /category: \{ \$in/, "the rules category must not gate the catch-up");
    // And it must stamp what it posts, or the catch-up repeats every morning.
    assert.match(
      src,
      /discordPostedAt: new Date\(\)/,
      "a catch-up post must stamp discordPostedAt"
    );
    // The headline count is the whole window, not the catch-up remainder.
    assert.match(src, /usefulMails: usefulInWindow/, "summary must report the full window count");
  });

  await t.test("each channel has its own independent dedupe stamp", () => {
    const schema = read("../../Schema_Models/MailDigest.js");
    for (const field of ["clientNotifiedAt", "clientMattermostAt"]) {
      assert.ok(schema.includes(field), `${field} must exist on the digest`);
    }
    const notifier = read("../../src/services/clientMailNotifier.js");
    // Both flips are conditional on the stamp still being null, so two racing
    // workers cannot both send-and-count.
    assert.match(notifier, /clientNotifiedAt: null\s*\}/, "email flip must be guarded");
    assert.match(notifier, /clientMattermostAt: null\s*\}/, "mattermost flip must be guarded");
    // And the Mattermost half must bail early when already sent.
    assert.match(
      notifier,
      /if \(digestDoc\?\.clientMattermostAt\) return "already"/,
      "mattermost must short-circuit once sent"
    );
  });

  await t.test("forwarding reaches every client, and a read failure fails closed", async () => {
    const notifier = read("../../src/services/clientMailNotifier.js");
    // A config read failure must not be read as consent to mail somebody who
    // may have opted out.
    assert.match(notifier, /return \{ enabled: false, webhookUrl: "" \};/, "must fail closed");
    assert.match(
      notifier,
      /cfg\?\.inboxAlertsOptOut !== true/,
      "the gate is a strict opt-out check, not a truthy read of the legacy flag"
    );
    assert.match(notifier, /inbox_alerts_off/, "an opted-out digest records why it was skipped");

    // The staged rollout is over: no client is excluded by the allowlist.
    const { rolloutAllows } = await import("../../src/services/clientMailNotifier.js");
    for (const who of [
      { clientEmail: "brand-new@client.com" },
      { paymentEmail: "pays@elsewhere.com" },
      { mailbox: "connected@gmail.com" },
      {}
    ]) {
      assert.equal(rolloutAllows(who), true, `${JSON.stringify(who)} must not be gated out`);
    }
  });

  await t.test("a skipped or disabled email never leaks to Mattermost", () => {
    const notifier = read("../../src/services/clientMailNotifier.js");
    // The gates (false positive, stale, allowlist, opt-out) protect the client
    // on BOTH channels, not just the inbox.
    assert.match(
      notifier,
      /if \(email === "disabled" \|\| email === "skipped"\) return \{ email, mattermost: "skipped" \};/,
      "mattermost must be suppressed whenever the email half was gated"
    );
  });

  await t.test("the config default is ON, and only an explicit opt-out is off", async () => {
    const { mergeWithDefaults } = await import("../../Schema_Models/ClientReminderConfig.js");
    assert.equal(mergeWithDefaults(null).inboxAlertsEnabled, true, "a fresh config receives alerts");
    assert.equal(
      mergeWithDefaults({ clientEmail: "a@b.com" }).inboxAlertsEnabled,
      true,
      "a row written before this shipped receives them too"
    );
    // THE migration property: the legacy flag stored false on almost every row
    // that exists, and it meant "nobody opted this client in", not "stop". It
    // must no longer silence anyone.
    assert.equal(
      mergeWithDefaults({ clientEmail: "a@b.com", inboxAlertsEnabled: false }).inboxAlertsEnabled,
      true,
      "the legacy opt-in flag must not read as an opt-out"
    );
    assert.equal(
      mergeWithDefaults({ clientEmail: "a@b.com", inboxAlertsOptOut: true }).inboxAlertsEnabled,
      false,
      "an explicit opt-out is respected"
    );
    for (const bad of ["true", "yes", 1, {}]) {
      assert.equal(
        mergeWithDefaults({ clientEmail: "a@b.com", inboxAlertsOptOut: bad }).inboxAlertsEnabled,
        true,
        `${JSON.stringify(bad)} must not read as an opt-out`
      );
    }
  });

  await t.test("unsubscribing records the opt-out the notifier actually reads", () => {
    const unsub = read("../../Controllers/Unsubscribe.js");
    assert.match(unsub, /set\.inboxAlertsOptOut = true;/, "the link must write the real gate");
    const ops = read("../../Controllers/operations/ClientReminders.js");
    // The operator toggle and the unsubscribe link must write the same field,
    // or one of them silently does nothing.
    assert.match(ops, /set\.inboxAlertsOptOut = inboxAlertsEnabled !== true;/);
    assert.match(ops, /inboxAlertsOptOut: false,/, "a new config row is not born opted out");
  });

  await t.test("the milestone EMAIL escapes scraped subject and sender", async () => {
    // With the interview digest retired, this template is the only client-facing
    // mail that renders text scraped from a real inbox. A recruiter signature or
    // a crafted subject gets no more trust than any other user input.
    const { renderClientMilestoneEmail } = await import("../clientMailTemplates.js");
    const out = renderClientMilestoneEmail({
      client: { name: "Rijul", email: "rijuljain17@gmail.com" },
      digest: {
        category: "offer",
        subject: '<script>alert(1)</script> Offer "signed"',
        from: "<img src=x onerror=alert(1)>",
        summary: "5 < 6 & 7 > 2"
      },
      dashboardUrl: "https://portal.flashfirejobs.com"
    });
    // Assert on real markup, not on substrings: "onerror=alert(1)" appears
    // verbatim inside "&lt;img src=x onerror=alert(1)&gt;" and is inert there,
    // so grepping for it would fail a correctly-escaped template.
    assert.ok(!out.html.includes("<script>"), "script tag must not survive");
    // NOT a blanket "no <img>": this template carries its own logo image. What
    // must never appear is an img the digest smuggled in, i.e. one with an
    // event handler on it.
    assert.ok(!/<img[^>]*onerror/i.test(out.html), "no injected img with an event handler");
    assert.ok(out.html.includes("&lt;script&gt;"), "the subject is escaped");
    assert.ok(out.html.includes("&lt;img src=x onerror=alert(1)&gt;"), "the sender is escaped");
    // 5 < 6 & 7 > 2 must survive as readable text, not be mangled or dropped.
    assert.ok(out.html.includes("5 &lt; 6 &amp; 7 &gt; 2"), "summary escaped, not stripped");
    // The SUBJECT is a mail header, not markup - it is not HTML-escaped there.
    assert.ok(out.subject.includes("<script>"), "subject header stays verbatim");
  });

  await t.test("both channels stamp the same mail with the same IST time", async () => {
    // The email used to format in America/New_York and print "ET" while its own
    // Mattermost message printed IST, so one mail was announced at two
    // different times depending on which the client read first. Every
    // client-facing timestamp in this product is IST.
    const { renderClientMilestoneEmail, renderClientMilestoneMattermost } = await import(
      "../clientMailTemplates.js"
    );
    const digest = {
      category: "offer",
      clientNotifyCategory: "offer",
      subject: "Offer",
      from: "hr@acme.com",
      date: "2026-08-25T15:21:00Z" // 20:51 IST
    };
    const email = renderClientMilestoneEmail({ client: { email: "a@b.com" }, digest });
    const mm = renderClientMilestoneMattermost({ digest });

    assert.ok(email.html.includes("IST"), "email stamps IST");
    assert.ok(!email.html.includes(" ET"), "email must not stamp Eastern time");
    for (const out of [email.html, mm.text]) {
      assert.ok(out.includes("8:51"), `both channels agree on the clock time: ${out.slice(0, 0)}`);
      assert.ok(out.includes("25 Aug"), "both channels agree on the date");
    }
  });

  await t.test("the Mattermost milestone render escapes scraped mail content", async () => {
    const { renderClientMilestoneMattermost } = await import("../clientMailTemplates.js");
    assert.equal(renderClientMilestoneMattermost({ digest: { category: "promo" } }), null, "unknown category");

    const out = renderClientMilestoneMattermost({
      digest: {
        category: "offer",
        subject: "Offer](https://phish.example/login",
        from: "Recruiter <r@acme.com>"
      },
      dashboardUrl: "https://portal.flashfirejobs.com"
    });
    assert.ok(out.text.includes("\\]\\("), "a crafted subject cannot forge a link");
    assert.ok(!out.text.includes("<r@acme.com>"), "angle brackets escaped so nothing autolinks");
    assert.ok(out.text.includes("portal.flashfirejobs.com"), "the one real link survives");
  });
});
