// POST /second-judge-flag/resolve { jobID, email, action: 'keep'|'remove', operatorName? }
// Operator acting on an AI second-stage flag from the CRM review queue.
//   keep   → dismiss the flag (secondJudge.status='reviewed'); job stays put.
//   remove → move to the Removed column (currentStatus 'deleted by <op>') + dismiss the flag.
// Both drop the job out of the flagged queries (which match status==='failed').

import { JobModel } from "../Schema_Models/JobModel.js";

const nowIST = () => new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });

export default async function ResolveSecondJudgeFlag(req, res) {
  try {
    const { jobID, email, action } = req.body || {};
    const by = (String(req.body?.operatorName || "operations").trim()) || "operations";
    if (!jobID || !email || !["keep", "remove"].includes(action)) {
      return res.status(400).json({ success: false, message: "jobID, email, action (keep|remove) required" });
    }
    const query = { jobID, userID: String(email).toLowerCase() };
    const update = action === "keep"
      ? { $set: { "secondJudge.status": "reviewed" } }
      : {
          $set: {
            currentStatus: `deleted by ${by}`,
            removedBy: by,
            removalReason: "Removed by operator (AI second-stage flag)",
            removalDate: nowIST(),
            updatedAt: nowIST(),
            "secondJudge.status": "reviewed",
          },
          $push: { timeline: `deleted by ${by}` },
        };
    const r = await JobModel.findOneAndUpdate(query, update, { new: true }).lean();
    if (!r) return res.status(404).json({ success: false, message: "job not found" });
    return res.status(200).json({ success: true, action });
  } catch (err) {
    console.error("ResolveSecondJudgeFlag error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
}
