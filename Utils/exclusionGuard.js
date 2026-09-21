import { ClientOperationsModel } from "../Schema_Models/ClientOperationsModel.js";
import {
  buildExclusionCheckSets,
  isCompanyBlocked,
  isLocationBlocked,
} from "./exclusionLists.js";

/**
 * Returns null if allowed, or "BLOCKED_COMPANY" | "BLOCKED_LOCATION".
 * Uses one DB read + O(1) Set lookups per check (hash-set semantics).
 */
export async function getExclusionBlockReason(clientEmail, companyName, jobLocation) {
  if (!clientEmail) return null;
  const emailLower = String(clientEmail).toLowerCase().trim();
  const doc = await ClientOperationsModel.findOne({ clientEmail: emailLower })
    .select("excludedCompanies excludedLocations")
    .lean();
  if (!doc) return null;

  const { companySet, locationExactSet, locationTokenSet } = buildExclusionCheckSets(
    doc.excludedCompanies,
    doc.excludedLocations
  );

  if (isCompanyBlocked(companyName, companySet)) {
    return "BLOCKED_COMPANY";
  }
  const loc = jobLocation !== undefined && jobLocation !== null ? String(jobLocation) : "";
  if (isLocationBlocked(loc, locationExactSet, locationTokenSet)) {
    return "BLOCKED_LOCATION";
  }
  return null;
}
