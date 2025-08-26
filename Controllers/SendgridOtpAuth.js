// controllers/otpAuth.controller.js
import jwt from "jsonwebtoken";
import { OtpToken } from "../Schema_Models/OtpModelSendgrid.js";
import { ProfileModel } from "../Schema_Models/ProfileModel.js";
import { sendOtpEmail } from "../Utils/SendGridHelper.js";
import { generateOtp, hashOtp, expiryFromNow, randomHex } from "../Utils/Otp.js";

// POST /auth/request-otp
export async function requestOtpController(req, res) {
  try {
    const email = req.body.email; // already normalized by userExistsByEmail
    // Optional: clean any pending unused tokens
    await OtpToken.deleteMany({ email, purpose: "login", usedAt: { $exists: false } });

    const otp = generateOtp();
    const salt = randomHex(16);
    const otpHash = hashOtp(otp, salt);
    const minutes = Number(process.env.OTP_TTL_MINUTES || 10);

    await OtpToken.create({
      email, otpHash, salt,
      purpose: "login",
      attemptsLeft: 5,
      expiresAt: expiryFromNow(minutes),
    });

    await sendOtpEmail(email, otp, minutes);
    return res.json({ ok: true, message: "OTP sent if the email exists" });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "Could not send OTP" });
  }
}

// POST /auth/verify-otp (core) —> next() —> Tokenizer —> otpLoginRespondController
export async function verifyOtpCore(req, res, next) {
  try {
    const email = req.body.email;
    const otp   = (req.body.otp || "").trim();

    const doc = await OtpToken.findOne({
      email, purpose: "login", usedAt: { $exists: false }
    }).sort({ createdAt: -1 });

    if (!doc) return res.status(400).json({ message: "Invalid or expired code" });
    if (doc.expiresAt < new Date()) {
      await OtpToken.deleteOne({ _id: doc._id });
      return res.status(400).json({ message: "Code expired" });
    }
    if (doc.attemptsLeft <= 0) {
      return res.status(429).json({ message: "Too many attempts" });
    }

    const candidate = hashOtp(otp, doc.salt);
    if (candidate !== doc.otpHash) {
      doc.attemptsLeft -= 1;
      await doc.save();
      return res.status(400).json({ message: "Incorrect code", attemptsLeft: doc.attemptsLeft });
    }

    // mark used; prepare for Tokenizer middleware
    doc.usedAt = new Date();
    await doc.save();

    // Tokenizer expects email + existanceOfUser on req.body (you already attach it in userExistsByEmail)
    // Just continue; Tokenizer will set req.body.token
    next();
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "Verification failed" });
  }
}

// Final response after Tokenizer
export async function otpLoginRespondController(req, res) {
  try {
    const { email, existanceOfUser, token } = req.body;
    const profile = await ProfileModel.findOne({ email });

    return res.status(200).json({
      message: "Login Sucess..!",
      userDetails: {
        name: existanceOfUser.name,
        email,
        planType: existanceOfUser.planType,
        userType: existanceOfUser.userType,
        planLimit: existanceOfUser.planLimit,
        resumeLink: existanceOfUser.resumeLink,
        coverLetters: existanceOfUser.coverLetters,
        optimizedResumes: existanceOfUser.optimizedResumes,
      },
      token,
      userProfile: profile?.email ? profile : null
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Internal server error" });
  }
}
