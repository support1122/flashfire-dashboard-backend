import mongoose from "mongoose";

const OtpTokenSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, index: true, lowercase: true, trim: true },
    otpHash: { type: String, required: true },
    salt: { type: String, required: true },
    purpose: { type: String, enum: ["login"], default: "login" },
    attemptsLeft: { type: Number, default: 5 },
    usedAt: { type: Date },

    // Each doc auto-expires at this timestamp
    expiresAt: {
      type: Date,
      required: true,
      index: { expires: 0 } // TTL index (expire exactly at expiresAt)
    },
  },
  { timestamps: true, collection: "otp_tokens" }
);

export const OtpToken = mongoose.model("OtpToken", OtpTokenSchema);
