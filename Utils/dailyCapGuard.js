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
import { UserModel } from "../Schema_Models/UserModel.js";
import { ClientTrackingModel, computeAddonBonus } from "../Schema_Models/ClientTrackingModel.js";

export const DEFAULT_DAILY_CAP = 30;

// Lifetime plan cap — TOTAL applications (jobs) allowed per client across all
// time, by their plan. Counts both ops-added and user-added jobs. Once a
// client hits this, NO new jobs can be added under their userID. UserModel
// stores planType case-mixed ("Ignite", "Professional", …); we normalise to
// lowercase before lookup.
export const PLAN_CAPS = {
    prime: 160,
    "free trial": 160, // legacy alias — treat same as prime
    ignite: 250,
    professional: 500,
    executive: 1200,
};

function normalisePlan(p) {
    return String(p || "").trim().toLowerCase();
}

export function planCapFor(planType) {
    return PLAN_CAPS[normalisePlan(planType)] ?? null;
}

// Referral bonus per plan referred. Mirrors /get-referral-stats:
//   Professional referral = +200 applications
//   Executive    referral = +300 applications
// Stored in UserModel.referrals[] (new path) with legacy single-value
// UserModel.referralStatus fallback when the array is empty.
export const REFERRAL_BONUS = {
    Professional: 200,
    Executive: 300,
};

// computeReferralBonus(userDoc) → integer ≥ 0. Sums every entry in
// referrals[] using REFERRAL_BONUS; falls back to a single bonus from the
// legacy referralStatus field when the array is empty. Unknown plan strings
// contribute 0 (never throw).
export function computeReferralBonus(userDoc) {
    if (!userDoc) return 0;
    const arr = Array.isArray(userDoc.referrals) ? userDoc.referrals : [];
    if (arr.length > 0) {
        let sum = 0;
        for (const r of arr) {
            const bonus = REFERRAL_BONUS[r?.plan];
            if (Number.isFinite(bonus)) sum += bonus;
        }
        return sum;
    }
    const legacy = REFERRAL_BONUS[userDoc?.referralStatus];
    return Number.isFinite(legacy) ? legacy : 0;
}

// readPlanCap(email) → { planType, planCap, planLimitOverride, referralBonus,
// referrals, effectiveCap }. `planLimit` on the user doc overrides the plan
// default when set > 0. `referralBonus` from referrals[] (or legacy
// referralStatus) is ADDED ON TOP of whichever base cap applies — so a
// Professional client (500) with one Executive referral (+300) gets 800
// effective. Returns effectiveCap = null only when there's no base cap at all
// (unknown plan AND no override). In that case referrals don't apply either
// — uncapped stays uncapped, don't synthesise a cap from referrals alone.
export async function readPlanCap(rawEmail) {
    const email = String(rawEmail || "").trim().toLowerCase();
    if (!email || !email.includes("@")) {
        const err = new Error("dailyCapGuard.readPlanCap: clientEmail required");
        err.code = "BAD_INPUT";
        throw err;
    }
    // Parallel reads — UserModel for plan/referrals, ClientTrackingModel for
    // addons (lives in a separate collection owned by applications-monitor).
    // Both share the same Mongo URI. Tracking doc may be missing for legacy
    // clients → addonBonus falls back to 0.
    const [user, tracking] = await Promise.all([
        UserModel.findOne(
            { email },
            { planType: 1, planLimit: 1, referrals: 1, referralStatus: 1 },
        ).lean(),
        ClientTrackingModel.findOne({ email }, { addons: 1 }).lean(),
    ]);
    const planType = user?.planType || "";
    const planLimitRaw = Number(user?.planLimit);
    const planLimitOverride = Number.isFinite(planLimitRaw) && planLimitRaw > 0 ? planLimitRaw : null;
    const planDefault = planCapFor(planType);
    const baseCap = planLimitOverride ?? planDefault ?? null;
    const referralBonus = computeReferralBonus(user);
    const referrals = Array.isArray(user?.referrals) ? user.referrals : [];
    const addonBonus = computeAddonBonus(tracking);
    const addons = Array.isArray(tracking?.addons) ? tracking.addons : [];
    // Addons + referrals both stack on top of baseCap. Uncapped (no baseCap)
    // stays uncapped — don't synthesise a cap from bonuses alone.
    const effectiveCap = baseCap == null ? null : baseCap + referralBonus + addonBonus;
    return {
        email,
        planType,
        planLimitOverride,
        planDefault,
        baseCap,
        referralBonus,
        referrals,
        referralCount: referrals.length || (user?.referralStatus ? 1 : 0),
        addonBonus,
        addons,
        addonCount: addons.length,
        effectiveCap,
    };
}

