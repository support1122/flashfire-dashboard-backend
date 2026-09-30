import mongoose from "mongoose";
import { JobApiSettings } from "../Schema_Models/JobApiSettings.js";
import { ProfileModel } from "../Schema_Models/ProfileModel.js";
import { JobModel } from "../Schema_Models/JobModel.js";
import { UserModel } from "../Schema_Models/UserModel.js";
import { fetchPage, mapJob, adzunaCredentials, searchLadder } from "../Utils/adzunaClient.js";
import { judgeJobs } from "../Utils/apiJudge.js";
import { checkCap } from "../Utils/dailyCapGuard.js";

// "Scrape from Job APIs" - the server-side half of the autopilot's second mode.
//
// The portal mode drives a browser: the extension scrapes a site, judges in
// the browser, and pushes. This mode has no browser at all. The server calls
// the job API, judges with the same rules (Utils/apiJudge.js), and writes the
// picks through the same JobModel the extension's pushes land in - so a client
// cannot tell where a card came from, and one daily cap covers both.

const cleanEmail = (raw) => String(raw || "").toLowerCase().trim();

// Fields the operator may set. Anything else in the body is ignored rather
// than written, so a stale UI cannot inject new keys into the document.
const STRING_FIELDS = ["country", "what", "whatPhrase", "whatExclude", "titleOnly", "where", "category", "sortBy"];
const NUMBER_FIELDS = ["distance", "salaryMin", "salaryMax", "maxDaysOld", "resultsPerPage", "maxPages"];
const BOOL_FIELDS = ["fullTime", "partTime", "permanent", "contract", "enabled"];

function sanitizeSettings(body = {}) {
  const set = {};
  for (const k of STRING_FIELDS) {
    if (body[k] !== undefined) set[k] = String(body[k] ?? "").trim().slice(0, 200);
  }
  for (const k of NUMBER_FIELDS) {
    if (body[k] === undefined) continue;
    const raw = body[k];
    if (raw === "" || raw === null) { set[k] = null; continue; }
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) continue;
    set[k] = Math.round(n);
  }
  for (const k of BOOL_FIELDS) {
    if (body[k] !== undefined) set[k] = body[k] === true || body[k] === "true" || body[k] === 1;
  }
  // Hard bounds the UI cannot talk us out of. Adzuna caps a page at 50, and
  // maxPages is what stops one client's run walking the whole board.
  if (set.resultsPerPage != null) set.resultsPerPage = Math.min(Math.max(set.resultsPerPage, 1), 50);
  if (set.maxPages != null) set.maxPages = Math.min(Math.max(set.maxPages, 1), 20);
  if (set.country) set.country = set.country.toLowerCase().slice(0, 4);
  return set;
}

