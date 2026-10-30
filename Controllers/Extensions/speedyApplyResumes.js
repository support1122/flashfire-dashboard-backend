// SpeedyApply: attach a job card's optimized resume instead of the base resume.
//
//   GET /extension/speedyapply/optimized-resumes?q=&url=
//       The client's job cards that have an optimized resume, newest first.
//       `q` searches job title and company (every word must match one of them).
//       `url` is the page being applied on; the job card saved with that link
//       comes back as `match`, so the sidebar can offer it without a search.
//   GET /extension/speedyapply/optimized-resumes/:jobId/pdf
//       That resume as the PDF the job card downloads (application/pdf).
//       X-Resume-Pages / -Scale / -Fits / -Medical describe what was built.
//
// Both run behind SpeedyApplyAuth. The owner is req.speedyApplyEmail, so a
// job id that belongs to another client is a plain 404.
//
// The PDF is built by the same PDF server the dashboard uses
// (PDF_SERVER_URL, default https://pdf-resume-pro.onrender.com) with the job
// card's section rules and an automatic scale. See Utils/optimizedResumePdf.js.

import crypto from "node:crypto";
import { JobModel } from "../../Schema_Models/JobModel.js";
import { UserModel } from "../../Schema_Models/UserModel.js";
import { applicationPageLinkKeys } from "../../Utils/jobLinkKey.js";
import { loadOptimizedResumeData } from "../../Utils/optimizedResumeData.js";
import {
  buildPdfPayload,
  countPdfPages,
  findBestScale,
  isMedicalResume,
  parseOptimizedAt,
  resumePdfFilename,
  targetPages,
} from "../../Utils/optimizedResumePdf.js";
import { createLoginLimiter } from "../../Utils/speedyApplyAccess.js";

const DEFAULT_PDF_SERVER_URL = "https://pdf-resume-pro.onrender.com";
// Render's free tier can take most of a minute to wake the PDF server.
const PDF_TIMEOUT_MS = 60_000;

const LIST_LIMIT = 50;
// Rows read before sorting by optimize date. The date is stored as text, so
// Mongo cannot sort on it; the newest 300 job cards always hold the newest 50.
const SCAN_LIMIT = 300;
const LIST_FIELDS = "jobTitle companyName joblink currentStatus optimizedResume.createdAt optimizedResume.version";

// A built PDF is reused while the resume behind it is unchanged: the cache key
// is a hash of the PDF server request minus the scale.
const CACHE_MAX = 40;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const cache = new Map();
const inFlight = new Map();

// Each uncached build costs up to about 7 PDF server renders, so builds are
// limited per client: 30 in 10 minutes is far above a person applying.
const builds = createLoginLimiter({ max: 30, windowMs: 10 * 60 * 1000 });

class PdfServerError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const pdfServerUrl = () => (process.env.PDF_SERVER_URL || DEFAULT_PDF_SERVER_URL).replace(/\/+$/, "");

// Jobs are filed under the account's email as it was typed at signup, which
// can differ in case from the lowercased email in the SpeedyApply token.
async function accountEmails(email) {
  const user =
    (await UserModel.findOne({ email }).select("email").lean()) ||
    (await UserModel.findOne({ email: { $regex: new RegExp(`^${escapeRegex(email)}$`, "i") } }).select("email").lean());
  return [...new Set([email, user?.email].filter(Boolean))];
}

function toItem(job) {
  const o = job.optimizedResume || {};
  return {
    id: String(job._id),
    jobTitle: job.jobTitle || "",
    companyName: job.companyName || "",
    jobLink: job.joblink || "",
    status: job.currentStatus || "",
    optimizedAt: parseOptimizedAt(o.createdAt) || job._id.getTimestamp().toISOString(),
    medical: isMedicalResume(o, null),
  };
}

// GET /extension/speedyapply/optimized-resumes
export async function listSpeedyApplyOptimizedResumes(req, res) {
  const email = req.speedyApplyEmail;
  if (!email) return res.status(401).json({ error: "unauthorized" });
  const words = String(req.query.q || "").trim().slice(0, 100).split(/\s+/).filter(Boolean).slice(0, 6);
  const pageUrl = String(req.query.url || "").slice(0, 2000);

  try {
    const emails = await accountEmails(email);
    const base = { userID: { $in: emails }, "optimizedResume.hasResume": true };
    const filter = { ...base };
    if (words.length) {
      filter.$and = words.map((w) => {
        const rx = new RegExp(escapeRegex(w), "i");
        return { $or: [{ jobTitle: rx }, { companyName: rx }] };
      });
    }
    const keys = pageUrl ? applicationPageLinkKeys(pageUrl) : [];
    const [rows, matched] = await Promise.all([
      JobModel.find(filter).select(LIST_FIELDS).sort({ _id: -1 }).limit(SCAN_LIMIT).lean(),
      keys.length
        ? JobModel.find({ ...base, joblinkKey: { $in: keys } }).select(LIST_FIELDS).sort({ _id: -1 }).limit(1).lean()
        : [],
    ]);
    const resumes = rows
      .map(toItem)
      .sort((a, b) => (a.optimizedAt < b.optimizedAt ? 1 : a.optimizedAt > b.optimizedAt ? -1 : 0))
      .slice(0, LIST_LIMIT);
    res.set("Cache-Control", "no-store");
    return res.status(200).json({ ok: true, resumes, match: matched[0] ? toItem(matched[0]) : null });
  } catch (err) {
    console.error("[speedyapply-resumes] list failed:", err?.message || err);
    return res.status(500).json({ error: "list_failed", message: "Could not load the job cards. Try again." });
  }
}