// countTotalJobs(email) → number. ALL non-removed jobs for this client across
// all time and all roles (operations + user). Lifetime cap counts ACTIVE
// applications only — jobs whose currentStatus starts with "deleted" or
// "removed" (case-insensitive, matches UpdateChanges.isRemovalStatus) are
// excluded so a client who removed N jobs gets that headroom back.
export async function countTotalJobs(rawEmail) {
    const email = String(rawEmail || "").trim().toLowerCase();
    if (!email || !email.includes("@")) {
        const err = new Error("dailyCapGuard.countTotalJobs: clientEmail required");
        err.code = "BAD_INPUT";
        throw err;
    }
    return JobModel.countDocuments({
        userID: email,
        $or: [
            { currentStatus: { $exists: false } },
            { currentStatus: null },
            { currentStatus: { $not: /^(deleted|removed)/i } },
        ],
    });
}

// checkPlanCap(email) → { allowed, count, cap, planType, reason?, message?,
// baseCap, referralBonus, referralCount }. Returns allowed:true with cap:null
// when client has no recognisable plan (uncapped, do-no-harm default).
// Throws on DB error so caller can fail-closed.
export async function checkPlanCap(rawEmail) {
    const meta = await readPlanCap(rawEmail);
    const {
        email, planType, effectiveCap, planLimitOverride, baseCap,
        referralBonus, referralCount, addonBonus, addonCount,
    } = meta;
    if (effectiveCap == null) {
        return {
            allowed: true,
            count: null,
            cap: null,
            planType,
            source: "uncapped",
            baseCap: null,
            referralBonus,
            referralCount,
            addonBonus,
            addonCount,
        };
    }
    const count = await countTotalJobs(email);
    const source = planLimitOverride != null ? "override" : "plan";
    // Compose "base X + Y refs + Z addons = total" suffix so ops audit-trail
    // shows every piece of the cap.
    const parts = [`base ${baseCap} from ${planLimitOverride != null ? "override" : planType || "plan"}`];
    if (referralBonus > 0) parts.push(`+${referralBonus} from ${referralCount} referral${referralCount === 1 ? "" : "s"}`);
    if (addonBonus > 0) parts.push(`+${addonBonus} from ${addonCount} addon${addonCount === 1 ? "" : "s"}`);
    const breakdown = parts.length > 1 ? ` (${parts.join(" ")})` : "";
    if (count >= effectiveCap) {
        return {
            allowed: false,
            count,
            cap: effectiveCap,
            planType,
            source,
            baseCap,
            referralBonus,
            referralCount,
            addonBonus,
            addonCount,
            reason: "PLAN_LIMIT_REACHED",
            message: `Plan limit reached: ${count}/${effectiveCap} applications${breakdown} for ${planType || "(no plan)"}. No more jobs can be added under this client. Add an addon/referral, upgrade the plan, or raise planLimit to continue.`,
        };
    }
    return {
        allowed: true,
        count,
        cap: effectiveCap,
        planType,
        source,
        baseCap,
        referralBonus,
        referralCount,
        addonBonus,
        addonCount,
        remaining: effectiveCap - count,
    };
}

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

// enforcePlanCapPostInsert(email, insertedJobId): atomic-ish post-insert
// guard for the lifetime plan cap. Concurrent /addjob + /saveToDashboard
// requests can both pass the pre-check at cap-1 and BOTH insert (race), so
// we re-check total AFTER insert and HARD-DELETE the freshly-created job
// when the total exceeds the effective plan cap. Caller treats deletion as
// "push refused" — same as a pre-check rejection.
//
// Returns:
//   { kept: true,  count, cap }              — within cap
//   { kept: false, count, cap, deleted: id } — rolled back the inserted job
//   { kept: true,  count: null, cap: null }  — uncapped client
//
// Throws on DB error so the caller can convert to 503.
export async function enforcePlanCapPostInsert(rawEmail, insertedJobId) {
    const meta = await readPlanCap(rawEmail);
    if (meta.effectiveCap == null) {
        return { kept: true, count: null, cap: null, planType: meta.planType, baseCap: null, referralBonus: meta.referralBonus, addonBonus: meta.addonBonus };
    }
    const count = await countTotalJobs(meta.email);
    if (count <= meta.effectiveCap) {
        return { kept: true, count, cap: meta.effectiveCap, planType: meta.planType, baseCap: meta.baseCap, referralBonus: meta.referralBonus, addonBonus: meta.addonBonus };
    }
    // Over cap. Delete the job WE just inserted (identified by insertedJobId)
    // — never touch other inserts in the race window, even when they also
    // contributed to the overshoot (their handler will rollback its own).
    let deleted = null;
    if (insertedJobId) {
        try {
            const res = await JobModel.deleteOne({ _id: insertedJobId });
            if (res?.deletedCount > 0) deleted = String(insertedJobId);
        } catch (e) {
            console.warn(`enforcePlanCapPostInsert delete failed for ${insertedJobId}:`, e.message);
        }
    }
    console.warn(JSON.stringify({
        event: "plan.cap.rollback",
        client: meta.email,
        planType: meta.planType,
        cap: meta.effectiveCap,
        actual: count,
        deletedJob: deleted,
        ts: new Date().toISOString(),
    }));
    return {
        kept: false,
        count,
        cap: meta.effectiveCap,
        planType: meta.planType,
        baseCap: meta.baseCap,
        referralBonus: meta.referralBonus,
        addonBonus: meta.addonBonus,
        deleted,
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
