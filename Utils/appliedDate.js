// Rules for stamping JobModel.appliedDate. Kept out of UpdateChanges.js so they
// can be unit tested without loading Mongo, and so the monitor's apply alert and
// the writer cannot drift apart.
//
// Why this matters: the "N saved, none applied today" alert on Client Job
// Analysis counts appliedDate stamps for the current IST day, and nothing else.
// An apply that is not stamped is invisible to it, and that client is reported
// as idle when they are not.

// Stored statuses carry an attribution suffix ("saved by Sathya", "applied by
// Ops"), so compare on the leading word only.
const startsWithWord = (status, word) =>
  String(status || '').trim().toLowerCase().startsWith(word);

/**
 * True when appliedDate holds nothing usable. The monitor treats null, '' and a
 * lone space as "not stamped" (clientApplyStats.js, the first-apply aggregation),
 * so the writer must too. `!appliedDate` alone left a ' ' in place forever.
 */
export const isBlankAppliedDate = (appliedDate) =>
  appliedDate == null || String(appliedDate).trim() === '';

/**
 * Stamp on the first move INTO an applied column from anything that is not
 * already applied. This used to require the previous status to be "saved", so a
 * card restored from Removed (or with an empty status) straight to Applied went
 * out unstamped. Applied -> Applied (an edit, a re-save) never re-stamps.
 */
export const shouldSetAppliedDate = (currentStatus, newStatus) =>
  startsWithWord(newStatus, 'applied') && !startsWithWord(currentStatus, 'applied');
