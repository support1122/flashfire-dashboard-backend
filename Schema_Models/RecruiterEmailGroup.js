import mongoose from "mongoose";

const recruiterEmailGroupSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    category: { type: String, default: "custom", trim: true },
    description: { type: String, default: "" },
    emails: { type: [String], default: [] },
    createdBy: { type: String, default: "" }
  },
  { timestamps: true }
);

export const RecruiterEmailGroup = mongoose.model("RecruiterEmailGroup", recruiterEmailGroupSchema);

