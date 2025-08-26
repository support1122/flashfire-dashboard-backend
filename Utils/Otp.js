import crypto from "node:crypto";

export function generateOtp() {
  // cryptographically-strong 6-digit code
  return (crypto.randomInt(0, 1_000_000) + "").padStart(6, "0");
}

export function randomHex(bytes = 16) {
  return crypto.randomBytes(bytes).toString("hex");
}

export function hashOtp(otp, salt) {
  return crypto.createHash("sha256").update(otp + salt).digest("hex");
}

export function expiryFromNow(minutes = 10) {
  return new Date(Date.now() + minutes * 60 * 1000);
}
