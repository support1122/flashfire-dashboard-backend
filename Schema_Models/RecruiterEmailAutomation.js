import mongoose from "mongoose";

const recruiterEmailAutomationSchema = new mongoose.Schema(
  {
    ownerEmail: { type: String, required: true, lowercase: true, index: true },
    group: { type: mongoose.Schema.Types.ObjectId, ref: "RecruiterEmailGroup", required: true },
    template: { type: mongoose.Schema.Types.ObjectId, ref: "RecruiterEmailTemplate", required: true },
    dailyLimit: { type: Number, required: true },
    enabled: { type: Boolean, default: true },
    lastRunAt: { type: Date },
    sentTo: { type: [String], default: [] }
  },
  { timestamps: true }
);

export const RecruiterEmailAutomation = mongoose.model("RecruiterEmailAutomation", recruiterEmailAutomationSchema);