async function renderPdf(payload) {
  let resp;
  try {
    resp = await fetch(`${pdfServerUrl()}/v1/generate-pdf`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(PDF_TIMEOUT_MS),
    });
  } catch (err) {
    if (err?.name === "TimeoutError" || err?.name === "AbortError") {
      throw new PdfServerError(504, "pdf_timeout", "The PDF server took too long. Try again in a minute.");
    }
    console.error("[speedyapply-resumes] PDF server unreachable:", err?.message || err);
    throw new PdfServerError(502, "pdf_failed", "The PDF server is not reachable. Try again in a minute.");
  }
  if (!resp.ok) {
    const detail = (await resp.text().catch(() => "")).slice(0, 300);
    console.error(`[speedyapply-resumes] PDF server HTTP ${resp.status}: ${detail}`);
    throw new PdfServerError(502, "pdf_failed", "The PDF server could not build this resume. Open it on the dashboard to check it.");
  }
  const pdf = Buffer.from(await resp.arrayBuffer());
  if (!pdf.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
    throw new PdfServerError(502, "pdf_failed", "The PDF server sent back something that is not a PDF.");
  }
  return { pdf, pages: countPdfPages(pdf) };
}

function cached(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  cache.delete(key); // re-insert so the Map's order stays least-recently-used first
  cache.set(key, hit);
  return hit.built;
}

function remember(key, built) {
  cache.set(key, { at: Date.now(), built });
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
}

// GET /extension/speedyapply/optimized-resumes/:jobId/pdf
export async function getSpeedyApplyOptimizedResumePdf(req, res) {
  const email = req.speedyApplyEmail;
  if (!email) return res.status(401).json({ error: "unauthorized" });
  const jobId = String(req.params.jobId || "");
  if (!/^[0-9a-f]{24}$/i.test(jobId)) {
    return res.status(400).json({ error: "bad_job_id", message: "That is not a job card id." });
  }

  try {
    const emails = await accountEmails(email);
    const job = await JobModel.findOne({ _id: jobId, userID: { $in: emails }, "optimizedResume.hasResume": true })
      .select("optimizedResume")
      .lean();
    if (!job) {
      return res.status(404).json({ error: "not_found", message: "That job card has no optimized resume." });
    }

    const loaded = await loadOptimizedResumeData(job.optimizedResume);
    if (!loaded.ok) {
      console.error(`[speedyapply-resumes] resume JSON ${loaded.reason} for job ${jobId}`);
      return loaded.reason === "missing"
        ? res.status(404).json({ error: "resume_missing", message: "This job card's resume was never saved. Optimize it again on the dashboard." })
        : res.status(502).json({ error: "storage_failed", message: "Could not read the resume from storage. Try again." });
    }

    const medical = isMedicalResume(job.optimizedResume, loaded.data);
    const payloadFor = (scale) => buildPdfPayload({ optimizedResume: job.optimizedResume, resumeData: loaded.data, medical, scale });
    const key = crypto.createHash("sha256").update(JSON.stringify(payloadFor(0))).digest("hex");

    let built = cached(key);
    if (!built) {
      let pending = inFlight.get(key);
      if (!pending) {
        const wait = builds.check(email);
        if (wait) {
          res.set("Retry-After", String(wait));
          return res.status(429).json({ error: "rate_limited", retryAfter: wait, message: `Too many resumes built. Try again in ${Math.ceil(wait / 60)} min.` });
        }
        builds.fail(email); // records the build; the limiter counts any event
        pending = findBestScale((scale) => renderPdf(payloadFor(scale)), targetPages(medical));
        inFlight.set(key, pending);
        pending.then((b) => remember(key, b), () => {}).finally(() => inFlight.delete(key));
      }
      built = await pending;
    }

    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${resumePdfFilename(loaded.data)}"`,
      "Cache-Control": "private, no-store",
      "X-Resume-Pages": built.pages === null ? "" : String(built.pages),
      "X-Resume-Scale": String(built.scale),
      "X-Resume-Fits": built.fits === null ? "unknown" : built.fits ? "yes" : "no",
      "X-Resume-Medical": medical ? "1" : "0",
    });
    return res.status(200).send(built.pdf);
  } catch (err) {
    if (err instanceof PdfServerError) {
      return res.status(err.status).json({ error: err.code, message: err.message });
    }
    console.error(`[speedyapply-resumes] PDF for job ${jobId} failed:`, err?.message || err);
    return res.status(500).json({ error: "pdf_failed", message: "Could not build the resume PDF." });
  }
}
