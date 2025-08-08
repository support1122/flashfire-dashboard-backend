// Opt.Resumes_Cover_Schemas.js
import mongoose from "mongoose";

const baseEntry = {
  // Canonical fields
  url:        { type: String, required: true },
  companyName:{ type: String, default: "" },
  jobRole:    { type: String, default: "" },
  jobId:      { type: String, default: "" },
  jobLink:    { type: String, default: "" },
  createdAt:  { type: Date,   default: Date.now },

  // Legacy (optional) – if provided, we'll map them into url
  optimizedResumeLink: { type: String },
  coverLetterLink:     { type: String },
};

export const optimizedResumeSchema = new mongoose.Schema(baseEntry, { _id: false });
export const coverLetterSchema     = new mongoose.Schema(baseEntry, { _id: false });

// Normalize legacy -> url
function ensureUrl(next) {
  // @ts-ignore
  if (!this.url) {
    // @ts-ignore
    this.url = this.optimizedResumeLink || this.coverLetterLink || this.url;
  }
  next();
}
optimizedResumeSchema.pre("validate", ensureUrl);
coverLetterSchema.pre("validate", ensureUrl);
