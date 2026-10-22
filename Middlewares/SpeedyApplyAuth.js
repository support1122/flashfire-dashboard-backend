import { verifyAuthToken, extractToken, normalizeEmail } from "../Utils/AuthToken.js";
import { SpeedyApplyAccessCode } from "../Schema_Models/SpeedyApplyAccessCode.js";
import { SPEEDYAPPLY_AUDIENCE } from "../Utils/speedyApplyAccess.js";

// Guards every /extension/speedyapply/* route except login. Accepts only tokens
// minted by /extension/speedyapply/login (audience "speedyapply"), and only
// while the access code they were signed with is still the client's current,
// unexpired code. A new code on the dashboard therefore signs every extension
// out on its next request. Dashboard and scraper-extension tokens are refused.
//
// Sets req.user = { email } and req.speedyApplyEmail (lowercased).
export default async function SpeedyApplyAuth(req, res, next) {
  const decoded = verifyAuthToken(extractToken(req), { audience: SPEEDYAPPLY_AUDIENCE });
  const email = normalizeEmail(decoded?.email);
  if (!email || !Number.isInteger(decoded?.cv)) {
    return res.status(401).json({ error: "unauthorized", message: "Sign in to SpeedyApply again." });
  }
  try {
    const code = await SpeedyApplyAccessCode.findOne({ email }).select("version expiresAt").lean();
    if (!code || code.version !== decoded.cv || code.expiresAt <= new Date()) {
      return res.status(401).json({ error: "access_code_changed", message: "The access code changed. Sign in with the new code from the dashboard." });
    }
  } catch (err) {
    console.error("[speedyapply-auth] code lookup failed:", err?.message || err);
    return res.status(503).json({ error: "auth_unavailable" });
  }
  req.user = { email };
  req.speedyApplyEmail = email;
  next();
}
