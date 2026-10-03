import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
dotenv.config();

// Historically two different secrets were in play: password login signed with
// JWT_SECRET_KEY while LocalTokenValidator verified with JWT_SECRET, so
// password-issued tokens never passed validation. Everything now signs with
// JWT_SECRET, and verification still accepts JWT_SECRET_KEY so sessions that
// were issued before this change keep working until they expire.
const PRIMARY_SECRET = process.env.JWT_SECRET || 'flashfire-secret-key-2024';
const LEGACY_SECRET = process.env.JWT_SECRET_KEY || 'FLASHFIRE';

export const normalizeEmail = (email) => String(email || "").trim().toLowerCase();

/**
 * How long a CLIENT stays signed in on the portal.
 *
 * Clients open portal.flashfirejobs.com every week or two to look at their
 * applications, not every day, so a 7-day token logged most of them out between
 * visits. The browser keeps the session in localStorage indefinitely; the JWT
 * expiry is the thing that actually ends it, so this is the number that matters.
 *
 * It is a sliding window, not a hard 30 days. The portal refreshes the token on
 * load and every five minutes (UserContext), so anyone who visits inside the
 * window rolls forward and only 30 days of genuine absence signs them out.
 */
export const CLIENT_SESSION_EXPIRY = '30d';

/**
 * Operators are deliberately NOT on CLIENT_SESSION_EXPIRY. Their session reaches
 * every client's data from a shared office machine, so it keeps the shorter
 * default. Operator-minted client tokens (Controllers/operations/GetUserDetails)
 * pass an even shorter explicit 24h and are unaffected by either.
 */
export function signAuthToken(payload, options = {}) {
     return jwt.sign(payload, PRIMARY_SECRET, { expiresIn: '7d', ...options });
}

// Returns the decoded payload, or null when the token is missing/invalid/expired
// under both secrets.
export function verifyAuthToken(token, options = {}) {
     if (!token || typeof token !== 'string') return null;

     for (const secret of [PRIMARY_SECRET, LEGACY_SECRET]) {
          try {
               return jwt.verify(token, secret, options);
          } catch (err) {
               // An expired token is expired under either secret - stop early so
               // the caller gets a truthful "expired" rather than "malformed".
               if (err?.name === 'TokenExpiredError') return null;
          }
     }
     return null;
}

// Pulls the bearer token from the Authorization header, falling back to the
// body field the older frontend calls still send.
export function extractToken(req) {
     const authHeader = req?.headers?.authorization;
     if (authHeader && authHeader.startsWith('Bearer ')) {
          return authHeader.substring(7).trim();
     }
     return typeof req?.body?.token === 'string' ? req.body.token.trim() : null;
}
