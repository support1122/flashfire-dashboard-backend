// UserModel.js
import mongoose from "mongoose";
import { baseResumeSchema, coverLetterSchema, optimizedResumeSchema, transcriptSchema, portfolioLinkSchema } from "./Opt.Resumes_Cover_Schemas.js";

export const userSchema = new mongoose.Schema(
  {
    userID: { type: String, required: true, default: () => String(Date.now()) },
    name:   { type: String, required: true },
    email:  { type: String, required: true },
    passwordHashed: { type: String, required: true, default: "--NO Password --/OAUTH" },

    // Base resume (single)
    resumeLink: { type: [baseResumeSchema], default: [] },

    // Plural arrays + [] defaults
    coverLetters:     { type: [coverLetterSchema],     default: [] },
    optimizedResumes: { type: [optimizedResumeSchema], default: [] },
    transcript : {type : [transcriptSchema], default : []},
    portfolioLinks: { type: [portfolioLinkSchema], default: [] },
    planType:  { 
      type: String, 
      required: true, 
      default: "Free Trial",
      enum: ["Free Trial", "Prime", "Ignite", "Professional", "Executive"]
    },
    joinTime: {
      type: String,
      required: true,
      default: "in 1 week",
      enum: ["in 1 week", "in 2 week", "in 3 week", "in 4 week", "in 6-7 week"]
    },
    planLimit: { type: Number, default: null },
    userType:  { type: String, default: "User" },
    dashboardManager: { type: String, required: false, default: "" },
    removedJobsCount: { type: Number, default: 0 },
    assignedResumeId: { type: String, default: null },
    referralStatus: {
      type: String,
      enum: ["Professional", "Executive", null],
      default: null
    },
    referrals: [
      {
        name: { type: String, required: true },
        plan: {
          type: String,
          enum: ["Professional", "Executive"],
          required: true,
        },
        notes: { type: String, default: "" },
        createdAt: { type: Date, default: Date.now },
      },
    ],
    notes: {
      type: String,
      default: ""
    },
  },
  { timestamps: true }
);

export const UserModel = mongoose.model("users", userSchema);
