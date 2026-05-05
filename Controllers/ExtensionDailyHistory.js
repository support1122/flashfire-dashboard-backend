// GET /extension/daily-history?clientEmail=<email>&days=<n>
// Output: { success, days: [{ date, captures, linkedinSkipped, picks, pushed,
//                              roleMismatch, otherSkip, sessions }] }
//
// Per-day rollup (Asia/Kolkata buckets) of every metric we track for a
// single client. Powers the "Day-by-day performance" card on the AI
// Summaries admin page so an operator can see what each day looked like
// for a client over the last N days.
//
// Sources combined:
//   • ExtensionSessionStat   — captures, linkedinSkipped, picks, role-miss
//   • JobModel (server-truth) — pushed (count of createdByRole:'operations'
//                                jobs created on each day)

import { ExtensionSessionStat } from "../Schema_Models/ExtensionSessionStat.js";
import { JobModel } from "../Schema_Models/JobModel.js";

const TZ = "Asia/Kolkata";
const MAX_DAYS = 90;

export default async function ExtensionDailyHistory(req, res) {
    try {
        const email = String(req.query.clientEmail || "").trim().toLowerCase();
        if (!email || !email.includes("@")) {
            return res.status(400).json({ success: false, error: "BAD_INPUT", message: "clientEmail required" });
        }
        const requested = parseInt(req.query.days, 10);
        const days = Math.min(Math.max(Number.isFinite(requested) ? requested : 14, 1), MAX_DAYS);
        const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        const ObjectId = JobModel.base.Types.ObjectId;
        const cutoffSeconds = Math.floor(cutoff.getTime() / 1000);
        const cutoffOid = new ObjectId(cutoffSeconds.toString(16).padStart(8, "0") + "0000000000000000");

        // Two parallel aggregations — bucketed in IST so days line up with
        // the cap window in /addjob and the operator's wall clock.
        const [extByDay, jobsByDay] = await Promise.all([
            ExtensionSessionStat.aggregate([
                { $match: { clientEmail: email, endedAt: { $gte: cutoff } } },
                {
                    $group: {
                        _id: { $dateToString: { format: "%Y-%m-%d", date: "$endedAt", timezone: TZ } },
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
                        otherSkipExtra: { $sum: { $ifNull: ["$skipsRollup.other", 0] } },
                        sessions: { $sum: 1 },
                    },
                },
            ]),
            JobModel.aggregate([
                { $match: { userID: email, createdByRole: "operations", _id: { $gte: cutoffOid } } },
                {
                    $group: {
                        _id: { $dateToString: { format: "%Y-%m-%d", date: { $toDate: "$_id" }, timezone: TZ } },
                        pushed: { $sum: 1 },
                    },
                },
            ]),
        ]);

        // Densify the window: every day in [today - days, today] gets a row,
        // even when there's no activity. Lets the UI render a clean strip.
        const extMap = new Map();
        for (const r of extByDay) extMap.set(r._id, r);
        const jobMap = new Map();
        for (const r of jobsByDay) jobMap.set(r._id, r.pushed);

        // Compute IST day strings going back from today.
        function istDateString(d) {
            const ist = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
            return ist.toISOString().slice(0, 10);
        }
        const today = new Date();
        const out = [];
        for (let i = 0; i < days; i += 1) {
            const d = new Date(today.getTime() - i * 24 * 60 * 60 * 1000);
            const date = istDateString(d);
            const ext = extMap.get(date) || {};
            const otherSkip =
                (ext.threshold || 0) + (ext.seniorityMismatch || 0) + (ext.locationMismatch || 0)
                + (ext.authMismatch || 0) + (ext.companyBlocked || 0) + (ext.otherSkipExtra || 0);
            out.push({
                date,
                captures:        ext.captures || 0,
                linkedinSkipped: ext.linkedinSkipped || 0,
                judged:          ext.judged || 0,
                picks:           ext.picks || 0,
                pushed:          jobMap.get(date) || 0,
                pushedExt:       ext.pushedExt || 0,
                roleMismatch:    ext.roleMismatch || 0,
                otherSkip,
                sessions:        ext.sessions || 0,
            });
        }

        return res.json({ success: true, days: out, requested: days });
    } catch (err) {
        console.error("ExtensionDailyHistory error:", err);
        return res.status(500).json({ success: false, error: "INTERNAL", message: err.message });
    }
}
