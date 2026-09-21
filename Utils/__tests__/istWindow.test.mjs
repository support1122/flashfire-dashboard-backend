// The report window: "days=N" means N IST CALENDAR days, today included.
//
// Every windowed report in the portal used to do this:
//
//     const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
//
// which is a rolling window. Two things went wrong with it, both visible to
// the team:
//
//   1. "Today" was "the last 24 hours". At 18:00 IST it started at 18:00
//      yesterday, so the Auto Extension tab still counted half of yesterday's
//      runs as today's and never reset at midnight. That is the reported bug.
//   2. The three per-day reports group with $dateToString in Asia/Kolkata but
//      cut off on a rolling boundary, so days=7 at 18:00 returned EIGHT
//      buckets, the oldest covering six hours. A half day is indistinguishable
//      from a bad day on a bar chart.
//
// These tests pin the boundary at 00:00 IST. Times below are written as the
// UTC instant with the IST reading in the comment, because that is how the
// data is stored and how the mistake hides.

import test from "node:test";
import assert from "node:assert/strict";

import {
  startOfCalendarDayIST,
  endOfCalendarDayIST,
  startOfIstDayWindow,
  istDayKey,
  istDayKeysAsc,
  parseDaysParam,
  istWindowLabel,
  istParts,
  toDate
} from "../istWindow.js";

import { AutopilotRun } from "../../Schema_Models/AutopilotRun.js";
import { getAutopilotRunsSummary } from "../../Controllers/AutopilotRuns.js";

const IST_MIDNIGHT_18TH = "2026-09-17T18:30:00.000Z"; // 00:00 IST on the 18th

test("startOfIstDayWindow(1) is midnight IST this morning, not 24h ago", () => {
  // 18:00 IST on 2026-09-18. A rolling window would start at 12:30Z the day
  // before, i.e. 18:00 IST on the 17th.
  const now = new Date("2026-09-18T12:30:00.000Z");
  assert.equal(startOfIstDayWindow(1, now).toISOString(), IST_MIDNIGHT_18TH);
});

test("the window is stable all day and moves exactly at midnight IST", () => {
  const sameDay = [
    "2026-09-17T18:30:00.000Z", // 00:00 IST, the instant it opens
    "2026-09-17T18:30:00.001Z", // one ms in
    "2026-09-18T06:00:00.000Z", // 11:30 IST
    "2026-09-18T18:29:59.999Z"  // 23:59:59.999 IST, the last instant
  ];
  for (const at of sameDay) {
    assert.equal(
      startOfIstDayWindow(1, new Date(at)).toISOString(),
      IST_MIDNIGHT_18TH,
      `${at} is still the 18th in IST`
    );
  }
  // One millisecond later it is the 19th and the window has rolled.
  assert.equal(
    startOfIstDayWindow(1, new Date("2026-09-18T18:30:00.000Z")).toISOString(),
    "2026-09-18T18:30:00.000Z"
  );
});

test("a run at 23:50 IST and one at 00:10 IST land on different days", () => {
  const late = new Date("2026-09-18T18:20:00.000Z");  // 23:50 IST on the 18th
  const early = new Date("2026-09-18T18:40:00.000Z"); // 00:10 IST on the 19th
  assert.equal(istDayKey(late), "2026-09-18");
  assert.equal(istDayKey(early), "2026-09-19");
  // The late run is outside the window that the early run opens.
  assert.ok(late < startOfIstDayWindow(1, early), "23:50 IST is yesterday once it is 00:10");
});

test("days=N returns exactly N buckets, none of them partial", () => {
  const now = new Date("2026-09-18T12:30:00.000Z"); // 18:00 IST
  for (const n of [1, 7, 30, 90]) {
    const keys = istDayKeysAsc(n, now);
    assert.equal(keys.length, n, `days=${n} must cover ${n} calendar days`);
    assert.equal(keys.at(-1), "2026-09-18", "today is always the last bucket");
    assert.equal(
      startOfIstDayWindow(n, now).toISOString(),
      startOfCalendarDayIST(new Date(`${keys[0]}T12:00:00.000Z`)).toISOString(),
      "the window opens at midnight IST on the oldest bucket"
    );
  }
  assert.deepEqual(istDayKeysAsc(3, now), ["2026-09-16", "2026-09-17", "2026-09-18"]);
});

