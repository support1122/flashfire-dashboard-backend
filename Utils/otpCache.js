import crypto from "crypto";

const MAX_CACHE_BYTES = 5 * 1024 * 1024;
const otpCache = new Map();
let currentBytes = 0;

function byteLen(value) {
  try {
    return Buffer.byteLength(String(value || ""), "utf8");
  } catch {
    return String(value || "").length;
  }
}

function estimateEntryBytes(email, entry) {
  return (
    byteLen(email) +
    byteLen(entry.otpHash) +
    byteLen(entry.expiresAtMs) +
    byteLen(entry.attemptsLeft) +
    64
  );
}

function cleanupExpired(nowMs = Date.now()) {
  for (const [email, entry] of otpCache.entries()) {
    if (entry.expiresAtMs <= nowMs) {
      otpCache.delete(email);
      currentBytes -= entry.bytes || 0;
    }
  }
  if (currentBytes < 0) currentBytes = 0;
}

function evictToBudget() {
  while (currentBytes > MAX_CACHE_BYTES && otpCache.size > 0) {
    const oldestKey = otpCache.keys().next().value;
    const entry = otpCache.get(oldestKey);
    otpCache.delete(oldestKey);
    currentBytes -= entry?.bytes || 0;
  }
  if (currentBytes < 0) currentBytes = 0;
}

export function otpHash(email, otp) {
  return crypto
    .createHmac("sha256", process.env.OTP_SECRET || "flashfire-otp-secret")
    .update(`${email}:${otp}`)
    .digest("hex");
}

export function setOtp(email, { otpHash: hash, expiresAtMs, attemptsLeft = 5 }) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail) throw new Error("Missing email");

  cleanupExpired();

  const existing = otpCache.get(normalizedEmail);
  if (existing) {
    otpCache.delete(normalizedEmail);
    currentBytes -= existing.bytes || 0;
  }

  const entry = {
    otpHash: hash,
    expiresAtMs,
    attemptsLeft,
    createdAtMs: Date.now(),
    bytes: 0,
  };
  entry.bytes = estimateEntryBytes(normalizedEmail, entry);
  otpCache.set(normalizedEmail, entry);
  currentBytes += entry.bytes;

  evictToBudget();
  return entry;
}

export function getOtp(email) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail) return null;
  cleanupExpired();
  return otpCache.get(normalizedEmail) || null;
}

export function decrementAttempts(email) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const entry = getOtp(normalizedEmail);
  if (!entry) return null;
  entry.attemptsLeft = Math.max(0, (entry.attemptsLeft || 0) - 1);
  if (entry.attemptsLeft <= 0) {
    deleteOtp(normalizedEmail);
    return null;
  }
  return entry;
}

export function deleteOtp(email) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const entry = otpCache.get(normalizedEmail);
  if (!entry) return false;
  otpCache.delete(normalizedEmail);
  currentBytes -= entry.bytes || 0;
  if (currentBytes < 0) currentBytes = 0;
  return true;
}

export function getOtpCacheStats() {
  cleanupExpired();
  return {
    entries: otpCache.size,
    bytes: currentBytes,
    maxBytes: MAX_CACHE_BYTES,
  };
}
