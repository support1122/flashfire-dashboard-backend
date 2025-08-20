// controllers/Add_Update_Profile.js (ESM)
import { ProfileModel } from "../Schema_Models/ProfileModel.js"; // fix path

const splitList = (val) =>
  Array.isArray(val)
    ? val
    : String(val ?? "")
        .split(/[;,]/)
        .map((s) => s.trim())
        .filter(Boolean);

// Accept structured object or single-line "Street, City, State ZIP"
const parseAddress = (addr) => {
  if (!addr) return undefined;
  if (typeof addr === "object") return addr;

  const parts = String(addr).split(",").map((s) => s.trim());
  const [street = "", city = "", stateZip = ""] = parts;
  const [state = "", ...zipParts] = stateZip.split(/\s+/);
  const zip = zipParts.join(" ").trim();

  if (!street && !city && !state && !zip) return undefined; // don't set empty
  return { street, city, state, zip, country: "United States" };
};

const toDate = (val) => {
  if (!val) return undefined;
  if (val instanceof Date) return val;
  if (/^\d{4}-\d{2}(-\d{2})?$/.test(String(val))) {
    const [y, m, d] = String(val).split("-").map(Number);
    return new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  }
  const dt = new Date(val);
  return isNaN(dt) ? undefined : dt;
};

export default async function Add_Update_Profile(req, res) {
  try {
    const b = req.body || {};
    const email = b.email || b.userDetails?.email;
    if (!email || !b.userDetails?.email || email !== b.userDetails.email) {
      return res.status(403).json({ message: "Token or user details missing" });
    }

    // Build updates in schema types
    const updates = {
      email,
      firstName: b.firstName,
      lastName: b.lastName,
      contactNumber: b.contactNumber,
      dob: toDate(b.dob),

      bachelorsUniDegree: b.bachelorsUniDegree,
      bachelorsGradMonthYear: toDate(b.bachelorsGradMonthYear),
      mastersUniDegree: b.mastersUniDegree,
      mastersGradMonthYear: toDate(b.mastersGradMonthYear),

      visaStatus: b.visaStatus,
      visaExpiry: toDate(b.visaExpiry),

      address: parseAddress(b.address),

      preferredRoles: splitList(b.preferredRoles),
      experienceLevel: b.experienceLevel,
      expectedSalaryRange: b.expectedSalaryRange,
      preferredLocations: splitList(b.preferredLocations),
      targetCompanies: splitList(b.targetCompanies),
      reasonForLeaving: b.reasonForLeaving,

      linkedinUrl: b.linkedinUrl,
      githubUrl: b.githubUrl,
      portfolioUrl: b.portfolioUrl,
      coverLetterUrl: b.coverLetterUrl,
      resumeUrl: b.resumeUrl,

      confirmAccuracy: b.confirmAccuracy,
      agreeTos: b.agreeTos,

      status: b.status || undefined,
    };

    // Clean undefineds and prevent bad embedded casts
    for (const k of Object.keys(updates)) {
      const v = updates[k];
      if (v === undefined) delete updates[k];
      if (k === "address" && (v === "" || v === null)) delete updates[k];
    }
    // Never persist auth stuff
    delete updates.token;
    delete updates.userDetails;

    const updated = await ProfileModel.findOneAndUpdate(
      { email },
      { $set: updates },
      { new: true, runValidators: true }
    );

    return res.json({
      message: req.profileWasCreated
        ? "Profile created successfully"
        : "Profile updated successfully",
      profile: updated,
    });
  } catch (err) {
    console.error("Add_Update_Profile error:", err);
    return res.status(500).json({ message: "Failed to set profile" });
  }
}
