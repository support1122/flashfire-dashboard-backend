// GET /admin/operator-activity?days=N
// Output:
//   {
//     success: true,
//     days: N,
//     rows: [{
//       extensionCode, operatorName, operatorEmail,
//       date,                        // YYYY-MM-DD in Asia/Kolkata
//       captures, linkedinSkipped, judged, picks, pushed,
//       duplicates, blocked, errors,
//       roleMismatch, seniorityMismatch, locationMismatch,
//       authMismatch, threshold, companyBlocked, otherSkip,
//       sessions, lastSessionAt
//     }]
//   }
//
// Aggregates ExtensionSessionStat into per-code per-day rows so the admin
// can see exactly who did what each day. The per-day bucket is computed in
// IST so it matches the daily cap window in AddJob.js.

import { ExtensionSessionStat } from "../Schema_Models/ExtensionSessionStat.js";
import { parseDaysParam, startOfIstDayWindow, istWindowLabel } from "../Utils/istWindow.js";

const TZ = "Asia/Kolkata";

export default async function OperatorActivity(req, res) {
    try {
        // days=N is N IST CALENDAR days, today included - not a rolling N*24h.
        // The per-day buckets below are already grouped in Asia/Kolkata, so a
        // rolling cutoff produced one extra, partial bucket at the old end of
        // the window: days=7 at 18:00 IST returned EIGHT rows and the oldest
        // covered six hours. That short bar read as a bad day rather than a
        // half day. Anchoring the cutoff to 00:00 IST makes the count of
        // buckets equal the count of days asked for.
        const days = parseDaysParam(req.query.days, { fallback: 7, max: 90 });
        const cutoff = startOfIstDayWindow(days);

        const rows = await ExtensionSessionStat.aggregate([
            { $match: { endedAt: { $gte: cutoff } } },
            {
                $group: {
                    _id: {
                        code: { $ifNull: ["$extensionCode", ""] },
                        operator: "$operatorName",
                        email: { $ifNull: ["$operatorEmail", ""] },
                        date: {
                            $dateToString: {
                                format: "%Y-%m-%d",
                                date: "$endedAt",
                                timezone: TZ,
                            },
                        },
                    },
                    captures:          { $sum: "$captures" },
                    linkedinSkipped:   { $sum: "$linkedinSkipped" },
                    judged:            { $sum: "$judged" },
                    picks:             { $sum: "$picks" },
                    pushed:            { $sum: "$pushed" },
                    duplicates:        { $sum: "$duplicates" },
                    blocked:           { $sum: "$blocked" },
                    errors:            { $sum: "$errors" },
                    roleMismatch:      { $sum: { $ifNull: ["$skipsRollup.roleMismatch", 0] } },
                    seniorityMismatch: { $sum: { $ifNull: ["$skipsRollup.seniorityMismatch", 0] } },
                    locationMismatch:  { $sum: { $ifNull: ["$skipsRollup.locationMismatch", 0] } },
                    authMismatch:      { $sum: { $ifNull: ["$skipsRollup.authMismatch", 0] } },
                    threshold:         { $sum: { $ifNull: ["$skipsRollup.threshold", 0] } },
                    companyBlocked:    { $sum: { $ifNull: ["$skipsRollup.companyBlocked", 0] } },
                    // "other" here means "no column of its own in this view".
                    // cardScore, intern and disciplineMismatch have none, and the
                    // extension already subtracts them from its own `other`, so they
                    // are added back here - otherwise these totals silently lose them.
                    otherSkip: { $sum: { $add: [{ $ifNull: ["$skipsRollup.other", 0] }, { $ifNull: ["$skipsRollup.cardScore", 0] }, { $ifNull: ["$skipsRollup.intern", 0] }, { $ifNull: ["$skipsRollup.disciplineMismatch", 0] } ] } },
                    sessions:          { $sum: 1 },
                    lastSessionAt:     { $max: "$endedAt" },
                    // Distinct clients this code worked that day — drives the
                    // "Avg" column (jobs pushed / clients served).
                    clientsSet:        { $addToSet: "$clientEmail" },
                },
            },
            {
                $project: {
                    _id: 0,
                    extensionCode: "$_id.code",
                    operatorName:  "$_id.operator",
                    operatorEmail: "$_id.email",
                    date:          "$_id.date",
                    captures: 1, linkedinSkipped: 1, judged: 1, picks: 1, pushed: 1,
                    duplicates: 1, blocked: 1, errors: 1,
                    roleMismatch: 1, seniorityMismatch: 1, locationMismatch: 1,
                    authMismatch: 1, threshold: 1, companyBlocked: 1, otherSkip: 1,
                    sessions: 1, lastSessionAt: 1,
                    clientCount: { $size: { $ifNull: ["$clientsSet", []] } },
                },
            },
            { $sort: { date: -1, pushed: -1, captures: -1 } },
        ]);

        return res.json({
            success: true,
            days,
            windowStart: cutoff.toISOString(),
            windowLabel: istWindowLabel(days),
            timezone: TZ,
            rows,
        });
    } catch (err) {
        console.error("OperatorActivity error:", err);
        return res.status(500).json({ success: false, error: "INTERNAL", message: err.message });
    }
}
