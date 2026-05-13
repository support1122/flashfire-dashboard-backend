// import mongoose from "mongoose";

// // Schema for undergraduate transcript (similar to resume structure)
// const undergraduateTranscriptSchema = new mongoose.Schema({
//   url: { type: String, required: true }, // Cloudinary URL
//   uploadedAt: { type: Date, default: Date.now },
//   fileName: { type: String, default: "" }
// }, { _id: false });

// export const profileSchema = new mongoose.Schema({
//   email: {
//     type: String,
//     required: true,
//     unique: true,
//   },
//   contactEmail: {
//     type: String,
//     required: false,
//   },
//   firstName: {
//     type: String,
//     required: true,
//   },
//   lastName: {
//     type: String,
//     required: true,
//   },
//   contactNumber: {
//     type: String,
//     required: true,
//   },
//   dob: {
//     type: String,
//     required: true,
//   },
//   address: {
//     type: String,
//     required: true,
//   },
//   visaStatus: {
//     type: String,
//     enum: ["CPT", "F1", "F1 OPT", "F1 STEM OPT", "H1B", "Green Card", "U.S. Citizen", "Other"],
//     required: true,
//   },
//   otherVisaType: {
//     type: String,
//     required: false,
//     default: "",
//   },
//   bachelorsUniDegree: {
//     type: String,
//     required: true,
//   },
//   bachelorsGradMonthYear: {
//     type: String,
//     required: true,
//   },
//   bachelorsGPA: {
//     type: String,
//     required: false,
//     default: "",
//   },
//   mastersUniDegree: {
//     type: String,
//     required: true,
//   },
//   mastersGradMonthYear: {
//     type: String,
//     required: true,
//   },
//   mastersGPA: {
//     type: String,
//     required: false,
//     default: "",
//   },
//   transcriptUrl: {
//     type: String,
//     required: false,
//     default: "",
//   },
//   // Keep the old gpa field for backward compatibility
//   gpa: { 
//     type: Number, 
//     required: false,
//     min: 0,
//     max: 4,
//     validate: {
//       validator: function(v) {
//         return v === null || v === undefined || (v >= 0 && v <= 4);
//       },
//       message: 'GPA must be between 0 and 4'
//     }
//   },
//   undergraduateTranscript: { type: undergraduateTranscriptSchema, default: null }, // PDF file storage
//   preferredRoles: {
//     type: [String],
//     required: true,
//   },
//   experienceLevel: {
//     type: String,
//     enum: ["Entry level", "0-2 Years", "0-3 Years", "0-4 Years", "0-5 Years", "0-6 Years", "0-7 Years", "Other"],
//     required: true,
//   },
//   expectedSalaryRange: {
//     type: String,
//     enum: ["60k-100k", "100k-150k", "150k-200k", "Other"],
//     required: true,
//   },
//   preferredLocations: {
//     type: [String],
//     required: true,
//   },
//   targetCompanies: {
//     type: [String],
//     required: true,
//   },
//   reasonForLeaving: {
//     type: String,
//     required: false,
//   },
//   joinTime: {
//     type: String,
//     enum: ["in 1 week", "in 2 week", "in 3 week", "in 4 week", "in 6-7 week"],
//     required: true,
//     default: "in 1 week"
//   },
//   linkedinUrl: {
//     type: String,
//     required: false,
//   },
//   githubUrl: {
//     type: String,
//     required: false,
//   },
//   portfolioUrl: {
//     type: String,
//     required: false,
//   },
//   resumeUrl: {
//     type: String,
//     required: false,
//   },
//   coverLetterUrl: {
//     type: String,
//     required: false,
//   },
//   portfolioFileUrl: {
//     type: String,
//     required: false,
//   },
//   confirmAccuracy: {
//     type: Boolean,
//     required: true,
//   },
//   agreeTos: {
//     type: Boolean,
//     required: true,
//   },
//   ssn: {
//     type: String,
//     validate: {
//       validator: function(v) {
//         return v === "" || /^\d{3}$/.test(v);
//       },
//       message: "SSN must be the last 3 digits or left blank."
//     },
//     required: false,
//   },
//   references: {
//     type: String,
//     required: false,
//     default: "",
//   },
//   dashboardManager: {
//     type: String,
//     required: false,
//     default: "",
//   },
//   dashboardManagerContact: {
//     type: String,
//     required: false,
//     default: "",
//   },
// }, {
//   timestamps: true
// });

