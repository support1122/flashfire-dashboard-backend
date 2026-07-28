import crypto from 'crypto';
import dotenv from 'dotenv';
dotenv.config();

// Account creation is not self-service: only pre-created accounts may log in,
// so the endpoint that creates them has to be gated. Callers send the shared
// key as `x-admin-key` (or `Authorization: Admin <key>`).
const timingSafeEquals = (a, b) => {
     const left = Buffer.from(String(a));
     const right = Buffer.from(String(b));
     if (left.length !== right.length) return false;
     return crypto.timingSafeEqual(left, right);
};

export default function AdminKeyVerify(req, res, next) {
     const expected = process.env.ADMIN_REGISTRATION_KEY;

     // Fail closed. An unset key must not mean "anyone may register".
     if (!expected) {
          console.error("ADMIN_REGISTRATION_KEY is not set - refusing account creation requests.");
          return res.status(503).json({
               message: "Account creation is not configured",
               code: "ADMIN_KEY_NOT_CONFIGURED"
          });
     }

     const authHeader = req.headers?.authorization || "";
     const presented =
          req.headers?.['x-admin-key'] ||
          (authHeader.startsWith('Admin ') ? authHeader.substring(6).trim() : null);

     if (!presented || !timingSafeEquals(presented, expected)) {
          console.warn(`Rejected account creation attempt for ${req.body?.email || 'unknown email'}`);
          return res.status(403).json({
               message: "Not authorised to create accounts",
               code: "ADMIN_KEY_INVALID"
          });
     }

     return next();
}
