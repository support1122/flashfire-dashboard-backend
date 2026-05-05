// PushHistory: how many ops-pushed jobs landed in this client's tracker
// each day. Aggregates JobModel by `_id`'s ObjectId-embedded timestamp so
// we don't depend on the `createdAt` string field's locale formatting.
//
// Input  : GET /push-history?email=<client>&days=<n>     (days default 30, cap 365)
// Output : { success, email, days, history: [{ date:'YYYY-MM-DD', count }],
//            totals: { ops, all }, capInfo: { targetJobCount, currentOps } }

import { JobModel } from "../Schema_Models/JobModel.js";
import { ProfileModel } from "../Schema_Models/ProfileModel.js";
import { startOfTodayIST, DEFAULT_DAILY_CAP } from "../Utils/dailyCapGuard.js";

const TZ = "Asia/Kolkata";

export default async function PushHistory(req, res) {
  try {
    const email = String(req.query.email || "").trim().toLowerCase();
    if (!email || !email.includes("@")) {
      return res.status(400).json({ success: false, error: "BAD_INPUT", message: "email is required" });
    }
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 365);

    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // ObjectIds prefixed with hex timestamp — generate a low-bound _id so
    // we can use the userID+_id index for fast range scan.
    const cutoffSeconds = Math.floor(cutoff.getTime() / 1000);
    const oidLowBoundHex = cutoffSeconds.toString(16).padStart(8, "0") + "0000000000000000";
    const ObjectId = JobModel.base.Types.ObjectId;
    const lowBound = new ObjectId(oidLowBoundHex);

    // 1) per-day ops-pushed counts (only operations role — user-tracked
    //    jobs are not relevant to extension/scraper push history).
    const pipeline = [
      { $match: { userID: email, _id: { $gte: lowBound } } },
      {
        $group: {
          _id: {
            $dateToString: {
              format: "%Y-%m-%d",
              date: { $toDate: "$_id" },
              timezone: TZ,
            },
          },
          ops: {
            $sum: {
              $cond: [{ $eq: ["$createdByRole", "operations"] }, 1, 0],
            },
          },
          all: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ];
    const rows = await JobModel.aggregate(pipeline);

    // 2) all-time ops total (display only)
    const opsCountAll = await JobModel.countDocuments({
      userID: email,
      createdByRole: "operations",
    });
    const allCount = await JobModel.countDocuments({ userID: email });

    // 2b) today's ops count — drives the cap. Mirrors AddJob.js daily window.
    const todayStart = startOfTodayIST();
    const todaySeconds = Math.floor(todayStart.getTime() / 1000);
    const todayOidHex = todaySeconds.toString(16).padStart(8, "0") + "0000000000000000";
    const todayLowBound = new ObjectId(todayOidHex);
    const opsCountToday = await JobModel.countDocuments({
      userID: email,
      createdByRole: "operations",
      _id: { $gte: todayLowBound },
    });

    // 3) target cap (if set on profile)
    const profile = await ProfileModel.findOne(
      { email },
      { targetJobCount: 1 },
    ).lean();

    return res.json({
      success: true,
      email,
      days,
      history: rows.map((r) => ({ date: r._id, ops: r.ops, all: r.all })),
      totals: { ops: opsCountAll, all: allCount },
      capInfo: (() => {
        // Single source of truth: dailyCapGuard.DEFAULT_DAILY_CAP. Anything
        // here MUST match the AddJob.js gate or extension/admin UIs will
        // show different numbers than what the server actually enforces.
        const rawCap = Number(profile?.targetJobCount);
        const explicit = Number.isFinite(rawCap) && rawCap > 0 ? rawCap : null;
        const effective = explicit ?? DEFAULT_DAILY_CAP;
        return {
          targetJobCount: explicit,
          effectiveCap: effective,
          isDefaultCap: explicit == null,
          currentOps: opsCountToday,
          currentOpsAllTime: opsCountAll,
          windowResetsAt: "00:00 Asia/Kolkata",
          remaining: Math.max(0, effective - opsCountToday),
        };
      })(),
    });
  } catch (err) {
    console.error("PushHistory error:", err);
    return res
      .status(500)
      .json({ success: false, error: "INTERNAL", message: err.message });
  }
}
