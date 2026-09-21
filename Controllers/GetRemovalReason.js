import { JobModel } from "../Schema_Models/JobModel.js";

export default async function GetRemovalReason(req, res) {
  try {
    const { jobID, userEmail } = req.body;

    if (!jobID || !userEmail) {
      return res.status(400).json({
        success: false,
        message: "jobID and userEmail are required"
      });
    }

    const job = await JobModel.findOne({ jobID, userID: userEmail })
      .select('removalReason removalDate removedBy jobTitle companyName')
      .lean();

    if (!job) {
      return res.status(404).json({
        success: false,
        message: "Job not found"
      });
    }

    if (!job.removalReason) {
      return res.status(404).json({
        success: false,
        message: "No removal reason found for this job"
      });
    }

    return res.status(200).json({
      success: true,
      removalReason: job.removalReason,
      removalDate: job.removalDate,
      removedBy: job.removedBy,
      jobTitle: job.jobTitle,
      companyName: job.companyName
    });

  } catch (error) {
    console.error("GetRemovalReason error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
}

