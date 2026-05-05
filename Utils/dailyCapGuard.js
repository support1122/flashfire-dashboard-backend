// dailyCapGuard: single source of truth for the per-client daily cap on
// operator-pushed jobs. Used by /addjob, /push-history, /summaries-overview,
// and the JR-direct extension's session log so every surface agrees on the
// numbers.
//
// Policy:
//   - Window resets at 00:00 Asia/Kolkata each day (IST is UTC+5:30 fixed,
//     no DST quirks).
//   - Cap = profile.targetJobCount when admin set it; otherwise DEFAULT_CAP.
//   - Cap applies to createdByRole:'operations' jobs only — user-tracked
//     jobs ignore the cap entirely.
//   - Email is normalised to lowercase before every read so case-mismatched
//     profiles (legacy data) don't bypass the cap.
//
// Production-grade pitfalls covered:
//   1. Fail-closed: any DB error inside readCap() bubbles up so the caller
//      can return 503. Old AddJob.js silently swallowed and let the push
//      through — fixed.
//   2. Default-cap fallback: clients without an explicit targetJobCount get
//      DEFAULT_CAP (30/day) so a forgotten admin step can't trigger an
//      unbounded flood.
//   3. Race condition: countDocuments + insert isn't atomic. Two concurrent
//      pushes can both pass the check at cap-1 and both insert. We accept
//      the overshoot (typical N=1-2) and emit `cap.overshoot` log on detect
//      so ops can audit. Hard atomicity would need a transaction every push
//      — too costly for a write-heavy path.
//   4. Email validation: ops pushes without a resolvable client email are
//      rejected up-front (BAD_INPUT) — used to silently bypass the cap.
//   5. Negative or zero targetJobCount → falls through to DEFAULT_CAP rather
//      than disabling the cap, so a typo'd 0 doesn't open the floodgates.

import { JobModel } from "../Schema_Models/JobModel.js";
import { ProfileModel } from "../Schema_Models/ProfileModel.js";

export const DEFAULT_DAILY_CAP = 30;

export function startOfTodayIST() {
    const offsetMs = 5.5 * 60 * 60 * 1000;
    const istNow = new Date(Date.now() + offsetMs);
    istNow.setUTCHours(0, 0, 0, 0);
    return new Date(istNow.getTime() - offsetMs);
}

function todayLowBoundObjectId() {
    const sinceSeconds = Math.floor(startOfTodayIST().getTime() / 1000);
    const hex = sinceSeconds.toString(16).padStart(8, "0") + "0000000000000000";
    return new JobModel.base.Types.ObjectId(hex);
}

// readCap(email) → { effectiveCap, isDefault, explicitCap }. Throws on DB
// error so callers can fail-closed.
export async function readCap(rawEmail) {
    const email = String(rawEmail || "").trim().toLowerCase();
    if (!email || !email.includes("@")) {
        const err = new Error("dailyCapGuard.readCap: clientEmail required");
        err.code = "BAD_INPUT";
        throw err;
    }
    const profile = await ProfileModel.findOne({ email }, { targetJobCount: 1 }).lean();
    const raw = Number(profile?.targetJobCount);
    const explicitCap = Number.isFinite(raw) && raw > 0 ? raw : null;
    return {
        explicitCap,
        effectiveCap: explicitCap ?? DEFAULT_DAILY_CAP,
        isDefault: explicitCap == null,
        email,
    };
}

// countOpsToday(email) → number. Throws on DB error.
export async function countOpsToday(rawEmail) {
    const email = String(rawEmail || "").trim().toLowerCase();
    if (!email || !email.includes("@")) {
        const err = new Error("dailyCapGuard.countOpsToday: clientEmail required");
        err.code = "BAD_INPUT";
        throw err;
    }
    return JobModel.countDocuments({
        userID: email,
        createdByRole: "operations",
        _id: { $gte: todayLowBoundObjectId() },
    });
}

// checkCap(email) → { allowed, count, cap, isDefault, remaining, reason? }.
// Pure read — does NOT mutate. Use this in pre-insert gates. Throws on DB
// error so the caller can convert to 503.
export async function checkCap(rawEmail) {
    const { effectiveCap, isDefault, explicitCap, email } = await readCap(rawEmail);
    const count = await countOpsToday(email);
    const remaining = Math.max(0, effectiveCap - count);
    if (count >= effectiveCap) {
        return {
            allowed: false,
            count,
            cap: effectiveCap,
            explicitCap,
            isDefault,
            remaining: 0,
            reason: "TARGET_REACHED",
            message: isDefault
                ? `Daily target reached (${count}/${effectiveCap} today, default cap). Set a higher target on the dashboard or wait for 00:00 IST reset.`
                : `Daily target reached (${count}/${effectiveCap} today). Raise the target on the dashboard or wait for 00:00 IST reset.`,
        };
    }
    return {
        allowed: true,
        count,
        cap: effectiveCap,
        explicitCap,
        isDefault,
        remaining,
    };
}

// detectOvershoot(email, capInfo): post-insert sanity check. Logs a structured
// warning when concurrent pushes raced past the cap. Idempotent + non-throwing
// — never blocks the response path. Returns the post-insert count for callers
// that want to log it themselves.
export async function detectOvershoot(rawEmail, expectedCap) {
    try {
        const email = String(rawEmail || "").trim().toLowerCase();
        if (!email) return null;
        const count = await countOpsToday(email);
        if (Number.isFinite(expectedCap) && count > expectedCap) {
            console.warn(JSON.stringify({
                event: "cap.overshoot",
                client: email,
                cap: expectedCap,
                actual: count,
                excess: count - expectedCap,
                ts: new Date().toISOString(),
            }));
        }
        return count;
    } catch (err) {
        console.warn("dailyCapGuard.detectOvershoot failed:", err.message);
        return null;
    }
}
