// UserModel.js
import mongoose from "mongoose";
import { coverLetterSchema, optimizedResumeSchema } from "./Opt.Resumes_Cover_Schemas.js";

export const userSchema = new mongoose.Schema(
  {
    userID: { type: String, required: true, default: () => String(Date.now()) },
    name:   { type: String, required: true },
    email:  { type: String, required: true },
    passwordHashed: { type: String, required: true, default: "--NO Password --/OAUTH" },

    // Base resume (single)
    resumeLink: { type: String, default: null },

    // Plural arrays + [] defaults
    coverLetters:     { type: [coverLetterSchema],     default: [] },
    optimizedResumes: { type: [optimizedResumeSchema], default: [] },

    planType:  { type: String, required: true, default: "Free Trial" },
    planLimit: { type: Number, default: null },
    userType:  { type: String, default: "User" },
  },
  { timestamps: true }
);

export const UserModel = mongoose.model("users", userSchema);
