import { UserModel } from "../Schema_Models/UserModel.js";

export default async function PlanSelect(req, res) {
  console.log(req.body)
  try {
    const {
      resumeLink,
      planType,
      planLimit,
      userDetails, 
      optimizedResumeEntry,
      coverLetterEntry,
      transcriptEntry,   // ✅ new
      deleteBaseResume,
      deleteOptimizedResume,
      deleteCoverLetter,
      deleteTranscript   // ✅ new
    } = req.body;

    if (!userDetails?.email) {
      return res.status(400).json({ message: "Missing user email" });
    }

    // --- Defensive: normalize legacy resumeLink type (string -> array of objects) ---
    try {
      const existing = await UserModel.findOne({ email: userDetails.email }).lean();
      if (existing && typeof existing.resumeLink === "string" && existing.resumeLink.trim() !== "") {
        const legacyUrl = existing.resumeLink;
        const legacyName = legacyUrl.split("/").pop() || "resume.pdf";
        await UserModel.updateOne(
          { email: userDetails.email },
          {
            $set: {
              resumeLink: [
                {
                  name: legacyName,
                  link: legacyUrl,
                  createdAt: new Date(),
                },
              ],
            },
          }
        );
      } else if (existing && !Array.isArray(existing.resumeLink)) {
        // If it's any other non-array type (null/object), coerce to [] to avoid $push errors
        await UserModel.updateOne(
          { email: userDetails.email },
          { $set: { resumeLink: [] } }
        );
      }
    } catch (e) {
      // Do not fail the request for normalization issues; proceed with best-effort
      console.warn("resumeLink normalization warning:", e?.message || e);
    }

    // --- Build $set with only defined values ---
    const setFields = {};
    if (typeof planType !== "undefined") setFields.planType = planType;
    if (typeof planLimit !== "undefined") setFields.planLimit = planLimit;

    // --- Normalize entries ---
    const normalize = (e) =>
      e
        ? {
            name: e.name || 'unnamed',
            url: e.url || e.link || e.optimizedResumeLink || e.coverLetterLink || "",
            companyName: e.companyName ?? "",
            jobRole: e.jobRole ?? "",
            jobId: e.jobId ?? "",
            jobLink: e.jobLink ?? "",
            createdAt: new Date(),
          }
        : null;

    const normOptimized = normalize(optimizedResumeEntry);
    const normCover     = normalize(coverLetterEntry);
    const normTranscript= normalize(transcriptEntry);

    // --- Build update ops ---
    const updateOps = {};
    if (Object.keys(setFields).length) updateOps.$set = setFields;

    const pushOps = {};
    const pullOps = {};

    // ✅ Base resume
    if (typeof resumeLink !== "undefined" && resumeLink) {
      let resumeUrl = "";
      if (typeof resumeLink === "string") {
        resumeUrl = resumeLink;
      } else if (typeof resumeLink === "object" && resumeLink.link) {
        resumeUrl = resumeLink.link;
      }

      if (resumeUrl && !resumeUrl.includes("undefined") && resumeUrl.trim() !== "") {
        const resumeEntry = {
          name: resumeLink.name || resumeUrl.split("/").pop() || "resume.pdf",
          createdAt: new Date(),
          link: resumeUrl,
        };
        pushOps.resumeLink = { $each: [resumeEntry] };
      }
    }

    // ✅ Optimized resumes / Cover letters
    if (normOptimized && normOptimized.url) {
      pushOps.optimizedResumes = { $each: [normOptimized] };
    }
    if (normCover && normCover.url) {
      pushOps.coverLetters = { $each: [normCover] };
    }

    // ✅ Transcripts
    if (normTranscript && normTranscript.url) {
      pushOps.transcript = { $each: [normTranscript] };
    }

    // ✅ Handle deletions
    if (deleteBaseResume) {
      if (deleteBaseResume.link) {
        pullOps.resumeLink = { link: deleteBaseResume.link };
      } else if (deleteBaseResume.name) {
        pullOps.resumeLink = { name: deleteBaseResume.name };
      }
    }
    if (deleteOptimizedResume) {
      if (deleteOptimizedResume.url) {
        pullOps.optimizedResumes = { url: deleteOptimizedResume.url };
      } else if (deleteOptimizedResume.jobId) {
        pullOps.optimizedResumes = { jobId: deleteOptimizedResume.jobId };
      }
    }
    if (deleteCoverLetter) {
      if (deleteCoverLetter.url) {
        pullOps.coverLetters = { url: deleteCoverLetter.url };
      } else if (deleteCoverLetter.jobId) {
        pullOps.coverLetters = { jobId: deleteCoverLetter.jobId };
      }
    }
    if (deleteTranscript) {
      if (deleteTranscript.url) {
        pullOps.transcript = { url: deleteTranscript.url };
      } else if (deleteTranscript.name) {
        pullOps.transcript = { name: deleteTranscript.name };
      }
    }

    if (Object.keys(pushOps).length) updateOps.$push = pushOps;
    if (Object.keys(pullOps).length) updateOps.$pull = pullOps;

    if (!Object.keys(updateOps).length) {
      return res.status(400).json({ message: "Nothing to update" });
    }

    // --- Perform update ---
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
        transcript: user.transcript,  // ✅ return transcript array too
        userType: user.userType,
      },
    });
  } catch (err) {
    console.error("selectPlanAndUploads error:", err);
    return res.status(500).json({ message: "Server error" });
  }
}


