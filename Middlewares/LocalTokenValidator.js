import { verifyAuthToken, extractToken, normalizeEmail } from '../Utils/AuthToken.js'
import dotenv from 'dotenv'
dotenv.config();

export default async function LocalTokenValidator(req, res, next) {
    const token = extractToken(req);

    if (!token) {
        return res.status(401).json({ message: "Authentication required", code: "MISSING_TOKEN" });
    }

    const decoded = verifyAuthToken(token);
    if (!decoded?.email) {
        return res.status(403).json({ message: "Invalid token or expired", code: "INVALID_TOKEN" });
    }

    // The token carries the account's canonical spelling (login signs
    // UserModel.email verbatim). Compare case-insensitively, but hand the
    // canonical form downstream - GetProfile and friends match email exactly,
    // so lowercasing here would make a profile invisible to its own lookup.
    const canonicalEmail = String(decoded.email).trim();
    const tokenEmail = normalizeEmail(canonicalEmail);

    // Callers may also send userDetails in the body. When they do it has to be
    // the same identity the token proves - it is never a substitute for it.
    const claimedEmail = normalizeEmail(req.body?.userDetails?.email);
    if (claimedEmail && claimedEmail !== tokenEmail) {
        return res.status(403).json({ message: "Token does not match the requested account", code: "EMAIL_MISMATCH" });
    }

    req.user = decoded;
    // Downstream controllers read req.userDetails; keep the body's richer object
    // when present, but always pin the email to the verified one.
    req.userDetails = { ...(req.body?.userDetails || {}), email: canonicalEmail };
    req.authEmail = tokenEmail;        // normalized - for comparisons
    req.authEmailCanonical = canonicalEmail; // as stored - for queries
    next();
}
