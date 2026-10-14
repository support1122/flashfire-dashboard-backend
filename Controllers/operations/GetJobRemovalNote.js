import { JobModel } from "../../Schema_Models/JobModel.js";

/**
 * POST /operations/job-removal-note  { jobID, userEmail }
 *
 * Everything known about why a job card is in Removed, for the operator view:
 * the client's own reason (removalReason, which the client can also see) and
 * the operator's written reason (operatorRemoval, which only operators see).
 *
 * This is the ONLY read path for operatorRemoval. The field is select:false in
 * JobModel, so it is absent from /getalljobs, /get-removal-reason and every
 * other response a client receives; it is fetched here, one job at a time,
 * when an operator long-presses a removed card. Same pattern as
 * /operations/job-ai-decision.
 */
export default async function GetJobRemovalNote(req, res) {
     try {
          const jobID = String(req.body?.jobID || "").trim();
          const userEmail = String(req.body?.userEmail || "").trim().toLowerCase();

          if (!jobID || !userEmail) {
               return res.status(400).json({ success: false, message: "jobID and userEmail are required" });
          }

          const job = await JobModel.findOne({ jobID, userID: userEmail })
               .select("+operatorRemoval removalReason removalDate removedBy jobTitle companyName")
               .lean();

          if (!job) {
               return res.status(404).json({ success: false, message: "Job not found" });
          }

          const op = job.operatorRemoval;
          const operatorRemoval = op?.reason
               ? { reason: op.reason, by: op.by || "", byEmail: op.byEmail || "", at: op.at || null }
               : null;

          if (!job.removalReason && !operatorRemoval) {
               return res.status(404).json({ success: false, message: "No removal reason recorded for this job" });
          }

          return res.status(200).json({
               success: true,
               jobTitle: job.jobTitle,
               companyName: job.companyName,
               clientReason: job.removalReason
                    ? { reason: job.removalReason, by: job.removedBy || "user", date: job.removalDate || "" }
                    : null,
               operatorRemoval,
          });
     } catch (error) {
          console.error("GetJobRemovalNote error:", error);
          return res.status(500).json({ success: false, message: "Server error" });
     }
}
