// // controllers/Add_Update_Profile.js (ESM)
// import { ProfileModel } from "../Schema_Models/ProfileModel.js"; // fix path

// const splitList = (val) =>
//   Array.isArray(val)
//     ? val
//     : String(val ?? "")
//         .split(/[;,]/)
//         .map((s) => s.trim())
//         .filter(Boolean);

// const onlyDigits = (v) => String(v ?? "").replace(/\D/g, "");
// // ssnNumber: b.ssnNumber != null ? onlyDigits(b.ssnNumber) : undefined,


// // Accept structured object or single-line "Street, City, State ZIP"
// const parseAddress = (addr) => {
//   if (!addr) return undefined;
//   if (typeof addr === "object") return addr;

//   const parts = String(addr).split(",").map((s) => s.trim());
//   const [street = "", city = "", stateZip = ""] = parts;
//   const [state = "", ...zipParts] = stateZip.split(/\s+/);
//   const zip = zipParts.join(" ").trim();

//   const result = {};
//   if (street) result.street = street;
//   if (city) result.city = city;
//   if (state) result.state = state;
//   if (zip) result.zip = zip;
//   if (Object.keys(result).length === 0) return undefined;

//   result.country = "United States";
//   return result;
// };


// const toDate = (val) => {
//   if (!val) return undefined;
//   if (val instanceof Date) return val;
//   if (/^\d{4}-\d{2}(-\d{2})?$/.test(String(val))) {
//     const [y, m, d] = String(val).split("-").map(Number);
//     return new Date(Date.UTC(y, (m || 1) - 1, d || 1));
//   }
//   const dt = new Date(val);
//   return isNaN(dt) ? undefined : dt;
// };

// export default async function Add_Update_Profile(req, res) {
//   try {
//     const b = req.body || {};
//     const email = b.email || b.userDetails?.email;
//     if (!email || !b.userDetails?.email || email !== b.userDetails.email) {
//       return res.status(403).json({ message: "Token or user details missing" });
//     }

//     // Build updates in schema types
//     const updates = {
//       email,
//       firstName: b.firstName,
//       lastName: b.lastName,
//       contactNumber: b.contactNumber,
//       dob: toDate(b.dob),

//       bachelorsUniDegree: b.bachelorsUniDegree,
//       bachelorsGradMonthYear: toDate(b.bachelorsGradMonthYear),
//       mastersUniDegree: b.mastersUniDegree,
//       mastersGradMonthYear: toDate(b.mastersGradMonthYear),

//       visaStatus: b.visaStatus,
//       visaExpiry: toDate(b.visaExpiry),

//       address: b.address || undefined,


//       preferredRoles: splitList(b.preferredRoles),
//       experienceLevel: b.experienceLevel,
//       expectedSalaryRange: b.expectedSalaryRange,

//       expectedSalaryNarrative: (b.expectedSalaryNarrative || "").trim() || undefined,

//       preferredLocations: splitList(b.preferredLocations),
//       targetCompanies: splitList(b.targetCompanies),
//       reasonForLeaving: b.reasonForLeaving,

//       linkedinUrl: b.linkedinUrl,
//       githubUrl: b.githubUrl,
//       portfolioUrl: b.portfolioUrl,
//       coverLetterUrl: b.coverLetterUrl,
//       resumeUrl: b.resumeUrl,

//       confirmAccuracy: b.confirmAccuracy,
//       agreeTos: b.agreeTos,

//       status: b.status || undefined,
//       // NEW FIELDS
//       // Free-text salary sentence the user typed
//       // expectedSalaryNarrative: (b.expectedSalaryNarrative ?? "").trim() || undefined,
//       // Availability / joining time sentence
//       availabilityNote: (b.availabilityNote ?? "").trim() || undefined,
//       // SSN (stored, not returned by default because schema has select:false)
//       ssnNumber: b.ssnNumber != null ? onlyDigits(b.ssnNumber) : undefined,
//     };

//     // Clean undefineds and prevent bad embedded casts
//     for (const k of Object.keys(updates)) {
//       const v = updates[k];
//       if (v === undefined) delete updates[k];
//       if (k === "address" && (v === "" || v === null)) delete updates[k];
//     }
//     // Never persist auth stuff
//     delete updates.token;
//     delete updates.userDetails;

//     const updated = await ProfileModel.findOneAndUpdate(
//       { email },
//       { $set: updates },
//       { new: true, runValidators: true }
//     );

//     return res.json({
//       message: req.profileWasCreated
//         ? "Profile created successfully"
//         : "Profile updated successfully",
//       profile: updated,
//     });
//   } catch (err) {
//     console.error("Add_Update_Profile error:", err);
//     return res.status(500).json({ message: "Failed to set profile" });
//   }
// }


import { ProfileModel } from "../Schema_Models/ProfileModel.js";
import { UserModel } from "../Schema_Models/UserModel.js";

