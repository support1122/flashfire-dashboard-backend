import mongoose from "mongoose";

const GmailUserSchema = new mongoose.Schema(
  {
    email: { type: String, unique: true, lowercase: true },
    refreshToken: { type: String, required: true },
    ownerEmail: { type: String, lowercase: true },
    createdAt: { type: Date, default: Date.now }
  },
  {
    collection: "gmailusers"
  }
);

export const GmailUser = mongoose.model("GmailUser", GmailUserSchema);

