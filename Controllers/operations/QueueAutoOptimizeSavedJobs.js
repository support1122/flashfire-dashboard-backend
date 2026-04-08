import { JobModel } from "../../Schema_Models/JobModel.js";

const STAGGER_GAP_MS = 5 * 60 * 1000; // 5 minutes

function isOperatorRequest(role, operationsEmail) {
  const normalizedRole = String(role || "").toLowerCase().trim();
  const normalizedOpsEmail = String(operationsEmail || "").toLowerCase().trim();
  return (
    normalizedRole === "operations" ||
    normalizedRole === "operator" ||
    normalizedOpsEmail.endsWith("@flashfirehq")
  );
}

export async function queueAutoOptimizeSavedJobs(req, res) {
  try {
    const { email, role, operationsEmail } = req.body || {};
    const userEmail = String(email || "").toLowerCase().trim();

    if (!userEmail) {
      return res.status(400).json({
        success: false,
        message: "Client email is required",
      });
    }

    if (!isOperatorRequest(role, operationsEmail)) {
      return res.status(403).json({
        success: false,
        message: "Only operators can trigger bulk auto-optimization",
      });
    }

    // Target ONLY "saved" jobs, with JD present, and no optimized resume yet.
    // We use strict equals "saved" to avoid touching any other pipeline status.
    const candidates = await JobModel.find({
      userID: userEmail,
      currentStatus: "saved",
      jobDescription: { $exists: true, $nin: [null, ""] },
      "optimizedResume.hasResume": { $ne: true },
    })
      .select("_id")
      .sort({ _id: 1 })
      .lean();

    if (!candidates.length) {
      return res.status(200).json({
        success: true,
        queuedCount: 0,
        message: "No saved jobs with JD found to queue",
      });
    }

    const startMs = Date.now();
    const ops = candidates.map((job, index) => ({
      updateOne: {
        filter: { _id: job._id },
        update: {
          $set: {
            "autoOptimization.status": "pending",
            "autoOptimization.attempts": 0,
            "autoOptimization.error": null,
            "autoOptimization.startedAt": null,
            "autoOptimization.completedAt": null,
            "autoOptimization.lastFailedAt": null,
            "autoOptimization.retryAfter": new Date(startMs + index * STAGGER_GAP_MS),
            updatedAt: new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }),
          },
        },
      },
    }));

    await JobModel.bulkWrite(ops, { ordered: false });

    const firstScheduledAt = new Date(startMs).toISOString();
    const lastScheduledAt = new Date(startMs + (candidates.length - 1) * STAGGER_GAP_MS).toISOString();

    return res.status(200).json({
      success: true,
      queuedCount: candidates.length,
      staggerMinutes: 5,
      firstScheduledAt,
      lastScheduledAt,
      message: `Queued ${candidates.length} saved job(s) for auto-optimization with 5-minute spacing`,
    });
  } catch (error) {
    console.error("queueAutoOptimizeSavedJobs error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to queue saved jobs for auto-optimization",
      error: error?.message,
    });
  }
}

