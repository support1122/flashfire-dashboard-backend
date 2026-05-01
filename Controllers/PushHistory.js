// PushHistory: how many ops-pushed jobs landed in this client's tracker
// each day. Aggregates JobModel by `_id`'s ObjectId-embedded timestamp so
// we don't depend on the `createdAt` string field's locale formatting.
//
// Input  : GET /push-history?email=<client>&days=<n>     (days default 30, cap 365)
// Output : { success, email, days, history: [{ date:'YYYY-MM-DD', count }],
//            totals: { ops, all }, capInfo: { targetJobCount, currentOps } }

import { JobModel } from "../Schema_Models/JobModel.js";
import { ProfileModel } from "../Schema_Models/ProfileModel.js";

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

    // 2) all-time ops total (used by /addjob cap; also display)
    const opsCountAll = await JobModel.countDocuments({
      userID: email,
      createdByRole: "operations",
    });
    const allCount = await JobModel.countDocuments({ userID: email });

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
      capInfo: {
        targetJobCount: profile?.targetJobCount ?? null,
        currentOps: opsCountAll,
        remaining:
          Number.isFinite(Number(profile?.targetJobCount))
          && profile.targetJobCount > 0
            ? Math.max(0, profile.targetJobCount - opsCountAll)
            : null,
      },
    });
  } catch (err) {
    console.error("PushHistory error:", err);
    return res
      .status(500)
      .json({ success: false, error: "INTERNAL", message: err.message });
  }
}
