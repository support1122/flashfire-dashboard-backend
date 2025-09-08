import { UserModel } from "../Schema_Models/UserModel.js";

export default async function PlanSelect(req, res) {
  try {
    const {
      // base resume (no metadata)
      resumeLink,

      // plan updates (optional)
      planType,
      planLimit,

      // identity
      userDetails, // must contain email

      // entries with metadata (either or both optional)
      optimizedResumeEntry, // { jobRole, companyName, url, jobId?, jobLink? }
      optimizedResumeEntries, // array of above for multiple
      coverLetterEntry,     // { jobRole, companyName, url, jobId?, jobLink? }
      coverLetterEntries,   // array of above for multiple
    } = req.body;

    if (!userDetails?.email) {
      return res.status(400).json({ message: "Missing user email" });
    }

    // Build $set with only defined values
    const setFields = {};
    if (typeof resumeLink !== "undefined" && resumeLink) setFields.resumeLink = resumeLink;
    if (typeof planType !== "undefined") setFields.planType = planType;
    if (typeof planLimit !== "undefined") setFields.planLimit = planLimit;

    // Normalize entries
    const normalize = (e, type) =>
      e
        ? {
          url: e.url || e.optimizedResumeLink || e.coverLetterLink || "", // accept legacy keys
          companyName: e.companyName ?? "",
          jobRole: e.jobRole ?? "",
          jobId: e.jobId ?? "",
          jobLink: e.jobLink ?? "",
          createdAt: new Date(),
        }
        : null;

    // Handle single or array for optimized
    let normOptimizedList = [];
    if (Array.isArray(optimizedResumeEntries)) {
      normOptimizedList = optimizedResumeEntries.map(e => normalize(e, "optimized")).filter(Boolean);
    } else if (optimizedResumeEntry) {
      const norm = normalize(optimizedResumeEntry, "optimized");
      if (norm) normOptimizedList = [norm];
    }

    // Handle single or array for cover
    let normCoverList = [];
    if (Array.isArray(coverLetterEntries)) {
      normCoverList = coverLetterEntries.map(e => normalize(e, "cover")).filter(Boolean);
    } else if (coverLetterEntry) {
      const norm = normalize(coverLetterEntry, "cover");
      if (norm) normCoverList = [norm];
    }

    // Build update ops
    const updateOps = {};
    if (Object.keys(setFields).length) updateOps.$set = setFields;

    const pushOps = {};
    if (normOptimizedList.length) {
      pushOps.optimizedResumes = { $each: normOptimizedList };
    }
    if (normCoverList.length) {
      pushOps.coverLetters = { $each: normCoverList };
    }
    if (Object.keys(pushOps).length) updateOps.$push = pushOps;

    if (!Object.keys(updateOps).length) {
      return res.status(400).json({ message: "Nothing to update" });
    }

    const user = await UserModel.findOneAndUpdate(
      { email: userDetails.email },
      updateOps,
      { new: true, runValidators: true }
    );

    if (!user) return res.status(404).json({ message: "User not found" });

    return res.status(200).json({
      message: "Updated successfully",
      userDetails: {
        email: user.email,
        name: user.name,
        planLimit: user.planLimit,
        planType: user.planType,
        resumeLink: user.resumeLink,
        coverLetters: user.coverLetters,
        optimizedResumes: user.optimizedResumes,
        userType: user.userType,
      },
    });
  } catch (err) {
    console.error("selectPlanAndUploads error:", err);
    return res.status(500).json({ message: "Server error" });
  }
}
