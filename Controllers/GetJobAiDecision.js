import { JobModel } from "../Schema_Models/JobModel.js";

/**
 * Return the AI judge's verdict for ONE job.
 *
 * GetAllJobs deliberately strips `aiDecision` from the list response: it is
 * operator-only context, and a reason string on every card would add real
 * weight to a response that often carries hundreds of jobs. An operator who
 * actually wants to know why a job was picked clicks "Why?" and pays for that
 * one document instead.
 *
 * Operator surface (mounted under /operations). Nothing client-facing calls it,
 * and the payload is strictly less than what /operations/getalljobs already
 * returns for the same job.
 */
export default async function GetJobAiDecision(req, res) {
    try {
        const id = String(req.body?.jobId || req.body?.id || "").trim();
        if (!id) {
            return res.status(400).json({ success: false, message: "jobId required" });
        }

        // Jobs are addressed two ways across this codebase: the Mongo _id and
        // the extension's own jobID string. Accept either so the caller does
        // not have to know which one it is holding.
        const query = /^[0-9a-fA-F]{24}$/.test(id) ? { _id: id } : { jobID: id };
        const job = await JobModel.findOne(query)
            .select("aiDecision jobTitle companyName createdByRole")
            .lean();

        if (!job) {
            return res.status(404).json({ success: false, message: "job not found" });
        }

        // An older job, a client-added job, or one pushed before the extension
        // started recording verdicts. Answer 200 with null rather than 404 -
        // "nothing was recorded" is a real answer, not a failure, and the UI
        // shows it as such.
        return res.status(200).json({
            success: true,
            jobTitle: job.jobTitle || "",
            companyName: job.companyName || "",
            aiDecision: job.aiDecision || null,
        });
    } catch (error) {
        console.error("GetJobAiDecision error:", error.message);
        return res.status(500).json({ success: false, message: "failed to load the pick reason" });
    }
}
