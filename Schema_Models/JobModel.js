import mongoose from "mongoose";

export const JobSchema = new mongoose.Schema({
  jobID: { type: String, default: () => Date.now().toString(), index: true },
  userID: { type: String, required: true },
  jobTitle: { type: String, required: true },
  currentStatus: { type: String, default: "saved" },
  jobDescription: { type: mongoose.Schema.Types.Mixed, required: true }, // store rich object
  joblink: { type: String, required: true },
  companyName: { type: String, required: true },
  timeline: { type: [String], default: ["Added"] },
  attachments: { type: [String], default: [] }
}, { timestamps: true });

JobSchema.index({ userID: 1, joblink: 1 }, { unique: true });

export const JobModel = mongoose.model("JobDB", JobSchema);
