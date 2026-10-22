// SpeedyApply access code: issue it to the dashboard, check it at extension login.
//
//   GET  /speedyapply/access-code           (LocalTokenValidator) current code, issued on first view
//   POST /speedyapply/access-code/rotate    (LocalTokenValidator) new code now, ends every extension session
//        Both are operator-only: the token must be a client session opened from
//        Operations (via: "operations"). A client's own login gets 403.
//   POST /extension/speedyapply/login       { email, password, code } -> { token, userDetails, codeExpiresAt }
//
// The rules (alphabet, 30-day life, compare, limiter) are in Utils/speedyApplyAccess.js.

import { SpeedyApplyAccessCode } from "../../Schema_Models/SpeedyApplyAccessCode.js";
import { UserModel } from "../../Schema_Models/UserModel.js";
import { encrypt, decrypt } from "../../Utils/CryptoHelper.js";
import { signAuthToken, normalizeEmail, isOperatorView } from "../../Utils/AuthToken.js";
import {
  SPEEDYAPPLY_AUDIENCE,
  ACCESS_CODE_TTL_MS,
  generateAccessCode,
  accessCodesMatch,
  secretsMatch,
  sessionSeconds,
  createLoginLimiter,
} from "../../Utils/speedyApplyAccess.js";

// 8 wrong tries per email (any IP) or 30 per IP (any email) in 15 minutes.
const LIMIT_WINDOW_MS = 15 * 60 * 1000;
const byEmail = createLoginLimiter({ max: 8, windowMs: LIMIT_WINDOW_MS });
const byIp = createLoginLimiter({ max: 30, windowMs: LIMIT_WINDOW_MS });

const WRONG = "Wrong email, password or access code. The access code is on the client's FlashFire dashboard.";

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// The client's current code doc, issuing a new one when there is none, it has
// expired, or `forceNew` is set. Two dashboard tabs racing on an expired code
// both end up with the same new code: the update only applies to the version
// that was read, and the loser re-reads the winner's.
export async function currentAccessCode(email, { forceNew = false } = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const now = new Date();
    const doc = await SpeedyApplyAccessCode.findOne({ email }).lean();
    if (doc && !forceNew && doc.expiresAt > now) return doc;

    const fields = {
      codeEnc: encrypt(generateAccessCode()),
      issuedAt: now,
      expiresAt: new Date(now.getTime() + ACCESS_CODE_TTL_MS),
    };
    try {
      const next = doc
        ? await SpeedyApplyAccessCode.findOneAndUpdate(
            { email, version: doc.version },
            { $set: fields, $inc: { version: 1 } },
            { new: true, lean: true }
          )
        : (await SpeedyApplyAccessCode.create({ email, version: 1, ...fields })).toObject();
      if (next) return next;
    } catch (err) {
      if (err?.code !== 11000) throw err; // a parallel first issue won the insert
    }
    forceNew = false; // someone else just issued one; use theirs
  }
  throw new Error("access_code_contention");
}

function publicCode(doc) {
  return { code: decrypt(doc.codeEnc), issuedAt: doc.issuedAt, expiresAt: doc.expiresAt, version: doc.version };
}

// The client email when an operator is looking at that client, else sends the
// refusal and returns null.
function operatorClientEmail(req, res) {
  const email = normalizeEmail(req.authEmail);
  if (!email) {
    res.status(401).json({ error: "unauthorized" });
    return null;
  }
  if (!isOperatorView(req.user)) {
    res.status(403).json({ error: "operators_only" });
    return null;
  }
  return email;
}

// GET /speedyapply/access-code
export async function getSpeedyApplyAccessCode(req, res) {
  const email = operatorClientEmail(req, res);
  if (!email) return;
  try {
    const doc = await currentAccessCode(email);
    res.set("Cache-Control", "no-store");
    return res.status(200).json({ ok: true, ...publicCode(doc) });
  } catch (err) {
    console.error("[speedyapply-access] load failed:", err?.message || err);
    return res.status(500).json({ error: "access_code_failed" });
  }
}

// POST /speedyapply/access-code/rotate
export async function rotateSpeedyApplyAccessCode(req, res) {
  const email = operatorClientEmail(req, res);
  if (!email) return;
  try {
    const doc = await currentAccessCode(email, { forceNew: true });
    res.set("Cache-Control", "no-store");
    return res.status(200).json({ ok: true, ...publicCode(doc) });
  } catch (err) {
    console.error("[speedyapply-access] rotate failed:", err?.message || err);
    return res.status(500).json({ error: "access_code_failed" });
  }
}

// POST /extension/speedyapply/login
// Every wrong combination gets the same 401 and message, so the endpoint does
// not reveal which emails have accounts or which part was wrong.
export async function speedyApplyLogin(req, res) {
  const email = normalizeEmail(req.body?.email);
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const code = typeof req.body?.code === "string" ? req.body.code : "";
  if (!email || !password || !code) {
    return res.status(400).json({ error: "missing_fields", message: "Email, password and access code are required." });
  }

  const ip = String(req.ip || req.socket?.remoteAddress || "unknown");
  const wait = Math.max(byEmail.check(email), byIp.check(ip));
  if (wait) {
    res.set("Retry-After", String(wait));
    return res.status(429).json({ error: "rate_limited", retryAfter: wait, message: `Too many wrong tries. Try again in ${Math.ceil(wait / 60)} min.` });
  }
  const refuse = () => {
    byEmail.fail(email);
    byIp.fail(ip);
    return res.status(401).json({ error: "invalid_credentials", message: WRONG });
  };

  try {
    const user = await UserModel.findOne({ email }).lean() ||
      await UserModel.findOne({ email: { $regex: new RegExp(`^${escapeRegex(email)}$`, "i") } }).lean();
    if (!user?.passwordHashed) return refuse();

    let stored;
    try {
      stored = decrypt(user.passwordHashed);
    } catch (err) {
      console.warn("[speedyapply-access] password decrypt failed for a login:", err?.message || err);
      return refuse();
    }
    if (!secretsMatch(password, stored)) return refuse();

    // Never issue a code here: only the dashboard hands codes out.
    const codeDoc = await SpeedyApplyAccessCode.findOne({ email }).lean();
    if (!codeDoc || codeDoc.expiresAt <= new Date()) return refuse();
    let current;
    try {
      current = decrypt(codeDoc.codeEnc);
    } catch (err) {
      console.error("[speedyapply-access] code decrypt failed:", err?.message || err);
      return res.status(500).json({ error: "login_failed", message: "Login failed on the server." });
    }
    if (!accessCodesMatch(code, current)) return refuse();

    byEmail.reset(email);
    const token = signAuthToken(
      { email, aud: SPEEDYAPPLY_AUDIENCE, cv: codeDoc.version },
      { expiresIn: sessionSeconds(codeDoc.expiresAt) }
    );
    return res.status(200).json({
      ok: true,
      token,
      userDetails: { name: user.name || "", email },
      codeExpiresAt: codeDoc.expiresAt,
    });
  } catch (err) {
    console.error("[speedyapply-access] login error:", err?.message || err);
    return res.status(500).json({ error: "login_failed", message: "Login failed on the server." });
  }
}
