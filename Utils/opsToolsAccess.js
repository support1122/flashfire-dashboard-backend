/**
 * Client accounts that also get the operator tools (Mail and Operations tabs,
 * Gmail connect) when they sign in through the normal client login.
 *
 * WHY A SERVER-SIDE LIST
 * ----------------------
 * The portal decides what to render from the session, so the decision is made
 * here and carried on `userDetails.opsTools`. Hardcoding an email in the
 * frontend would ship it in the public bundle and need a redeploy to change;
 * this needs only an env var.
 *
 * WHY NOT JUST MAKE THEM AN OPERATOR
 * ----------------------------------
 * The operator role changes far more than two tabs: Logout becomes "Switch
 * Client" (which opens /manage, a client picker this account has no use for),
 * and the session lives in the operations store instead of userAuth. This
 * account stays a client, scoped to its own email, and only gains the tools.
 *
 * NO SECRET KEY. These accounts skip the "flashfire@2025" unlock modals in the
 * portal by design. Add an email here only for someone trusted with that.
 *
 * Set OPS_TOOLS_CLIENT_EMAILS to a comma-separated list to override the default.
 * Setting it to an empty string turns the feature off for everyone.
 */

const DEFAULT_OPS_TOOLS_CLIENT_EMAILS = ["rijuljain17@gmail.com"];

const normEmail = (v) => String(v || "").trim().toLowerCase();

/** The allowlist, read on every call so an env change needs no code change. */
export function opsToolsClientEmails() {
     const raw = process.env.OPS_TOOLS_CLIENT_EMAILS;
     const list = raw === undefined ? DEFAULT_OPS_TOOLS_CLIENT_EMAILS : raw.split(",");
     return new Set(list.map(normEmail).filter((e) => e.includes("@")));
}

/**
 * Does this client account get the operator tools?
 *
 * @param {string} email
 * @returns {boolean}
 */
export function hasOpsTools(email) {
     const e = normEmail(email);
     if (!e) return false;
     return opsToolsClientEmails().has(e);
}
