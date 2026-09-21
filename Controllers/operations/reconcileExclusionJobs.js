/**
 * Reconciliation: one ClientOperations read → build Sets (hash-set lookups),
 * one JobModel.find for userID → each job O(1) company + O(k) location tokens.
 * bulkWrite updates all matches in one round-trip.
 */
import { JobModel } from "../../Schema_Models/JobModel.js";
import { UserModel } from "../../Schema_Models/UserModel.js";
import { ClientOperationsModel } from "../../Schema_Models/ClientOperationsModel.js";
import {
  buildExclusionCheckSets,
  isCompanyBlocked,
  isLocationBlocked,
} from "../../Utils/exclusionLists.js";

const getCurrentISTTime = () =>
  new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });

const REMOVAL_STATUS = "removed by AI";

function isAlreadyRemovedStatus(status) {
  if (!status) return false;
  const s = String(status).toLowerCase().trim();
  return s.startsWith("deleted") || s.startsWith("removed");
}

/**
 * Move non-removed jobs to "removed by AI" when they match exclusion lists.
 * Uses one batched pass over jobs for the client (indexed by userID).
 */
export async function reconcileExclusionJobsForClient(clientEmail) {
  const emailLower = String(clientEmail).toLowerCase().trim();
  const doc = await ClientOperationsModel.findOne({
    clientEmail: emailLower,
  }).lean();
  if (!doc) {
    return { scanned: 0, removed: 0 };
  }

  const { companySet, locationExactSet, locationTokenSet } =
    buildExclusionCheckSets(doc.excludedCompanies, doc.excludedLocations);

  const jobs = await JobModel.find({ userID: emailLower })
    .select("_id companyName jobLocation currentStatus")
    .lean();

  const toRemove = [];
  for (const job of jobs) {
    if (isAlreadyRemovedStatus(job.currentStatus)) continue;
    const company = job.companyName;
    const loc = job.jobLocation || "";
    if (
      isCompanyBlocked(company, companySet) ||
      isLocationBlocked(loc, locationExactSet, locationTokenSet)
    ) {
      toRemove.push(job._id);
    }
  }

  if (!toRemove.length) {
    return { scanned: jobs.length, removed: 0 };
  }

  const now = getCurrentISTTime();
  const bulk = toRemove.map((id) => ({
    updateOne: {
      filter: { _id: id },
      update: {
        $set: {
          currentStatus: REMOVAL_STATUS,
          updatedAt: now,
          removalReason: "Excluded by client policy (company or location list)",
          removalDate: now,
          removedBy: "AI",
        },
        $push: { timeline: REMOVAL_STATUS },
      },
    },
  }));

  await JobModel.bulkWrite(bulk);

  await UserModel.findOneAndUpdate(
    { email: emailLower },
    { $inc: { removedJobsCount: toRemove.length } }
  );

  return { scanned: jobs.length, removed: toRemove.length };
}

/** POST body: { clientEmail } — manual re-run of job reconciliation (same as after exclusion save) */
export async function reconcileExclusionJobsHandler(req, res) {
  try {
    const { clientEmail } = req.body || {};
    if (!clientEmail || !String(clientEmail).trim()) {
      return res.status(400).json({
        success: false,
        message: "clientEmail is required",
      });
    }
    const result = await reconcileExclusionJobsForClient(String(clientEmail).trim());
    return res.status(200).json({ success: true, ...result });
  } catch (e) {
    console.error("reconcileExclusionJobsHandler:", e);
    return res.status(500).json({
      success: false,
      message: e.message || "Reconciliation failed",
    });
  }
}
