import jwt from "jsonwebtoken";
import { ActivityLog } from "../Schema_Models/ActivityLog.js";

function safeDecodeJwt(req) {
  try {
    const auth = req.headers?.authorization || "";
    if (!auth.startsWith("Bearer ")) return null;
    const token = auth.slice(7);
    return jwt.verify(
      token,
      process.env.JWT_SECRET || process.env.JWT_SECRET_KEY || "flashfire-secret-key-2024"
    );
  } catch {
    return null;
  }
}

function extractIp(req) {
  const fwd = req.headers?.["x-forwarded-for"];
  if (typeof fwd === "string" && fwd) return fwd.split(",")[0].trim();
  return req.ip || req.socket?.remoteAddress || "";
}

function actorFromReq(req, override = {}) {
  const decoded = safeDecodeJwt(req);
  const hdr = req.headers || {};
  return {
    email: (override.email || decoded?.email || hdr["x-actor-email"] || "").toString(),
    name: (override.name || decoded?.name || hdr["x-actor-name"] || "").toString(),
    role: (override.role || decoded?.role || hdr["user-role"] || hdr["x-actor-role"] || "").toString(),
    source: (override.source || hdr["x-actor-source"] || "dashboard").toString(),
  };
}

/**
 * Fire-and-forget activity logger. Never throws, never blocks the request.
 *
 * @param {import('express').Request|null} req
 * @param {{
 *   action: string,
 *   category?: string,
 *   targetType?: string,
 *   targetId?: string,
 *   targetLabel?: string,
 *   summary?: string,
 *   diff?: any,
 *   context?: any,
 *   actor?: { email?: string, name?: string, role?: string, source?: string },
 *   severity?: 'info'|'warning'|'critical'
 * }} payload
 */
export function logActivity(req, payload) {
  try {
    if (!payload || !payload.action) return;
    const doc = {
      action: payload.action,
      category: payload.category || "system",
      targetType: payload.targetType || "",
      targetId: payload.targetId ? String(payload.targetId) : "",
      targetLabel: payload.targetLabel || "",
      summary: payload.summary || "",
      diff: payload.diff ?? null,
      context: payload.context ?? null,
      severity: payload.severity || "info",
      actor: actorFromReq(req || {}, payload.actor || {}),
      ip: req ? extractIp(req) : "",
      userAgent: req?.headers?.["user-agent"]?.toString().slice(0, 512) || "",
    };
    ActivityLog.create(doc).catch((err) => {
      console.warn("[activityLogger] create failed:", err?.message || err);
    });
  } catch (err) {
    console.warn("[activityLogger] unexpected:", err?.message || err);
  }
}

/**
 * Shallow diff between two objects. Returns [{ field, before, after }].
 * Trims long strings, skips identical primitives, ignores functions.
 */
export function shallowDiff(before, after, opts = {}) {
  const out = [];
  if (!before || !after) return out;
  const maxStr = opts.maxStr || 2000;
  const skip = new Set(opts.skip || []);
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    if (skip.has(key)) continue;
    const b = before[key];
    const a = after[key];
    if (typeof b === "function" || typeof a === "function") continue;
    const bj = typeof b === "string" ? b : JSON.stringify(b ?? null);
    const aj = typeof a === "string" ? a : JSON.stringify(a ?? null);
    if (bj === aj) continue;
    const trim = (v) =>
      typeof v === "string" && v.length > maxStr ? `${v.slice(0, maxStr)}…(${v.length}b)` : v;
    out.push({ field: key, before: trim(b), after: trim(a) });
  }
  return out;
}