// import { UserModel } from "../Schema_Models/UserModel.js";

// export default async function PlanSelect(req, res) {
//   console.log(req.body)
//   try {
//     const {
//       // base resume (with metadata)
//       resumeLink,

//       // plan updates (optional)
//       planType,
//       planLimit,

//       // identity
//       userDetails, // must contain email

//       // entries with metadata (either or both optional)
//       optimizedResumeEntry, // { jobRole, companyName, url, jobId?, jobLink? }
//       coverLetterEntry,     // { jobRole, companyName, url, jobId?, jobLink? }

//       // 🔴 new: deletion requests
//       deleteBaseResume,      // expects { link } or { name }
//       deleteOptimizedResume, // expects { url } or { jobId }
//       deleteCoverLetter,     // expects { url } or { jobId }
//     } = req.body;

//     if (!userDetails?.email) {
//       return res.status(400).json({ message: "Missing user email" });
//     }

//     // --- Build $set with only defined values ---
//     const setFields = {};
//     if (typeof planType !== "undefined") setFields.planType = planType;
//     if (typeof planLimit !== "undefined") setFields.planLimit = planLimit;

//     // --- Normalize entries for push ---
//     const normalize = (e) =>
//       e
//         ? {
//             name: e.name || '',
//             url: e.url || e.optimizedResumeLink || e.coverLetterLink || "",
//             companyName: e.companyName ?? "",
//             jobRole: e.jobRole ?? "",
//             jobId: e.jobId ?? "",
//             jobLink: e.jobLink ?? "",
//             createdAt: new Date(),
//           }
//         : null;

//     const normOptimized = normalize(optimizedResumeEntry);
//     const normCover = normalize(coverLetterEntry);

//     // --- Build update operations ---
//     const updateOps = {};
//     if (Object.keys(setFields).length) updateOps.$set = setFields;

//     const pushOps = {};
//     const pullOps = {};

//     // ✅ Handle base resume upload
//     if (typeof resumeLink !== "undefined" && resumeLink) {
//       let resumeUrl = "";

//       if (typeof resumeLink === "string") {
//         resumeUrl = resumeLink;
//       } else if (typeof resumeLink === "object" && resumeLink.link) {
//         resumeUrl = resumeLink.link;
//       }

//       if (
//         resumeUrl &&
//         !resumeUrl.includes("undefined") &&
//         resumeUrl.trim() !== ""
//       ) {
//         const resumeEntry = {
//           name: resumeLink.name, //resumeUrl.split("/").pop() || "resume.pdf",
//           createdAt: new Date(),
//           link: resumeUrl,
//         };
//         pushOps.resumeLink = { $each: [resumeEntry] };
//       }
//     }

//     // ✅ Handle new optimized resume / cover letter
//     if (normOptimized && normOptimized.url) {
//       pushOps.optimizedResumes = { $each: [normOptimized] };
//     }
//     if (normCover && normCover.url) {
//       pushOps.coverLetters = { $each: [normCover] };
//     }

//     // ✅ Handle deletions
//     if (deleteBaseResume) {
//       if (deleteBaseResume.link) {
//         pullOps.resumeLink = { link: deleteBaseResume.link };
//       } else if (deleteBaseResume.name) {
//         pullOps.resumeLink = { name: deleteBaseResume.name };
//       }
//     }
//     if (deleteOptimizedResume) {
//       if (deleteOptimizedResume.url) {
//         pullOps.optimizedResumes = { url: deleteOptimizedResume.url };
//       } else if (deleteOptimizedResume.jobId) {
//         pullOps.optimizedResumes = { jobId: deleteOptimizedResume.jobId };
//       }
//     }
//     if (deleteCoverLetter) {
//       if (deleteCoverLetter.url) {
//         pullOps.coverLetters = { url: deleteCoverLetter.url };
//       } else if (deleteCoverLetter.jobId) {
//         pullOps.coverLetters = { jobId: deleteCoverLetter.jobId };
//       }
//     }

//     if (Object.keys(pushOps).length) updateOps.$push = pushOps;
//     if (Object.keys(pullOps).length) updateOps.$pull = pullOps;

//     if (!Object.keys(updateOps).length) {
//       return res.status(400).json({ message: "Nothing to update" });
//     }

//     // --- Perform update ---
//     const user = await UserModel.findOneAndUpdate(
//       { email: userDetails.email },
//       updateOps,
//       { new: true, runValidators: true }
//     );

//     if (!user) return res.status(404).json({ message: "User not found" });

//     return res.status(200).json({
//       message: "Updated successfully",
//       userDetails: {
//         email: user.email,
//         name: user.name,
//         planLimit: user.planLimit,
//         planType: user.planType,
//         resumeLink: user.resumeLink,
//         coverLetters: user.coverLetters,
//         optimizedResumes: user.optimizedResumes,
//         userType: user.userType,
//       },
//     });
//   } catch (err) {
//     console.error("selectPlanAndUploads error:", err);
//     return res.status(500).json({ message: "Server error" });
//   }
// }