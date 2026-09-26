// Recruiter outreach goes out Monday to Friday.
//
// These mails are cold outreach sent from the CLIENT's own mailbox, under the
// client's name. One arriving on a Saturday is read on Monday at best, and read
// as bulk automation at worst, which is the one impression this product cannot
// afford to give a recruiter.
//
// Four paths can put a mail in a recruiter's inbox: the nightly cron, the
// operator's "run now" button, the operator's bulk compose, and a retry of a
// failed row. All four are gated, and the rule is not forceable - `force`
// exists to re-run a claimed day, not to override the calendar.
//
// Pure functions plus a source check. No Mongo, nothing sent.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const { isRecruiterSendDay, weekdayInTimeZone, weekdayName, weekendSkipReason, RECRUITER_SEND_TIMEZONE } =
  await import("../businessDays.js");

const IST = "Asia/Kolkata";
const ET = "America/New_York";

// 2026-09-21 is a Monday. 17:35 UTC is when the 23:05 IST cron fires.
const at = (day, hhmm = "17:35") => new Date(`2026-09-${String(day).padStart(2, "0")}T${hhmm}:00Z`);

test("the default clock is the one the rest of the service uses", () => {
  // The cron is registered for Asia/Kolkata and lastRunDayKey is an IST day,
  // so an operator reading "skipped: weekend" knows which day that meant.
  assert.equal(RECRUITER_SEND_TIMEZONE, IST);
});

test("weekdays send and weekends do not", () => {
  const expected = [
    [21, "Monday", true],
    [22, "Tuesday", true],
    [23, "Wednesday", true],
    [24, "Thursday", true],
    [25, "Friday", true],
    [26, "Saturday", false],
    [27, "Sunday", false]
  ];
  for (const [day, name, sends] of expected) {
    const d = at(day);
    assert.equal(weekdayName(d), name, `day ${day}`);
    assert.equal(isRecruiterSendDay(d), sends, `${name} should ${sends ? "send" : "skip"}`);
  }
});

test("at cron time the Indian and American weekday agree", () => {
  // 23:05 IST is the same calendar day around midday in the US, which is why
  // judging the day in IST costs nothing in accuracy for every automated batch.
  for (const day of [21, 22, 23, 24, 25, 26, 27]) {
    const d = at(day);
    assert.equal(
      isRecruiterSendDay(d, IST),
      isRecruiterSendDay(d, ET),
      `${weekdayName(d)} disagrees between ${IST} and ${ET} at cron time`
    );
  }
});

test("the timezone is honoured when it actually changes the day", () => {
  // Monday 00:30 IST is still Sunday evening in New York.
  const d = new Date("2026-09-20T19:00:00Z");
  assert.equal(weekdayName(d, IST), "Monday");
  assert.equal(weekdayName(d, ET), "Sunday");
  assert.equal(isRecruiterSendDay(d, IST), true);
  assert.equal(isRecruiterSendDay(d, ET), false, "set RECRUITER_SEND_TIMEZONE to judge the recipient's day");
});

test("a bad time zone fails OPEN, loudly", () => {
  // A typo in the env var must not silently stop every client's outreach for
  // weeks. The warning is the signal; the mail still goes.
  assert.equal(weekdayInTimeZone(at(26), "Not/AZone"), -1);
  assert.equal(isRecruiterSendDay(at(26), "Not/AZone"), true);
});

test("the skip reason names today and when it resumes", () => {
  const sat = weekendSkipReason(at(26));
  assert.match(sat, /Monday to Friday only/);
  assert.match(sat, /Today is Saturday/);
  assert.match(sat, /resumes on Monday/);
  assert.equal(weekendSkipReason(at(23)), "", "a weekday has nothing to explain");
});

// ── every send path is actually gated ─────────────────────────────────────

const router = readFileSync(
  fileURLToPath(new URL("../../Controllers/GmailRouter.js", import.meta.url)),
  "utf8"
);

test("all four recruiter send paths check the day", () => {
  // If this count drops, a new send path was added without the gate.
  const gates = router.match(/if \(!isRecruiterSendDay\(\)\)/g) || [];
  assert.equal(gates.length, 4, `expected 4 gated send paths, found ${gates.length}`);
});

test("the weekend rule sits before the once-per-day claim", () => {
  // Otherwise a weekend run would burn the day key and Monday's real batch
  // would be skipped as already sent.
  const fn = router.slice(router.indexOf("async function processAutomation("));
  const gateAt = fn.indexOf("isRecruiterSendDay()");
  const claimAt = fn.indexOf("lastRunDayKey");
  assert.ok(gateAt > -1 && claimAt > -1);
  assert.ok(gateAt < claimAt, "the day check must come before the day claim");
});

test("force cannot override the weekend", () => {
  const fn = router.slice(router.indexOf("async function processAutomation("));
  const gate = fn.slice(fn.indexOf("if (!isRecruiterSendDay())"), fn.indexOf("isRecruiterSendDay()") + 220);
  assert.equal(/force/.test(gate), false, "the weekend check must not consult force");
});

test("the nightly cron stops before the AI pre-pass on a weekend", () => {
  // The pre-pass costs an AI call per new client; there is nothing to prepare
  // until Monday.
  const job = router.slice(router.indexOf("export async function runRecruiterAutomationDailyJob()"));
  const gateAt = job.indexOf("isRecruiterSendDay()");
  const prePassAt = job.indexOf("runAiTemplatePrePass()");
  assert.ok(gateAt > -1 && prePassAt > -1);
  assert.ok(gateAt < prePassAt, "the day check must come before the pre-pass");
});
