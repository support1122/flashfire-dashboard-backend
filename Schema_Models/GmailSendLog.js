import mongoose from "mongoose";

const gmailSendLogSchema = new mongoose.Schema(
  {
    ownerEmail: { type: String, required: true, lowercase: true, index: true },
    fromEmail: { type: String, required: true },
    toEmail: { type: String, required: true },
    subject: { type: String, required: true },
    status: { type: String, required: true, enum: ["success", "failed"] },
    errorMessage: { type: String, default: null },
    source: { type: String, required: true, enum: ["manual", "automation"], default: "manual" }
  },
  { timestamps: true }
);

gmailSendLogSchema.index({ ownerEmail: 1, createdAt: -1 });

export const GmailSendLog = mongoose.model("GmailSendLog", gmailSendLogSchema);
