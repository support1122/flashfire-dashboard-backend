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

        const [extAgg, pushedToday, profile] = await Promise.all([
            ExtensionSessionStat.aggregate([
                { $match: { clientEmail: email, endedAt: { $gte: todayStart } } },
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
            JobModel.countDocuments({
                userID: email,
                createdByRole: "operations",
                _id: { $gte: todayLowBound },
            }),
            ProfileModel.findOne({ email }, { targetJobCount: 1 }).lean(),
        ]);

        const a = extAgg[0] || {};
        const otherSkipTotal =
            (a.threshold || 0) + (a.seniorityMismatch || 0) + (a.locationMismatch || 0)
            + (a.authMismatch || 0) + (a.companyBlocked || 0) + (a.otherSkip || 0);

        const rawCap = Number(profile?.targetJobCount);
        const explicitCap = Number.isFinite(rawCap) && rawCap > 0 ? rawCap : null;
        const effectiveCap = explicitCap ?? DEFAULT_DAILY_CAP;

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
        });
    } catch (err) {
        console.error("ExtensionTodayStats error:", err);
        return res.status(500).json({ success: false, error: "INTERNAL", message: err.message });
    }
}
