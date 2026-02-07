import mongoose from "mongoose";

const recruiterEmailTemplateSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    subject: { type: String, required: true },
    text: { type: String, required: true },
    attachment: {
      filename: { type: String },
      mimetype: { type: String },
      content: { type: Buffer }
    },
    createdBy: { type: String, default: "" }
  },
  { timestamps: true }
);

export const RecruiterEmailTemplate = mongoose.model("RecruiterEmailTemplate", recruiterEmailTemplateSchema);