// export const ProfileModel = mongoose.model("Profile", profileSchema);

import mongoose from "mongoose";

// Schema for undergraduate transcript (similar to resume structure)
const undergraduateTranscriptSchema = new mongoose.Schema({
  url: { type: String, required: true }, // Cloudinary URL
  uploadedAt: { type: Date, default: Date.now },
  fileName: { type: String, default: "" }
}, { _id: false });

export const profileSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
  },
  contactEmail: {
    type: String,
    required: false,
  },
  firstName: {
    type: String,
    required: true,
  },
  lastName: {
    type: String,
    required: true,
  },
  contactNumber: {
    type: String,
    required: true,
  },
  dob: {
    type: String,
    required: true,
  },
  address: {
    type: String,
    required: true,
  },
  visaStatus: {
    type: String,
    enum: ["CPT", "F1", "F1 OPT", "F1 STEM OPT", "H1B", "Green Card", "U.S. Citizen", "Other"],
    required: true,
  },
  otherVisaType: {
    type: String,
    required: false,
    default: "",
  },
  bachelorsUniDegree: {
    type: String,
    required: true,
  },
  bachelorsStartDate: {
    type: String,
    required: false,
    default: "",
  },
  bachelorsGradMonthYear: {
    type: String,
    required: true,
  },
  bachelorsEndDate: {
    type: String,
    required: false,
    default: "",
  },
  bachelorsGPA: {
    type: String,
    required: false,
    default: "",
  },
  mastersUniDegree: {
    type: String,
    required: false,
    default: "",
  },
  mastersStartDate: {
    type: String,
    required: false,
    default: "",
  },
  mastersGradMonthYear: {
    type: String,
    required: false,
    default: "",
  },
  mastersEndDate: {
    type: String,
    required: false,
    default: "",
  },
  mastersGPA: {
    type: String,
    required: false,
    default: "",
  },
  transcriptUrl: {
    type: String,
    required: false,
    default: "",
  },
  // Keep the old gpa field for backward compatibility
  gpa: { 
    type: Number, 
    required: false,
    min: 0,
    max: 4,
    validate: {
      validator: function(v) {
        return v === null || v === undefined || (v >= 0 && v <= 4);
      },
      message: 'GPA must be between 0 and 4'
    }
  },
  undergraduateTranscript: { type: undergraduateTranscriptSchema, default: null }, // PDF file storage
  preferredRoles: {
    type: [String],
    required: true,
  },
  experienceLevel: {
    type: String,
    enum: ["Entry level", "0-2 Years", "0-3 Years", "0-4 Years", "0-5 Years", "0-6 Years", "0-7 Years", "Other"],
    required: true,
  },
  expectedSalaryRange: {
    type: String,
    enum: ["60k-100k", "100k-150k", "150k-200k", "Other"],
    required: true,
  },
  preferredLocations: {
    type: [String],
    required: true,
  },
  targetCompanies: {
    type: [String],
    required: true,
  },
  reasonForLeaving: {
    type: String,
    required: false,
  },
  // Employment types the candidate WILL accept. Multi-select from the
  // /profile UI. Defaults to ["Full-time"] when the client never edited
  // it — matches the legacy behavior (most clients want full-time only).
  // Used by the JR-direct extension + scraper to filter postings before
  // AI judging and surfaced in the AI summary so the model honors it.
  // Allowed values: "Full-time" | "Part-time" | "Contract" | "Internship".
  employmentTypes: {
    type: [String],
    required: false,
    default: ["Full-time"],
  },
  veteranStatus: {
    type: String,
    required: false,
    default: "",
  },
  disabilityStatus: {
    type: String,
    required: false,
    default: "",
  },
  scholarshipRequired: {
    type: String,
    required: false,
    default: "",
  },
  usWorkEligibility: {
    type: String,
    required: false,
    default: "",
  },
  joinTime: {
    type: String,
    enum: ["in 1 week", "in 2 week", "in 3 week", "in 4 week", "in 6-7 week"],
    required: true,
    default: "in 1 week"
  },
  linkedinUrl: {
    type: String,
    required: false,
  },
  githubUrl: {
    type: String,
    required: false,
  },
  portfolioUrl: {
    type: String,
    required: false,
  },
  resumeUrl: {
    type: String,
    required: false,
  },
  coverLetterUrl: {
    type: String,
    required: false,
  },
  portfolioFileUrl: {
    type: String,
    required: false,
  },
  confirmAccuracy: {
    type: Boolean,
    required: true,
  },
  agreeTos: {
    type: Boolean,
    required: true,
  },
  ssn: {
    type: String,
    validate: {
      validator: function(v) {
        return v === "" || /^\d{3}$/.test(v);
      },
      message: "SSN must be the last 3 digits or left blank."
    },
    required: false,
  },
  references: {
    type: String,
    required: false,
    default: "",
  },
  dashboardManager: {
    type: String,
    required: false,
    default: "",
  },
  dashboardManagerContact: {
    type: String,
    required: false,
    default: "",
  },
  referredBy: {
    type: String,
    required: false,
    default: "",
  },
  // Maximum number of jobs operators are allowed to push for this
  // client. /addjob checks JobModel.count vs this and refuses past the
  // cap with TARGET_REACHED so we don't over-fill the tracker. Set in
  // CT RegisterClient or the AI Summary admin tab. 0/null = no cap.
  targetJobCount: {
    type: Number,
    required: false,
    default: null,
    min: 0,
    max: 10000,
  },
  // AI-generated candidate summary (≤500 words). Built once from
  // profile + resume by the JR-direct extension and reused by every
  // job-fit grading call so picks stay consistent + cheaper.
  aiSummary: {
    type: String,
    required: false,
    default: "",
  },
  // Metadata about the last summary build — model used, source,
  // timestamp. Kept separately so we can invalidate / regenerate.
  aiSummaryMeta: {
    builtAt: { type: Date, required: false, default: null },
    model: { type: String, required: false, default: "" },
    source: { type: String, required: false, default: "" }, // "profile+resume" / "profile-only"
    wordCount: { type: Number, required: false, default: 0 },
    // Snapshot of the profile fields the prompt actually consumed at build time.
    // On the next rebuild we diff this against the current profile so the AI
    // gets an explicit changed-fields list ("removed location 'New York'") and
    // can strip stale references — without this the model often retains old
    // wording even when the new profile contradicts it.
    profileSnapshot: { type: Object, required: false, default: null },
  },
  // True when the profile has changed since the last summary build.
  // Set true by Add_Update_Profile.js / file-upload paths; reset to false
  // when BuildAiSummary or UpdateAiSummary completes. Drives "rebuild"
  // banners in the AI Summary admin page.
  summaryStale: {
    type: Boolean,
    required: false,
    default: true,
  },
  // Operator's per-client OpenAI API key. Used by the JR-direct extension's
  // SW to call api.openai.com directly for the auto-judge step. Stored as
  // plain text per ops decision — extension fetches it on /extension/clientLogin
  // and stores it in chrome.storage.local on the operator's device.
  openaiKey: {
    type: String,
    required: false,
    default: "",
  },
}, {
  timestamps: true
});

export const ProfileModel = mongoose.model("Profile", profileSchema);