test("the window survives a month and a year boundary", () => {
  const firstOfMonth = new Date("2026-09-30T20:00:00.000Z"); // 01:30 IST on Oct 1
  assert.equal(istDayKey(firstOfMonth), "2026-10-01");
  assert.deepEqual(istDayKeysAsc(3, firstOfMonth), ["2026-09-29", "2026-09-30", "2026-10-01"]);

  const newYear = new Date("2025-12-31T20:00:00.000Z"); // 01:30 IST on Jan 1 2026
  assert.equal(istDayKey(newYear), "2026-01-01");
  assert.deepEqual(istDayKeysAsc(2, newYear), ["2025-12-31", "2026-01-01"]);
});

test("start and end of an IST day are exactly one day apart, minus a ms", () => {
  const now = new Date("2026-09-18T12:30:00.000Z");
  const start = startOfCalendarDayIST(now);
  const end = endOfCalendarDayIST(now);
  assert.equal(end.getTime() - start.getTime(), 24 * 60 * 60 * 1000 - 1);
  assert.equal(istParts(start).hour, 0);
  assert.equal(istParts(start).minute, 0);
  assert.equal(istParts(end).hour, 23);
});

test("parseDaysParam falls back rather than clamping bad input to one day", () => {
  // days=-5 clamped to 1 renders as "there is no data", which reads like an
  // outage instead of like a typo.
  for (const bad of ["0", "-5", "abc", "", "  ", undefined, null, Number.NaN]) {
    assert.equal(parseDaysParam(bad, { fallback: 30, max: 365 }), 30, `bad input: ${bad}`);
  }
  assert.equal(parseDaysParam("1"), 1);
  assert.equal(parseDaysParam("7"), 7);
  assert.equal(parseDaysParam("9999", { max: 90 }), 90);
  // parseInt semantics, unchanged from the code this replaced: it reads the
  // leading integer and stops. "2.9" is 2 days and "1.9e400" is 1 day, which
  // is the same answer every one of these controllers already gave.
  assert.equal(parseDaysParam("2.9"), 2);
  assert.equal(parseDaysParam("1.9e400"), 1);
});

test("toDate rejects junk instead of letting NaN reach Mongo", () => {
  assert.equal(toDate("not a date"), null);
  assert.equal(toDate(Number.NaN), null);
  assert.equal(toDate(new Date("nope")), null);
  assert.equal(toDate(undefined), null);
  assert.ok(toDate("2026-09-18T00:00:00Z") instanceof Date);
});

test("istWindowLabel says where today starts", () => {
  assert.match(istWindowLabel(1), /today \(since 00:00 IST\)/);
  assert.match(istWindowLabel(7), /last 7 days/);
});

// ── the controller actually uses it ───────────────────────────────────

async function captureMatch(query) {
  const original = AutopilotRun.aggregate;
  let pipeline = null;
  AutopilotRun.aggregate = async (p) => {
    pipeline = p;
    return [];
  };
  const res = { statusCode: null, body: null };
  res.status = (c) => ((res.statusCode = c), res);
  res.json = (b) => ((res.body = b), res);
  try {
    await getAutopilotRunsSummary({ query }, res);
  } finally {
    AutopilotRun.aggregate = original;
  }
  return { match: pipeline.find((s) => s.$match)?.$match, body: res.body };
}

test("getAutopilotRunsSummary matches from midnight IST, not 24h back", async () => {
  const { match, body } = await captureMatch({ days: "1" });
  const since = match.finishedAt.$gte;
  assert.ok(since instanceof Date);
  assert.equal(
    since.getTime(),
    startOfCalendarDayIST(new Date()).getTime(),
    "Today must start at 00:00 IST"
  );
  assert.equal(body.days, 1);
  assert.equal(body.windowStart, since.toISOString());
  assert.equal(body.timezone, "Asia/Kolkata");
  assert.match(body.windowLabel, /today/);
});

test("getAutopilotRunsSummary excludes rows dated in the future", async () => {
  // A clock-skewed autopilot host posting finishedAt in the future would
  // otherwise pin itself to the top of every window forever, because the
  // group sorts on finishedAt descending.
  const { match } = await captureMatch({ days: "7" });
  assert.ok(match.finishedAt.$lte instanceof Date, "the window must be bounded at both ends");
  assert.ok(match.finishedAt.$lte.getTime() <= Date.now() + 1000);
  assert.ok(match.finishedAt.$gte < match.finishedAt.$lte);
});

test("a 7-day window covers 7 calendar days for the controller too", async () => {
  const { match, body } = await captureMatch({ days: "7" });
  assert.equal(body.days, 7);
  assert.equal(
    match.finishedAt.$gte.getTime(),
    startOfIstDayWindow(7).getTime()
  );
  assert.equal(istDayKeysAsc(7).length, 7);
});
