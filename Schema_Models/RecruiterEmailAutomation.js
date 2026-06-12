import mongoose from "mongoose";

const recruiterEmailAutomationSchema = new mongoose.Schema(
  {
    ownerEmail: { type: String, required: true, lowercase: true, index: true },
    group: { type: mongoose.Schema.Types.ObjectId, ref: "RecruiterEmailGroup", required: true },
    template: { type: mongoose.Schema.Types.ObjectId, ref: "RecruiterEmailTemplate", required: true },
    dailyLimit: { type: Number, required: true },
    enabled: { type: Boolean, default: true },
    // When true, this user bypasses the 200-application pipeline threshold and
    // recruiter emails are sent regardless of how many jobs they've applied to.
    // Set per-user from the Operations panel ("Skip 200 limit").
    skipThreshold: { type: Boolean, default: false },
    lastRunAt: { type: Date },
    sentTo: { type: [String], default: [] }
  },
  { timestamps: true }
);

export const RecruiterEmailAutomation = mongoose.model("RecruiterEmailAutomation", recruiterEmailAutomationSchema);

