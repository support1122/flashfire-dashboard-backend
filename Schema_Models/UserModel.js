// UserModel.js
import mongoose from "mongoose";
import { coverLetterSchema, optimizedResumeSchema } from "./Opt.Resumes_Cover_Schemas.js";

// Schema for undergraduate transcript (similar to resume structure)
const undergraduateTranscriptSchema = new mongoose.Schema({
  url: { type: String, required: true }, // Cloudinary URL
  uploadedAt: { type: Date, default: Date.now },
  fileName: { type: String, default: "" }
}, { _id: false });

export const userSchema = new mongoose.Schema(
  {
    userID: { type: String, required: true, default: () => String(Date.now()) },
    name:   { type: String, required: true },
    email:  { type: String, required: true },
    passwordHashed: { type: String, required: true, default: "--NO Password --/OAUTH" },

    // New fields for registration
    undergraduateTranscript: { type: undergraduateTranscriptSchema, default: null }, // PDF file storage
    gpa: { 
      type: Number, 
      required: true,
      min: 0,
      max: 4,
      validate: {
        validator: function(v) {
          return v >= 0 && v <= 4;
        },
        message: 'GPA must be between 0 and 4'
      }
    },

    // Base resume (single)
    resumeLink: { type: String, default: null },

    // Plural arrays + [] defaults
    coverLetters:     { type: [coverLetterSchema],     default: [] },
    optimizedResumes: { type: [optimizedResumeSchema], default: [] },

    planType:  { 
      type: String, 
      required: true, 
      default: "Free Trial",
      enum: ["Free Trial", "Ignite", "Professional", "Executive"]
    },
    joinTime: {
      type: String,
      required: true,
      default: "in 1 week",
      enum: ["in 1 week", "in 2 week", "in 3 week", "in 4 week", "in 6-7 week"]
    },
    planLimit: { type: Number, default: null },
    userType:  { type: String, default: "User" },
  },
  { timestamps: true }
);

export const UserModel = mongoose.model("users", userSchema);
