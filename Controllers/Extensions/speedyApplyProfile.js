// SpeedyApply profile sync — save + load a client's autofill data, keyed by the
// client identified in the JWT that /extension/clientLogin issued.
//
// Auth: the extension sends the login token as `Authorization: Bearer <jwt>`.
// The JWT payload is { email }, signed with JWT_SECRET (see clientLogin.js). We
// verify it and use that email as the owner — a client can only ever read/write
// their own SpeedyApply data, regardless of any email in the body.

import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import { SpeedyApplyProfile } from "../../Schema_Models/SpeedyApplyProfile.js";
import { uploadFile } from "../../Utils/storageService.js";
import { getPresignedUrl } from "../../Utils/r2Storage.js";

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key";

const sanitize = (s) => String(s || "").replace(/[^a-z0-9._-]/gi, "_");

// storeResume: given the resume payload the extension sends, upload its bytes to
// R2 and return the LIGHT metadata to persist (name, size, mimeType, r2Key) —
// never the base64. If R2 fails, fall back to keeping the base64 inline so the
// client never loses their resume. A metadata-only payload (already has r2Key,
// no base64) is stored unchanged.
async function storeResume(resume, email) {
  if (!resume || typeof resume !== "object") return resume;
  const base64 = typeof resume.base64 === "string" ? resume.base64 : "";
  if (!base64) return resume; // nothing new to upload (metadata-only re-save)

  try {
    const buffer = Buffer.from(base64, "base64");
    const result = await uploadFile(buffer, {
      folder: "speedyapply/resumes",
      filename: resume.name || "resume.pdf",
      contentType: resume.mimeType || "application/pdf",
      clientName: sanitize(email),
      fileType: "resume"
    });
    if (result?.key) {
      return { name: resume.name || "resume.pdf", size: resume.size || buffer.length, mimeType: resume.mimeType || "application/pdf", r2Key: result.key };
    }
    console.warn("[speedyapply] R2 upload returned no key; keeping base64 inline");
    return resume;
  } catch (e) {
    console.error("[speedyapply] R2 resume upload failed, keeping base64 inline:", e?.message || e);
    return resume; // resilient fallback
  }
}

// withResumeUrl: attach a fresh presigned download URL when the resume lives in
// R2. getPresignedUrl returns { success, url } (not a bare string), so extract
// the string; tolerate a plain string too in case that ever changes.
async function withResumeUrl(resume) {
  if (!resume || !resume.r2Key) return resume || null;
  try {
    const result = await getPresignedUrl(resume.r2Key, 3600);
    const url = typeof result === "string" ? result : result?.url;
    return url ? { ...resume, url } : resume;
  } catch (e) {
    console.warn("[speedyapply] presign failed:", e?.message || e);
    return resume;
  }
}

// clientEmailFromReq: pull + verify the Bearer token, return the lowercased
// email, or null when the token is missing/invalid/expired.
function clientEmailFromReq(req) {
  const header = req.headers?.authorization || req.headers?.Authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return null;
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const email = String(payload?.email || "").toLowerCase().trim();
    return email || null;
  } catch {
    return null;
  }
}

// GET /extension/speedyapply/profile
// Returns the saved blobs (or nulls when the client has never saved).
export async function getSpeedyApplyProfile(req, res) {
  const email = clientEmailFromReq(req);
  if (!email) return res.status(401).json({ error: "unauthorized" });

  try {
    const doc = await SpeedyApplyProfile.findOne({ clientEmail: email }).lean();
    return res.status(200).json({
      ok: true,
      email,
      exists: !!doc,
      profile: doc?.profile || null,
      settings: doc?.settings || null,
      resume: await withResumeUrl(doc?.resume || null),
      apiKey: doc?.apiKey || "",
      updatedAt: doc?.updatedAt || null
    });
  } catch (err) {
    console.error("[speedyapply] load error:", err?.message || err);
    return res.status(500).json({ error: "load_failed" });
  }
}

// POST /extension/speedyapply/profile
// Body: { profile?, settings?, resume? } — any subset. Only the provided keys
// are written, so a settings-only save never wipes the stored profile/resume.
export async function saveSpeedyApplyProfile(req, res) {
  const email = clientEmailFromReq(req);
  if (!email) return res.status(401).json({ error: "unauthorized" });

  const { profile, settings, resume, apiKey } = req.body || {};
  if (profile === undefined && settings === undefined && resume === undefined && apiKey === undefined) {
    return res.status(400).json({ error: "nothing_to_save" });
  }

  const set = { clientEmail: email, updatedAt: new Date() };
  if (profile !== undefined) set.profile = profile;
  if (settings !== undefined) set.settings = settings;
  if (resume !== undefined) set.resume = resume === null ? null : await storeResume(resume, email);
  if (apiKey !== undefined) set.apiKey = apiKey;

  try {
    const doc = await SpeedyApplyProfile.findOneAndUpdate(
      { clientEmail: email },
      { $set: set },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();
    return res.status(200).json({ ok: true, email, updatedAt: doc?.updatedAt || null });
  } catch (err) {
    console.error("[speedyapply] save error:", err?.message || err);
    return res.status(500).json({ error: "save_failed" });
  }
}
