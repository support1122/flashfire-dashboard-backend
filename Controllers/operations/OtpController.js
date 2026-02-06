import Operations from "../../Schema_Models/Operations.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import {
  setOtp,
  getOtp,
  deleteOtp,
  decrementAttempts,
  getOtpCacheStats,
  otpHash,
} from "../../Utils/otpCache.js";
import { sendDashboardOtpEmail } from "../../Utils/sendDashboardOtpEmail.js";

function generateFourDigitOtp() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function isValidEmail(email) {
  if (!email || typeof email !== "string") return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim().toLowerCase());
}

function isValidOperatorEmail(email) {
  if (!email || typeof email !== "string") return false;
  const e = email.trim().toLowerCase();
  if (e.endsWith("@flashfirehq")) return true;
  return isValidEmail(e);
}

export async function requestDashboardOtp(req, res) {
  try {
    const { email, password } = req.body;
    const normalizedEmail = normalizeEmail(email);

    if (!normalizedEmail || !isValidOperatorEmail(normalizedEmail)) {
      return res.status(400).json({ success: false, error: "Invalid email" });
    }
    if (!password) {
      return res.status(400).json({ success: false, error: "Password required" });
    }

    if (!normalizedEmail.endsWith("@flashfirehq")) {
      return res.status(200).json({
        success: true,
        message: "If your email is authorized, you will receive an OTP.",
      });
    }

    const opUser = await Operations.findOne({ email: normalizedEmail }).lean();
    if (!opUser) {
      return res.status(200).json({
        success: true,
        message: "If your email is authorized, you will receive an OTP.",
      });
    }

    const isMatch = await bcrypt.compare(password, opUser.password);
    if (!isMatch) {
      return res.status(200).json({
        success: true,
        message: "If your email is authorized, you will receive an OTP.",
      });
    }

    const otpEmail = opUser.otpEmail || normalizedEmail;
    if (!otpEmail || !isValidEmail(otpEmail)) {
      return res.status(400).json({
        success: false,
        error: "OTP email not configured for this account. Contact your admin.",
      });
    }

    const otp = generateFourDigitOtp();
    const ttlSeconds = 300;
    const expiresAtMs = Date.now() + ttlSeconds * 1000;
    setOtp(normalizedEmail, {
      otpHash: otpHash(normalizedEmail, otp),
      expiresAtMs,
      attemptsLeft: 5,
    });

    await sendDashboardOtpEmail(otpEmail, otp, opUser.name);

    return res.status(200).json({
      success: true,
      message: "OTP sent",
      cache: getOtpCacheStats(),
    });
  } catch (error) {
    console.error("Dashboard OTP request error:", error?.message || error);
    return res.status(500).json({ success: false, error: "Server error" });
  }
}

export async function verifyDashboardOtp(req, res) {
  try {
    const { email, otp } = req.body;
    const normalizedEmail = normalizeEmail(email);

    if (!normalizedEmail || !otp) {
      return res.status(400).json({ success: false, error: "Email and OTP required" });
    }

    const entry = getOtp(normalizedEmail);
    if (!entry) {
      return res.status(400).json({ success: false, error: "Invalid or expired OTP" });
    }

    const inputHash = otpHash(normalizedEmail, String(otp).trim());
    if (entry.otpHash !== inputHash) {
      decrementAttempts(normalizedEmail);
      return res.status(400).json({ success: false, error: "Invalid OTP" });
    }

    deleteOtp(normalizedEmail);

    const secret = process.env.JWT_SECRET_KEY || process.env.JWT_SECRET || "FLASHFIRE";
    const trustToken = jwt.sign(
      { email: normalizedEmail, purpose: "otp-trust" },
      secret,
      { expiresIn: "30d" }
    );

    return res.status(200).json({
      success: true,
      message: "OTP verified",
      trustToken,
      expiresIn: "30d",
    });
  } catch (error) {
    console.error("Dashboard OTP verify error:", error?.message || error);
    return res.status(500).json({ success: false, error: "Server error" });
  }
}

export async function validateOtpTrust(req, res) {
  try {
    const { email, trustToken } = req.body;
    const normalizedEmail = normalizeEmail(email);

    if (!normalizedEmail || !trustToken) {
      return res.status(400).json({ success: false, valid: false });
    }

    const secret = process.env.JWT_SECRET_KEY || process.env.JWT_SECRET || "FLASHFIRE";
    let decoded;
    try {
      decoded = jwt.verify(trustToken, secret);
    } catch {
      return res.status(200).json({ success: true, valid: false });
    }

    if (decoded.purpose !== "otp-trust" || decoded.email !== normalizedEmail) {
      return res.status(200).json({ success: true, valid: false });
    }

    return res.status(200).json({ success: true, valid: true });
  } catch (error) {
    console.error("Validate OTP trust error:", error?.message || error);
    return res.status(500).json({ success: false, valid: false });
  }
}
