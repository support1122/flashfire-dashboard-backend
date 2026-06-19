// GetAiRemovedJobs — GET /ai-removed-jobs?email=<client>&page=1&limit=5
//
// Lists a client's AI-removed jobs (second-stage screening + exclusion
// reconciliation — both set removedBy:'AI') newest-first, paginated. Powers the
// CRM "See AI reasons to remove" modal. Each row carries enough to render the
// reason and deep-link back into the main portal job card (?jobId=<jobID>).
//
// Response: { success, page, limit, total, totalPages, jobs: [{
//   jobID, _id, jobTitle, companyName, joblink, removalReason, removalDate,
//   secondJudgeReason, secondJudgeScore }] }

import { JobModel } from "../Schema_Models/JobModel.js";

export default async function GetAiRemovedJobs(req, res) {
  try {
    const email = String(req.query?.email || req.body?.email || "")
      .trim()
      .toLowerCase();
    if (!email || !email.includes("@")) {
      return res.status(400).json({ success: false, message: "email is required" });
    }

    const page = Math.max(parseInt(req.query?.page || req.body?.page || "1", 10) || 1, 1);
    const limitRaw = parseInt(req.query?.limit || req.body?.limit || "5", 10) || 5;
    const limit = Math.min(Math.max(limitRaw, 1), 50); // top-5 default, cap at 50
    const skip = (page - 1) * limit;

    // Second-stage screening now FLAGS jobs (secondJudge.status:'failed')
    // instead of removing them — the operator decides. List those flagged jobs
    // with their reason so the CRM modal surfaces the AI's concerns.
    const query = {
      userID: email,
      "secondJudge.status": "failed",
    };

    const projection =
      "jobID jobTitle companyName joblink removalReason removalDate removedBy currentStatus secondJudge";

    const [total, rows] = await Promise.all([
      JobModel.countDocuments(query),
      JobModel.find(query)
        .select(projection)
        .sort({ _id: -1 }) // newest first (removalDate is a locale string — not sortable)
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);

    const jobs = rows.map((j) => ({
      jobID: j.jobID,
      _id: String(j._id),
      jobTitle: j.jobTitle || "",
      companyName: j.companyName || "",
      joblink: j.joblink || "",
      removalReason: j.removalReason || "",
      removalDate: j.removalDate || "",
      currentStatus: j.currentStatus || "",
      secondJudgeReason: j.secondJudge?.reason || "",
      secondJudgeScore: j.secondJudge?.score ?? null,
    }));

    return res.status(200).json({
      success: true,
      email,
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      jobs,
    });
  } catch (err) {
    console.error("GetAiRemovedJobs error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
}
