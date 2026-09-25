import mongoose from "mongoose";

/**
 * Reads the "perks withdrawn" flag that clients-tracking writes.
 *
 * Upgrade and Refer n Earn are switched off permanently for a client who has
 * gone inactive and had no job added or applied for 14 days. The rule and the
 * writer live in DASH/clients-tracking (utils/clientPerks.js, plus a daily
 * cron); that backend owns the dashboardtrackings collection and this one only
 * reads it. Both share the same MongoDB URI, so there is no HTTP hop.
 *
 * All this module does is answer "is the flag set?" for one email, so the
 * portal can grey the buttons out and the referral endpoints can refuse.
 *
 * FAILS OPEN. If the lookup throws, the client keeps their buttons. A database
 * hiccup must not silently strip perks from every paying client on the platform;
 * a dormant account keeping a button for one request is by far the cheaper
 * failure. The same reasoning as Utils/clientVisibility.js.
 */

/** The collection clients-tracking really writes client state to. */
const TRACKING_COLLECTION = "dashboardtrackings";

const normEmail = (v) => String(v || "").trim().toLowerCase();

/**
 * Has this client had Upgrade and Refer n Earn permanently withdrawn?
 *
 * @param {string} email
 * @returns {Promise<boolean>}
 */
export async function arePerksDisabled(email) {
     const e = normEmail(email);
     if (!e.includes("@")) return false;

     try {
          const row = await mongoose.connection
               .collection(TRACKING_COLLECTION)
               .findOne({ email: e }, { projection: { perksDisabledAt: 1 } });

          // No tracking record is NOT evidence of dormancy. Plenty of clients
          // predate that collection, and treating a missing row as "disabled"
          // would strip the buttons from people who never qualified.
          return Boolean(row?.perksDisabledAt);
     } catch (err) {
          console.error(`[clientPerks] lookup failed for ${e}, leaving perks enabled: ${err.message}`);
          return false;
     }
}

/**
 * Same question for many clients at once.
 *
 * @param {string[]} emails
 * @returns {Promise<Set<string>>} lowercased emails whose perks are withdrawn
 */
export async function findPerksDisabledEmails(emails) {
     const list = [...new Set((Array.isArray(emails) ? emails : []).map(normEmail))]
          .filter((e) => e.includes("@"));
     if (list.length === 0) return new Set();

     try {
          const rows = await mongoose.connection
               .collection(TRACKING_COLLECTION)
               .find(
                    { email: { $in: list }, perksDisabledAt: { $ne: null } },
                    { projection: { email: 1 } },
               )
               .toArray();
          return new Set(rows.map((r) => normEmail(r.email)));
     } catch (err) {
          console.error(`[clientPerks] bulk lookup failed, leaving perks enabled: ${err.message}`);
          return new Set();
     }
}