export default async function Add_Update_Profile(req, res) {
  try {
    const {
      email, // This will be the contact email from the form
      firstName,
      lastName,
      contactNumber,
      dob,
      address,
      visaStatus,
      bachelorsUniDegree,
      bachelorsGradMonthYear,
      mastersUniDegree,
      mastersGradMonthYear,
      gpa,
      undergraduateTranscript,
      preferredRoles,
      experienceLevel,
      expectedSalaryRange,
      preferredLocations,
      targetCompanies,
      reasonForLeaving,
      joinTime,
      linkedinUrl,
      githubUrl,
      portfolioUrl,
      resumeUrl, // Now expects Cloudinary URL
      coverLetterUrl, // Now expects Cloudinary URL
      portfolioFileUrl, // New portfolio file field
      confirmAccuracy,
      agreeTos,
      token,
      userDetails,
    } = req.body;

    // Use the authentication email (username) as the primary key
    const authEmail = userDetails?.email;
    if (!authEmail) {
      return res.status(400).json({ message: "Authentication email is required" });
    }

    if (!email) {
      return res.status(400).json({ message: "Contact email is required" });
    }

    // Check if profile exists using authentication email
    let existingProfile = await ProfileModel.findOne({ email: authEmail });

    if (existingProfile) {
      // Update existing profile
      const updateData = {
        contactEmail: email, // Update contact email from form
        firstName: firstName || existingProfile.firstName,
        lastName: lastName || existingProfile.lastName,
        contactNumber: contactNumber || existingProfile.contactNumber,
        dob: dob || existingProfile.dob,
        address: address || existingProfile.address,
        visaStatus: visaStatus || existingProfile.visaStatus,
        bachelorsUniDegree: bachelorsUniDegree || existingProfile.bachelorsUniDegree,
        bachelorsGradMonthYear: bachelorsGradMonthYear || existingProfile.bachelorsGradMonthYear,
        mastersUniDegree: mastersUniDegree || existingProfile.mastersUniDegree,
        mastersGradMonthYear: mastersGradMonthYear || existingProfile.mastersGradMonthYear,
        gpa: gpa !== undefined ? gpa : existingProfile.gpa,
        undergraduateTranscript: undergraduateTranscript || existingProfile.undergraduateTranscript,
        preferredRoles: preferredRoles || existingProfile.preferredRoles,
        experienceLevel: experienceLevel || existingProfile.experienceLevel,
        expectedSalaryRange: expectedSalaryRange || existingProfile.expectedSalaryRange,
        preferredLocations: preferredLocations || existingProfile.preferredLocations,
        targetCompanies: targetCompanies || existingProfile.targetCompanies,
        reasonForLeaving: reasonForLeaving || existingProfile.reasonForLeaving,
        joinTime: joinTime || existingProfile.joinTime,
        linkedinUrl: linkedinUrl || existingProfile.linkedinUrl,
        githubUrl: githubUrl || existingProfile.githubUrl,
        portfolioUrl: portfolioUrl || existingProfile.portfolioUrl,
        resumeUrl: resumeUrl || existingProfile.resumeUrl, // Cloudinary URL
        coverLetterUrl: coverLetterUrl || existingProfile.coverLetterUrl, // Cloudinary URL
        portfolioFileUrl: portfolioFileUrl || existingProfile.portfolioFileUrl, // New portfolio file
        confirmAccuracy: confirmAccuracy !== undefined ? confirmAccuracy : existingProfile.confirmAccuracy,
        agreeTos: agreeTos !== undefined ? agreeTos : existingProfile.agreeTos,
      };

      const updatedProfile = await ProfileModel.findOneAndUpdate(
        { email: authEmail },
        updateData,
        { new: true }
      );

      return res.json({
        message: "Profile updated successfully",
        userProfile: updatedProfile,
      });
    } else {
      // Create new profile
      const newProfile = new ProfileModel({
        email: authEmail, // Use authentication email as primary key
        contactEmail: email, // Store contact email as separate field
        firstName: firstName || "",
        lastName: lastName || "",
        contactNumber: contactNumber || "",
        dob: dob || "",
        address: address || "",
        visaStatus: visaStatus || "",
        bachelorsUniDegree: bachelorsUniDegree || "",
        bachelorsGradMonthYear: bachelorsGradMonthYear || "",
        mastersUniDegree: mastersUniDegree || "",
        mastersGradMonthYear: mastersGradMonthYear || "",
        gpa: gpa || 0,
        undergraduateTranscript: undergraduateTranscript || null,
        preferredRoles: preferredRoles || [],
        experienceLevel: experienceLevel || "",
        expectedSalaryRange: expectedSalaryRange || "",
        preferredLocations: preferredLocations || [],
        targetCompanies: targetCompanies || [],
        reasonForLeaving: reasonForLeaving || "",
        joinTime: joinTime || "in 1 week",
        linkedinUrl: linkedinUrl || "",
        githubUrl: githubUrl || "",
        portfolioUrl: portfolioUrl || "",
        resumeUrl: resumeUrl || "", // Cloudinary URL
        coverLetterUrl: coverLetterUrl || "", // Cloudinary URL
        portfolioFileUrl: portfolioFileUrl || "", // New portfolio file
        confirmAccuracy: confirmAccuracy || false,
        agreeTos: agreeTos || false,
      });

      const savedProfile = await newProfile.save();

      return res.json({
        message: "Profile created successfully",
        userProfile: savedProfile,
      });
    }
  } catch (error) {
    console.error("Profile creation/update error:", error);
    return res.status(500).json({
      message: "Internal server error",
      error: error.message,
    });
  }
}
