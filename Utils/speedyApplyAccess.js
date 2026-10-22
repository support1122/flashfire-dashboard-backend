import crypto from "crypto";

// SpeedyApply sign-in needs three things: the client's dashboard email, their
// password, and the access code shown on their FlashFire dashboard. The code is
// the part a leaked password alone cannot supply. It lives 30 days, then the
// dashboard issues a new one on its next view, and every extension session
// signed with the old code stops working (see Middlewares/SpeedyApplyAuth.js).
//
// Everything here is pure so it can be tested without a database.

export const SPEEDYAPPLY_AUDIENCE = "speedyapply";
export const ACCESS_CODE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// No 0/O, 1/I/L: the team reads these codes off a screen and types them.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;

// "K7QM-4XZP". 31^8 is about 8.5e11 codes, and login is rate limited.
export function generateAccessCode() {
  let raw = "";
  for (let i = 0; i < CODE_LENGTH; i++) raw += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

// What the person typed, reduced to the 8 code characters. Case, spaces and the
// dash do not matter. Returns "" when it cannot be a code.
export function normalizeAccessCode(input) {
  const s = String(input || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return s.length === CODE_LENGTH ? s : "";
}

// Constant-time compare of two secrets of any length. Hashing first gives both
// sides the same length, which timingSafeEqual requires.
export function secretsMatch(a, b) {
  const ha = crypto.createHash("sha256").update(String(a ?? "")).digest();
  const hb = crypto.createHash("sha256").update(String(b ?? "")).digest();
  return crypto.timingSafeEqual(ha, hb);
}

export function accessCodesMatch(typed, stored) {
  const t = normalizeAccessCode(typed);
  const s = normalizeAccessCode(stored);
  return !!t && !!s && secretsMatch(t, s);
}

// Whole seconds an extension session may last: until the code it was signed
// with expires. Never below one minute, so a login in the code's last seconds
// still gets a usable token instead of one that is already dead.
export function sessionSeconds(expiresAt, now = Date.now()) {
  const left = Math.floor((new Date(expiresAt).getTime() - now) / 1000);
  return Number.isFinite(left) ? Math.max(60, left) : 60;
}

// Failed-login counter. In-memory is fine for one PM2 process: a restart only
// resets the window. `check` returns the seconds to wait (0 = go ahead).
export function createLoginLimiter({ max, windowMs }) {
  const fails = new Map();
  const live = (key, now) => (fails.get(key) || []).filter((t) => now - t < windowMs);
  return {
    check(key, now = Date.now()) {
      const hits = live(key, now);
      if (hits.length) fails.set(key, hits); else fails.delete(key);
      return hits.length >= max ? Math.ceil((windowMs - (now - hits[0])) / 1000) : 0;
    },
    fail(key, now = Date.now()) {
      const hits = live(key, now);
      hits.push(now);
      fails.set(key, hits);
    },
    reset(key) {
      fails.delete(key);
    },
  };
}
