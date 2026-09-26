// When may recruiter outreach go out?
//
// Monday to Friday only. A cold outreach mail landing on a Saturday is read on
// Monday at best, and at worst it is read as automated bulk mail, which is
// exactly the impression this product cannot afford: these are sent from the
// client's own mailbox, under the client's name.
//
// WHICH CLOCK DECIDES THE DAY
//
// Everything else in this service draws its day boundary in IST: the nightly
// recruiter cron is registered for Asia/Kolkata, and the once-per-day guard
// (lastRunDayKey) is an IST calendar day. Using the same clock here keeps the
// logs, the guard and this rule agreeing with each other, so an operator
// reading "skipped: weekend" can tell which day that meant.
//
// It costs almost nothing in accuracy for the case that matters. The cron fires
// at 23:05 IST, which is the same calendar day around midday in the US, so the
// IST weekday and the recipient's weekday are the same day for every automated
// batch. They can differ only for a manual send in the small hours IST, and the
// difference then errs toward sending less.
//
// Set RECRUITER_SEND_TIMEZONE to an IANA zone (America/New_York, say) to judge
// the day where the recruiters actually are instead.

export const RECRUITER_SEND_TIMEZONE =
  String(process.env.RECRUITER_SEND_TIMEZONE || "").trim() || "Asia/Kolkata";

const SHORT_TO_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

const FULL_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * Day of the week in a given time zone. 0 = Sunday ... 6 = Saturday.
 *
 * Intl is the only thing here that knows about daylight saving, so the weekday
 * is read back from a formatted string rather than computed from an offset.
 *
 * @param {Date}   [date]
 * @param {string} [timeZone]
 * @returns {number} 0-6, or -1 when the zone is not one Intl recognises
 */
export function weekdayInTimeZone(date = new Date(), timeZone = RECRUITER_SEND_TIMEZONE) {
  try {
    const short = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(date);
    const idx = SHORT_TO_INDEX[short];
    return Number.isInteger(idx) ? idx : -1;
  } catch {
    return -1;
  }
}

/**
 * May recruiter mail go out right now?
 *
 * FAILS OPEN on a bad time zone. A typo in RECRUITER_SEND_TIMEZONE must not
 * silently stop every client's outreach for weeks with nothing in the logs but
 * a skip; the misconfiguration is loud instead, and the mail still goes.
 *
 * @param {Date}   [date]
 * @param {string} [timeZone]
 * @returns {boolean}
 */
export function isRecruiterSendDay(date = new Date(), timeZone = RECRUITER_SEND_TIMEZONE) {
  const day = weekdayInTimeZone(date, timeZone);
  if (day === -1) {
    console.warn(`[recruiter-send] unknown time zone "${timeZone}" — allowing the send rather than blocking it`);
    return true;
  }
  return day >= 1 && day <= 5;
}

/** The weekday name in the deciding zone, for logs and operator messages. */
export function weekdayName(date = new Date(), timeZone = RECRUITER_SEND_TIMEZONE) {
  const day = weekdayInTimeZone(date, timeZone);
  return day === -1 ? "" : FULL_NAMES[day];
}

/**
 * One sentence an operator can act on, naming the day it is now and the day
 * sending resumes. Empty string when sending is allowed.
 */
export function weekendSkipReason(date = new Date(), timeZone = RECRUITER_SEND_TIMEZONE) {
  if (isRecruiterSendDay(date, timeZone)) return "";
  const today = weekdayName(date, timeZone);
  return `Recruiter emails go out Monday to Friday only. Today is ${today} (${timeZone}), so nothing was sent. It resumes on Monday.`;
}
