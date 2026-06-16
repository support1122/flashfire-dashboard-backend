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
    // Defaults to true so new users are never silently blocked by the threshold.
    skipThreshold: { type: Boolean, default: true },
    lastRunAt: { type: Date },
    // IST calendar day (YYYY-MM-DD) of the last send. Used as an atomic guard so
    // the nightly cron and the manual "send now" button never double-send in a day.
    lastRunDayKey: { type: String, default: null },
    sentTo: { type: [String], default: [] }
  },
  { timestamps: true }
);

export const RecruiterEmailAutomation = mongoose.model("RecruiterEmailAutomation", recruiterEmailAutomationSchema);