/** GET /job-api/settings/:email  -> the saved search, or sensible defaults. */
export const getJobApiSettings = async (req, res) => {
  try {
    const clientEmail = cleanEmail(req.params.email);
    if (!clientEmail.includes("@")) return res.status(400).json({ success: false, message: "bad email" });
    const doc = await JobApiSettings.findOne({ clientEmail, provider: "adzuna" }).lean();
    const { appId, appKey } = adzunaCredentials();
    // A brand-new client gets the schema defaults rather than an empty form,
    // so the operator only fills in the role.
    const defaults = new JobApiSettings({ clientEmail, provider: "adzuna" }).toObject();
    delete defaults._id;
    return res.status(200).json({
      success: true,
      configured: !!doc,
      // The API account is FlashFire's, not the client's - the UI shows
      // whether it is set up so a run that cannot possibly work says so
      // before anyone presses the button.
      credentialsPresent: !!(appId && appKey),
      settings: { ...defaults, ...(doc || {}) },
    });
  } catch (error) {
    console.error("getJobApiSettings failed:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/** PUT /job-api/settings/:email  -> save what the pencil dialog changed. */
export const putJobApiSettings = async (req, res) => {
  try {
    const clientEmail = cleanEmail(req.params.email);
    if (!clientEmail.includes("@")) return res.status(400).json({ success: false, message: "bad email" });
    const set = sanitizeSettings(req.body);
    if (!Object.keys(set).length) return res.status(400).json({ success: false, message: "nothing to save" });
    set.updatedBy = String(req.body?.updatedBy || "").slice(0, 200);
    const doc = await JobApiSettings.findOneAndUpdate(
      { clientEmail, provider: "adzuna" },
      { $set: set },
      { new: true, upsert: true, lean: true, setDefaultsOnInsert: true },
    );
    return res.status(200).json({ success: true, settings: doc });
  } catch (error) {
    console.error("putJobApiSettings failed:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * POST /job-api/scrape/:email   (ops key)
 *
 * Fetch -> judge -> push, for one client. Returns a summary the autopilot
 * shows on the row, in the same shape its browser runs report.
 */
export const runJobApiScrape = async (req, res) => {
  const startedAt = new Date();
  try {
    const clientEmail = cleanEmail(req.params.email);
    if (!clientEmail.includes("@")) return res.status(400).json({ success: false, message: "bad email" });

    const settings = await JobApiSettings.findOne({ clientEmail, provider: "adzuna" }).lean();
    if (!settings) {
      return res.status(400).json({ success: false, error: "NOT_CONFIGURED",
        message: "No Adzuna search saved for this client. Open the pencil and set the role." });
    }
    if (!settings.what && !settings.titleOnly && !settings.whatPhrase) {
      return res.status(400).json({ success: false, error: "NO_SEARCH_TERMS",
        message: "This client's Adzuna search has no keywords. Open the pencil and set the role." });
    }

    // How many this client may still receive today. The same cap /addjob
    // enforces and manual operator pushes share, so an API run cannot spend
    // an allowance the operator already used by hand.
    let remaining = 0;
    try {
      const cap = await checkCap(clientEmail);
      remaining = Math.max(0, Number(cap?.remaining) || 0);
    } catch (e) {
      return res.status(503).json({ success: false, error: "CAP_UNAVAILABLE", message: e.message });
    }
    if (remaining <= 0) {
      return res.status(200).json({ success: true, outcome: "cap-hit", fetched: 0, judged: 0,
        picked: 0, pushed: 0, message: "Already at today's cap. The allowance resets at 22:00 IST." });
    }

    const profile = await ProfileModel.findOne({ email: clientEmail }).lean();
    if (!profile) return res.status(404).json({ success: false, message: `no profile for ${clientEmail}` });
    const user = await UserModel.findOne({ email: clientEmail }).select("name").lean();

    // ---- fetch ------------------------------------------------------
    const maxPages = Math.min(Math.max(Number(settings.maxPages) || 5, 1), 20);
    const seen = new Set();
    const jobs = [];
    let fetchError = null;
    let usedTerm = settings.what || "";

    // Adzuna's `what` needs EVERY word to match, so a role title copied out
    // of a brief returns nothing the moment it gets specific - measured over
    // 50 clients, 11 got zero results for that reason alone while a term one
    // word shorter returned hundreds. Try what the operator saved first, then
    // progressively broader forms, and stop at the first that finds anything.
    // A term that already works never reaches the second rung.
    const ladder = searchLadder(settings.what);
    for (const term of (ladder.length ? ladder : [settings.what])) {
      for (let page = 1; page <= maxPages; page += 1) {
        const r = await fetchPage({ ...settings, what: term }, page);
        if (!r.ok) { fetchError = r; break; }
        if (!r.results.length) break;            // ran out of results
        for (const raw of r.results) {
          const m = mapJob(raw);
          if (m && !seen.has(m.jobId)) { seen.add(m.jobId); jobs.push(m); }
        }
        // No point fetching jobs the cap can never accept. Judging rejects
        // most of what it sees, so fetch a generous multiple, not exactly
        // `remaining`.
        if (jobs.length >= remaining * 10) break;
      }
      if (jobs.length || fetchError) { usedTerm = term; break; }
    }
    if (!jobs.length) {
      return res.status(200).json({
        success: !fetchError,
        outcome: fetchError ? "api-error" : "no-results",
        error: fetchError?.error, message: fetchError?.message
          || "Adzuna returned nothing for this search in the last 24 hours.",
        fetched: 0, judged: 0, picked: 0, pushed: 0,
      });
    }

    // ---- drop what is already on the dashboard ----------------------
    // Cheaper than judging it and being refused at the push, and it keeps the
    // judged count honest.
    const links = jobs.map((j) => j.applyUrl).filter(Boolean);
    const already = new Set(
      (await JobModel.find({ userID: clientEmail, joblink: { $in: links } }).select("joblink").lean())
        .map((d) => d.joblink),
    );
    const fresh = jobs.filter((j) => !already.has(j.applyUrl));

    // ---- judge ------------------------------------------------------
    const threshold = Number(profile.aiThreshold) || 50;
    const judged = await judgeJobs({
      profile, aiSummary: profile.aiSummary || "", jobs: fresh, threshold,
    });
    if (!judged.ok) {
      return res.status(502).json({ success: false, outcome: "judge-failed", error: judged.error,
        message: judged.message, fetched: jobs.length, judged: 0, picked: 0, pushed: 0 });
    }
    const byId = new Map(judged.decisions.map((d) => [d.id, d]));
    const picks = fresh.filter((j) => byId.get(j.jobId)?.pick === true).slice(0, remaining);

    // ---- push -------------------------------------------------------
    // Straight onto JobModel, in the same shape AddJob writes, rather than
    // calling our own HTTP endpoint from inside ourselves.
    const operatorName = String(req.body?.operatorName || "Job API").slice(0, 80);
    let pushed = 0;
    const failures = [];
    for (const job of picks) {
      const d = byId.get(job.jobId) || {};
      try {
        await JobModel.create({
          userID: clientEmail,
          jobTitle: job.title.slice(0, 50),
          companyName: job.company,
          jobLocation: job.location,
          jobDescription: job.description,
          joblink: job.applyUrl,
          currentStatus: "saved",
          createdByRole: "operations",
          operatorName,
          operatorEmail: String(req.body?.operatorEmail || "").toLowerCase().trim(),
          addedBy: operatorName,
          source: "adzuna-api",
          aiDecision: {
            reason: String(d.reason || "").slice(0, 600),
            score: Number.isInteger(d.score) ? d.score : null,
            matchedRole: String(d.matchedRole || "").slice(0, 120),
            model: process.env.OPENAI_JUDGE_MODEL || "gpt-4o-mini",
            judgedAt: new Date(),
          },
        });
        pushed += 1;
      } catch (e) {
        failures.push(`${job.jobId}: ${e.message}`.slice(0, 160));
      }
    }

    await JobApiSettings.updateOne({ clientEmail, provider: "adzuna" }, { $set: { lastRunAt: new Date() } });

    return res.status(200).json({
      success: true,
      outcome: pushed >= remaining ? "cap-reached" : "done",
      fetched: jobs.length,
      // Which term actually returned these. Differs from the saved one when
      // the ladder had to broaden it, and the operator should see that.
      searchTerm: usedTerm,
      broadened: usedTerm !== (settings.what || ""),
      alreadyHad: jobs.length - fresh.length,
      judged: fresh.length,
      picked: picks.length,
      pushed,
      remainingBefore: remaining,
      errors: failures.slice(0, 5),
      minutes: Math.round(((Date.now() - startedAt.getTime()) / 60000) * 10) / 10,
    });
  } catch (error) {
    console.error("runJobApiScrape failed:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};
