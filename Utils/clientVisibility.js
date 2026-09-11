import mongoose from "mongoose";

/**
 * Hides clients an operator has no work to do on from their client picker.
 *
 * When an operator signs in at the dashboard they are handed the list of
 * clients assigned to them and pick one to work. That list was every client
 * ever assigned, so it filled up with accounts that were paused or closed months
 * ago and an operator had to hunt for the handful that are actually live.
 *
 * FILTERED, NEVER UNASSIGNED. Operations.managedUsers is not touched. A client
 * who goes active and unpaused again reappears for the same operator on their
 * next sign-in, with nobody re-assigning anything. Dropping the assignment
 * instead would have meant manual re-assignment after every pause cycle, and a
 * pause set by mistake would have destroyed the pairing for good.
 *
 * WHY THE COLLECTION IS NAMED DIRECTLY
 * ------------------------------------
 * Schema_Models/ClientTrackingModel.js declares `collection: "DashboardTracking"`,
 * and that collection is EMPTY — 0 documents. The live client records are in
 * `dashboardtrackings` (295 documents, all carrying status and isPaused), which
 * is what mongoose produces by default from model("DashboardTracking") and what
 * the applications-monitor backend actually writes.
 *
 * Reaching for the raw collection keeps this fix self-contained. Repointing the
 * shared model would also change what dailyCapGuard sees when it computes addon
 * bonuses, and that deserves its own decision rather than riding along here.
 */

/** The collection the applications-monitor backend really writes client state to. */
const TRACKING_COLLECTION = "dashboardtrackings";

const normEmail = (v) => String(v || "").trim().toLowerCase();

/**
 * Emails of clients that should not appear in an operator's picker.
 *
 * A client is hidden when status is "inactive" OR isPaused is true. Either alone
 * is enough: there is no work to do on a paused client, and none on a closed one.
 *
 * @param {string[]} emails
 * @returns {Promise<Set<string>>} lowercased emails to hide
 */
export async function findHiddenClientEmails(emails) {
     const list = (Array.isArray(emails) ? emails : [])
          .map(normEmail)
          .filter((e) => e.includes("@"));
     if (list.length === 0) return new Set();

     const rows = await mongoose.connection
          .collection(TRACKING_COLLECTION)
          .find(
               { email: { $in: list }, $or: [{ status: /^inactive$/i }, { isPaused: true }] },
               { projection: { email: 1 } }
          )
          .toArray();

     return new Set(rows.map((r) => normEmail(r.email)));
}

/**
 * Drop inactive and paused clients from a populated managedUsers array.
 *
 * Fails OPEN: if the lookup throws, the full list is returned. A database hiccup
 * must not empty an operator's dashboard and leave them unable to work — showing
 * a few stale clients is the far cheaper failure.
 *
 * A client with NO tracking record is kept. Absence of a row is not evidence
 * that someone is inactive, and hiding on a missing row would quietly blank out
 * operators whose clients predate that collection.
 *
 * @param {Array} managedUsers  populated docs carrying at least `email`
 * @param {string} [operatorEmail]  for the log line only
 * @returns {Promise<Array>}
 */
export async function filterVisibleManagedUsers(managedUsers, operatorEmail = "") {
     const all = Array.isArray(managedUsers) ? managedUsers : [];
     if (all.length === 0) return all;

     try {
          const hidden = await findHiddenClientEmails(all.map((u) => u?.email));
          if (hidden.size === 0) return all;

          const visible = all.filter((u) => !hidden.has(normEmail(u?.email)));
          console.log(
               `[clientVisibility] ${operatorEmail || "operator"}: showing ${visible.length} of ` +
               `${all.length} assigned client(s), hid ${all.length - visible.length} inactive/paused`
          );
          return visible;
     } catch (err) {
          console.error(
               `[clientVisibility] lookup failed for ${operatorEmail || "operator"}, ` +
               `showing the full list: ${err.message}`
          );
          return all;
     }
}
