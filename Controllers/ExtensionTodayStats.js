// GET /extension/today-stats?clientEmail=<email>
// Output: { success, today: { captures, linkedinSkipped, judged, picks,
//                              pushedExt, roleMismatch, otherSkip, sessions },
//                pushed: <ops jobs added to client today, server-truth>,
//                cap: <effective cap>,
//                remaining: <cap - pushed> }
//
// Powers the JR-direct extension's "Today" tile. captures + linkedinSkipped
// + skip breakdown come from ExtensionSessionStat (extension reports on
// stop/flush). pushed comes from JobModel (server-truth — what actually
// landed in the client's tracker today). The two can diverge if a session
// is still running (extension hasn't reported yet) or if pushes happened
// from another operator/extension instance.

import { ExtensionSessionStat } from "../Schema_Models/ExtensionSessionStat.js";
import { JobModel } from "../Schema_Models/JobModel.js";
import { ProfileModel } from "../Schema_Models/ProfileModel.js";
import { startOfTodayIST, DEFAULT_DAILY_CAP } from "../Utils/dailyCapGuard.js";

export default async function ExtensionTodayStats(req, res) {
    try {
        const email = String(req.query.clientEmail || "").trim().toLowerCase();
        if (!email || !email.includes("@")) {
            return res.status(400).json({ success: false, error: "BAD_INPUT", message: "clientEmail required" });
        }
        const todayStart = startOfTodayIST();
        const todaySeconds = Math.floor(todayStart.getTime() / 1000);
        const ObjectId = JobModel.base.Types.ObjectId;
        const todayLowBound = new ObjectId(todaySeconds.toString(16).padStart(8, "0") + "0000000000000000");

        const [extAgg, extByOp, pushedToday, pushedTodayByCode, pushedTodayByName, profile] = await Promise.all([
            // Client-wide ext-session totals.
            ExtensionSessionStat.aggregate([
                { $match: { clientEmail: email, $or: [
    { endedAt: { $gte: todayStart } },
    { startedAt: { $gte: todayStart } },
    { updatedAt: { $gte: todayStart } },
] } },
                {
                    $group: {
                        _id: null,
                        captures: { $sum: "$captures" },
                        linkedinSkipped: { $sum: "$linkedinSkipped" },
                        judged: { $sum: "$judged" },
                        picks: { $sum: "$picks" },
                        pushedExt: { $sum: "$pushed" },
                        roleMismatch: { $sum: { $ifNull: ["$skipsRollup.roleMismatch", 0] } },
                        seniorityMismatch: { $sum: { $ifNull: ["$skipsRollup.seniorityMismatch", 0] } },
                        locationMismatch: { $sum: { $ifNull: ["$skipsRollup.locationMismatch", 0] } },
                        authMismatch: { $sum: { $ifNull: ["$skipsRollup.authMismatch", 0] } },
                        threshold: { $sum: { $ifNull: ["$skipsRollup.threshold", 0] } },
                        companyBlocked: { $sum: { $ifNull: ["$skipsRollup.companyBlocked", 0] } },
                        otherSkip: { $sum: { $ifNull: ["$skipsRollup.other", 0] } },
                        sessions: { $sum: 1 },
                    },
                },
            ]),
            // Per-operator ext-session totals (group by extensionCode + name).
            ExtensionSessionStat.aggregate([
                { $match: { clientEmail: email, $or: [
    { endedAt: { $gte: todayStart } },
    { startedAt: { $gte: todayStart } },
    { updatedAt: { $gte: todayStart } },
] } },
                {
                    $group: {
                        _id: {
                            code: { $ifNull: ["$extensionCode", ""] },
                            name: { $ifNull: ["$operatorName", "(unknown)"] },
                        },
                        captures: { $sum: "$captures" },
                        linkedinSkipped: { $sum: "$linkedinSkipped" },
                        pushedExt: { $sum: "$pushed" },
                        sessions: { $sum: 1 },
                        lastSessionAt: { $max: "$endedAt" },
                    },
                },
            ]),
            JobModel.countDocuments({
                userID: email,
                createdByRole: "operations",
                _id: { $gte: todayLowBound },
            }),
            // Server-truth pushed today, grouped by extensionCode (set by AddJob
            // when extension sends it + by saveToDashboard).
            JobModel.aggregate([
                { $match: { userID: email, createdByRole: "operations", _id: { $gte: todayLowBound } } },
                { $group: { _id: { $ifNull: ["$extensionCode", ""] }, count: { $sum: 1 } } },
            ]),
            // Fallback: group by operatorName for jobs missing extensionCode.
            JobModel.aggregate([
                { $match: { userID: email, createdByRole: "operations", _id: { $gte: todayLowBound } } },
                { $group: { _id: { $ifNull: ["$operatorName", "(unknown)"] }, count: { $sum: 1 } } },
            ]),
            ProfileModel.findOne({ email }, { targetJobCount: 1 }).lean(),
        ]);

        const a = extAgg[0] || {};
        const otherSkipTotal =
            (a.threshold || 0) + (a.seniorityMismatch || 0) + (a.locationMismatch || 0)
            + (a.authMismatch || 0) + (a.companyBlocked || 0) + (a.otherSkip || 0);

        const rawCap = Number(profile?.targetJobCount);
        const explicitCap = Number.isFinite(rawCap) && rawCap > 0 ? rawCap : null;
        const effectiveCap = explicitCap ?? DEFAULT_DAILY_CAP;

        // Per-operator union: merge ext-session aggregation with JobModel
        // pushed-today grouped by extensionCode and (fallback) operatorName.
        // Key on extensionCode when present, fall back to operatorName so
        // pre-v1.15 sessions still surface a row.
        const byCode = new Map();   // code → row
        const byName = new Map();   // operatorName → row (for code-less)
        const upsert = (key, fields) => {
            const map = key.code ? byCode : byName;
            const k = key.code || key.name;
            const cur = map.get(k) || {
                extensionCode: key.code || "",
                operatorName: key.name || "(unknown)",
                captures: 0, linkedinSkipped: 0, pushed: 0,
                pushedExt: 0, sessions: 0, lastSessionAt: null,
            };
            Object.assign(cur, {
                captures:        (cur.captures || 0)        + (fields.captures || 0),
                linkedinSkipped: (cur.linkedinSkipped || 0) + (fields.linkedinSkipped || 0),
                pushed:          (cur.pushed || 0)          + (fields.pushed || 0),
                pushedExt:       (cur.pushedExt || 0)       + (fields.pushedExt || 0),
                sessions:        (cur.sessions || 0)        + (fields.sessions || 0),
            });
            if (fields.lastSessionAt && (!cur.lastSessionAt || fields.lastSessionAt > cur.lastSessionAt)) {
                cur.lastSessionAt = fields.lastSessionAt;
            }
            if (key.name && cur.operatorName === "(unknown)") cur.operatorName = key.name;
            map.set(k, cur);
        };
        for (const r of extByOp) {
            upsert({ code: r._id?.code || "", name: r._id?.name || "(unknown)" }, {
                captures: r.captures, linkedinSkipped: r.linkedinSkipped,
                pushedExt: r.pushedExt, sessions: r.sessions, lastSessionAt: r.lastSessionAt,
            });
        }
        for (const r of pushedTodayByCode) {
            const code = r._id || "";
            if (!code) continue; // empty code rows roll into operatorName fallback
            upsert({ code, name: "" }, { pushed: r.count });
        }
        // Fallback: jobs missing extensionCode → key by operatorName.
        for (const r of pushedTodayByName) {
            const name = r._id || "(unknown)";
            // Skip names already attributed to a code (avoid double-count).
            const knownInCode = [...byCode.values()].some((row) => row.operatorName === name);
            if (knownInCode) continue;
            upsert({ code: "", name }, { pushed: r.count });
        }
        const operators = [...byCode.values(), ...byName.values()].sort((a, b) => {
            return (b.pushed + b.captures) - (a.pushed + a.captures);
        });

        return res.json({
            success: true,
            today: {
                captures: a.captures || 0,
                linkedinSkipped: a.linkedinSkipped || 0,
                judged: a.judged || 0,
                picks: a.picks || 0,
                pushedExt: a.pushedExt || 0,
                roleMismatch: a.roleMismatch || 0,
                otherSkip: otherSkipTotal,
                sessions: a.sessions || 0,
            },
            pushed: pushedToday,
            cap: effectiveCap,
            isDefaultCap: explicitCap == null,
            remaining: Math.max(0, effectiveCap - pushedToday),
            operators,
        });
    } catch (err) {
        console.error("ExtensionTodayStats error:", err);
        return res.status(500).json({ success: false, error: "INTERNAL", message: err.message });
    }
}
