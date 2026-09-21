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
