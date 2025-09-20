// Opt.Resumes_Cover_Schemas.js 
import mongoose from "mongoose";

const baseEntry = {
  url:        { type: String, required: true },
  name: {type: String , required : true, default : ''},
  companyName:{ type: String, default: "" },
  jobRole:    { type: String, default: "" },
  jobId:      { type: String, default: "" },
  jobLink:    { type: String, default: "" },
  createdAt:  { type: Date,   default: Date.now },

  // Legacy (optional) – if provided, we'll map them into url
  optimizedResumeLink: { type: String },
  coverLetterLink:     { type: String },
};

const baseResume = {
  name:      { type: String, required: true, default: "Untitled Resume" },
  link:      { type: String, required: true },
  createdAt: { type: Date,   default: Date.now },
};
const transcript = {
  name:      { type: String, required: true, default: "Untitled Transcript" },
  url:      { type: String, required: true },
  createdAt: { type: Date,   default: Date.now },
}

export const optimizedResumeSchema = new mongoose.Schema(baseEntry, { _id: false });
export const coverLetterSchema     = new mongoose.Schema(baseEntry, { _id: false });
export const baseResumeSchema      = new mongoose.Schema(baseResume, { _id: false });
export const transcriptSchema = new mongoose.Schema(transcript, {_id: false});

// Normalize legacy -> url
function ensureUrl(next) {
  if (!this.url) {
    this.url = this.optimizedResumeLink || this.coverLetterLink || this.url;
  }
  next();
}
optimizedResumeSchema.pre("validate", ensureUrl);
coverLetterSchema.pre("validate", ensureUrl);
