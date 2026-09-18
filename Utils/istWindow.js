// istWindow: one definition of "the last N days" for every windowed report.
//
// The portal's Today / 7 days / 30 days / 90 days buttons all send `days=N`,
// and every controller that received it computed the same thing:
//
//     const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
//
// That is a ROLLING window, not a calendar one, and it is wrong in two ways
// the team could see:
//
//   1. "Today" meant "the last 24 hours". At 18:00 IST it started at 18:00
//      YESTERDAY, so half of yesterday's runs were counted as today's and the
//      figure never reset at midnight. This is the bug that was reported.
//   2. Every other window produced a stub bucket. The three per-day reports
//      group with `$dateToString(timezone: "Asia/Kolkata")` but cut off on a
//      rolling boundary, so `days=7` at 18:00 returned EIGHT buckets and the
//      oldest covered six hours. The chart showed a short bar that looked
//      like a bad day and was really a partial one.
//
// So `days=N` now means the last N IST calendar days INCLUDING today:
//
//     days=1  → today, from 00:00 IST
//     days=7  → today plus the previous 6 full days
//
// IST is a fixed UTC+05:30 and India has never observed DST, so the boundary
// is plain arithmetic - no Intl round-trip, no DST edge case. Asia/Kolkata is
// already the house timezone for the daily cap, the per-day buckets and the
// operator's wall clock, so the window now agrees with all of them.

export const IST_OFFSET_MS = 330 * 60 * 1000;
export const DAY_MS = 24 * 60 * 60 * 1000;

/** Coerce anything date-ish to a valid Date, or null. Accepts Date, epoch ms,
 *  and ISO strings; rejects Invalid Date rather than letting NaN propagate
 *  into an ObjectId or a day key. */
export function toDate(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value);
  if (typeof value === "string" && value.trim()) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/**
 * Calendar fields of `date` as seen in IST.
 * @returns {{year:number,month:number,day:number,hour:number,minute:number,weekday:number}}
 *   month is 1-12, weekday is 0=Sunday..6=Saturday.
 */
export function istParts(date = new Date()) {
  const d = toDate(date) || new Date();
  // Shift into a pseudo-UTC frame where the UTC accessors read out IST fields.
  const shifted = new Date(d.getTime() + IST_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    weekday: shifted.getUTCDay()
  };
}

/** UTC instant of 00:00:00.000 IST on the IST calendar day containing `date`. */
export function startOfCalendarDayIST(date = new Date()) {
  const { year, month, day } = istParts(date);
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0) - IST_OFFSET_MS);
}

/** UTC instant of 23:59:59.999 IST on the IST calendar day containing `date`. */
export function endOfCalendarDayIST(date = new Date()) {
  const { year, month, day } = istParts(date);
  return new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999) - IST_OFFSET_MS);
}

export function pad2(n) {
  return String(n).padStart(2, "0");
}

/** "YYYY-MM-DD" for the IST calendar day containing `date`. */
export function istDayKey(date = new Date()) {
  const { year, month, day } = istParts(date);
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/**
 * Parse a `days=` query parameter into a whole number of calendar days.
 *
 * A non-integer, zero or negative value falls back to `fallback` rather than
 * being clamped to 1: `days=-5` clamped to a one-day window renders as "there
 * is no data", which reads like an outage instead of like bad input.
 */
export function parseDaysParam(raw, { fallback = 30, max = 365 } = {}) {
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 1) return fallback;
  return Math.min(n, max);
}

/**
 * Start of the window covering the last `days` IST calendar days, today
 * included. `days=1` is 00:00 IST this morning.
 *
 * Returns a UTC Date, which is what Mongo stores and compares against.
 */
export function startOfIstDayWindow(days, now = new Date()) {
  const n = Number.isInteger(days) && days > 0 ? days : 1;
  const today = startOfCalendarDayIST(now);
  return new Date(today.getTime() - (n - 1) * DAY_MS);
}

/**
 * The IST day keys the window covers, oldest first: ["2026-09-12", …, today].
 *
 * Per-day reports use this to zero-fill. Without it a day with no activity is
 * simply absent from the aggregation, and the chart closes the gap - which
 * reads as "we worked every day" instead of "nothing happened on Sunday".
 */
export function istDayKeysAsc(days, now = new Date()) {
  const n = Number.isInteger(days) && days > 0 ? days : 1;
  const start = startOfIstDayWindow(n, now);
  const keys = [];
  for (let i = 0; i < n; i += 1) keys.push(istDayKey(new Date(start.getTime() + i * DAY_MS)));
  return keys;
}

/**
 * Human label for the window, for the UI and for log lines.
 * "today (since 00:00 IST)" / "the last 7 days (IST), today included".
 */
export function istWindowLabel(days) {
  const n = Number.isInteger(days) && days > 0 ? days : 1;
  return n === 1
    ? "today (since 00:00 IST)"
    : `the last ${n} days (IST), today included`;
}
