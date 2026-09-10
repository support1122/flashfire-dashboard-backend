import mongoose from "mongoose";
import { AutopilotRun } from "../Schema_Models/AutopilotRun.js";
import { AutopilotRunRequest } from "../Schema_Models/AutopilotRunRequest.js";

// Autopilot run history + the scrape request queue.
//
// Writers (the autopilot posting results, claiming queue items) sit behind
// requireOpsKey. Readers are open, matching the other dashboard endpoints this
// portal already calls (/summaries-overview, /push-history); the Auto
// Extension tab is admin-gated in the UI. That is a UI gate, not a server one -
// worth tightening if these numbers ever become sensitive.

const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 100;

const clampLimit = (raw, fallback = DEFAULT_LIMIT) => {
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 1) return fallback;
  return Math.min(n, MAX_LIMIT);
};

const cleanEmail = (raw) => String(raw || "").toLowerCase().trim();

// Coerce anything the autopilot sends into a non-negative integer. A missing
// counter must read as 0, never NaN - NaN would poison every $sum downstream.
const num = (raw) => {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
};

/**
 * POST /autopilot/runs   (ops key)
 *
 * The autopilot posts one of these when a client's run finishes, whatever the
 * outcome - a failed run is exactly the row ops needs to see, so failures are
 * recorded like any other.
 */
export const recordAutopilotRun = async (req, res) => {
  try {
    const body = req.body || {};
    const clientEmail = cleanEmail(body.clientEmail);
    if (!clientEmail.includes("@")) {
      return res.status(400).json({ success: false, message: "clientEmail is required" });
    }

    const captured = num(body.captured);
    const pushed = num(body.pushed);

    const doc = await AutopilotRun.create({
      clientEmail,
      clientName: String(body.clientName || "").trim(),
      profile: String(body.profile || "").trim(),

      captured,
      pushed,
      // Trust our own arithmetic over a number that travelled: rejected is
      // captured minus pushed by definition, and a run that pushed more than
      // it captured (panel counters read mid-update) must not go negative.
      rejected: Math.max(captured - pushed, 0),
      picks: num(body.picks),
      dupes: num(body.dupes),
      blocked: num(body.blocked),
      errorCount: num(body.errors),

      cap: num(body.cap),
      minutes: Number.isFinite(Number(body.minutes)) ? Math.max(Number(body.minutes), 0) : 0,
      attempts: Math.max(num(body.attempts) || 1, 1),

      outcome: String(body.outcome || "").slice(0, 200),
      outcomeLabel: String(body.outcomeLabel || "").slice(0, 120),
      why: String(body.why || "").slice(0, 600),
      severity: ["good", "warn", "bad"].includes(body.severity) ? body.severity : "",
      errorText: String(body.errorText || "").slice(0, 600),

      host: String(body.host || "").slice(0, 120),
      trigger: ["schedule", "manual", "portal"].includes(body.trigger) ? body.trigger : "manual",
      requestedBy: String(body.requestedBy || "").slice(0, 200),

      startedAt: body.startedAt ? new Date(body.startedAt) : undefined,
      finishedAt: body.finishedAt ? new Date(body.finishedAt) : new Date()
    });

    res.status(201).json({ success: true, id: doc._id });
  } catch (error) {
    console.error("recordAutopilotRun failed:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * GET /autopilot/runs?limit=&email=&since=&outcome=
 *
 * Flat, newest-first run list. Used by the "All runs" view.
 */
export const listAutopilotRuns = async (req, res) => {
  try {
    const filter = {};
    const email = cleanEmail(req.query.email);
    if (email) filter.clientEmail = email;
    if (req.query.outcome) filter.outcome = String(req.query.outcome);
    if (req.query.since) {
      const since = new Date(req.query.since);
      if (!Number.isNaN(since.getTime())) filter.finishedAt = { $gte: since };
    }

    const docs = await AutopilotRun.find(filter)
      .sort({ finishedAt: -1 })
      .limit(clampLimit(req.query.limit))
      .lean();

    res.status(200).json({ success: true, count: docs.length, data: docs });
  } catch (error) {
    console.error("listAutopilotRuns failed:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * GET /autopilot/runs/summary?days=
 *
 * One row per client: their latest run plus totals over the window. This is
 * what the Auto Extension table renders, and it is a single aggregation rather
 * than N queries so 293 clients stay one round trip.
 */
export const getAutopilotRunsSummary = async (req, res) => {
  try {
    // A non-positive or unparseable days falls back to the default window.
    // Math.max(n, 1) would have turned days=-5 into a silent one-day window,
    // which looks like "there is no data" rather than like bad input.
    const askedDays = Number.parseInt(req.query.days, 10);
    const days = Number.isInteger(askedDays) && askedDays > 0 ? Math.min(askedDays, 365) : 30;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const rows = await AutopilotRun.aggregate([
      { $match: { finishedAt: { $gte: since } } },
      { $sort: { finishedAt: -1 } },
      {
        $group: {
          _id: "$clientEmail",
          // $first after the sort above = the most recent run.
          lastRun: { $first: "$$ROOT" },
          runs: { $sum: 1 },
          totalCaptured: { $sum: "$captured" },
          totalPushed: { $sum: "$pushed" },
          totalRejected: { $sum: "$rejected" },
          totalMinutes: { $sum: "$minutes" },
          failedRuns: { $sum: { $cond: [{ $eq: ["$severity", "bad"] }, 1, 0] } }
        }
      },
      { $sort: { "lastRun.finishedAt": -1 } }
    ]);

    const data = rows.map((r) => ({
      clientEmail: r._id,
      clientName: r.lastRun.clientName || "",
      profile: r.lastRun.profile || "",
      runs: r.runs,
      failedRuns: r.failedRuns,
      totalCaptured: r.totalCaptured,
      totalPushed: r.totalPushed,
      totalRejected: r.totalRejected,
      totalMinutes: Math.round(r.totalMinutes * 10) / 10,
      lastRunAt: r.lastRun.finishedAt,
      lastCaptured: r.lastRun.captured,
      lastPushed: r.lastRun.pushed,
      lastRejected: r.lastRun.rejected,
      lastCap: r.lastRun.cap,
      lastMinutes: r.lastRun.minutes,
      lastOutcome: r.lastRun.outcome,
      lastOutcomeLabel: r.lastRun.outcomeLabel,
      lastWhy: r.lastRun.why,
      lastSeverity: r.lastRun.severity,
      lastError: r.lastRun.errorText,
      lastTrigger: r.lastRun.trigger
    }));

    const totals = data.reduce(
      (acc, r) => ({
        clients: acc.clients + 1,
        runs: acc.runs + r.runs,
        captured: acc.captured + r.totalCaptured,
        pushed: acc.pushed + r.totalPushed,
        rejected: acc.rejected + r.totalRejected,
        failedRuns: acc.failedRuns + r.failedRuns
      }),
      { clients: 0, runs: 0, captured: 0, pushed: 0, rejected: 0, failedRuns: 0 }
    );

    res.status(200).json({ success: true, days, totals, count: data.length, data });
  } catch (error) {
    console.error("getAutopilotRunsSummary failed:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * GET /autopilot/runs/client/:email?limit=
 *
 * Full run history for one client - the detail view behind a table row.
 */
export const getAutopilotRunsForClient = async (req, res) => {
  try {
    const email = cleanEmail(req.params.email);
    if (!email.includes("@")) {
      return res.status(400).json({ success: false, message: "bad email" });
    }

    const [runs, requests] = await Promise.all([
      AutopilotRun.find({ clientEmail: email })
        .sort({ finishedAt: -1 })
        .limit(clampLimit(req.query.limit, 50))
        .lean(),
      AutopilotRunRequest.find({ clientEmail: email }).sort({ createdAt: -1 }).limit(10).lean()
    ]);

    const totals = runs.reduce(
      (acc, r) => ({
        runs: acc.runs + 1,
        captured: acc.captured + (r.captured || 0),
        pushed: acc.pushed + (r.pushed || 0),
        rejected: acc.rejected + (r.rejected || 0),
        minutes: acc.minutes + (r.minutes || 0)
      }),
      { runs: 0, captured: 0, pushed: 0, rejected: 0, minutes: 0 }
    );
    totals.minutes = Math.round(totals.minutes * 10) / 10;

    res.status(200).json({ success: true, clientEmail: email, totals, runs, requests });
  } catch (error) {
    console.error("getAutopilotRunsForClient failed:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * POST /autopilot/queue   (ops key)   body: { clientEmail, clientName?, maxJobs?, requestedBy? }
 *
 * The portal's Scrape button. Returns 409 when the client already has a live
 * request, so a double click is a clear "already queued" rather than a second
 * browser fighting over the same Chrome profile.
 */
export const queueAutopilotRun = async (req, res) => {
  try {
    const clientEmail = cleanEmail(req.body?.clientEmail);
    if (!clientEmail.includes("@")) {
      return res.status(400).json({ success: false, message: "clientEmail is required" });
    }

    let maxJobs = null;
    if (req.body?.maxJobs !== undefined && req.body.maxJobs !== "" && req.body.maxJobs !== null) {
      // Number(), not parseInt(): parseInt("2.5") is 2, which would silently
      // accept a fractional cap as though the operator had asked for 2.
      const raw = req.body.maxJobs;
      const n = typeof raw === "number" ? raw : Number(String(raw).trim());
      if (!Number.isInteger(n) || n < 1 || n > 30) {
        return res.status(400).json({ success: false, message: "maxJobs must be a whole number between 1 and 30" });
      }
      maxJobs = n;
    }

    const doc = await AutopilotRunRequest.create({
      clientEmail,
      clientName: String(req.body?.clientName || "").trim(),
      maxJobs,
      requestedBy: String(req.body?.requestedBy || "").slice(0, 200),
      status: "queued"
    });

    res.status(201).json({ success: true, id: doc._id, status: doc.status });
  } catch (error) {
    // 11000 is the one_live_request_per_client partial unique index firing.
    if (error?.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "This client already has a scrape queued or running."
      });
    }
    console.error("queueAutopilotRun failed:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * GET /autopilot/queue?status=&limit=
 *
 * What the portal shows as "queued / running" next to each client.
 */
export const listAutopilotQueue = async (req, res) => {
  try {
    const filter = {};
    if (req.query.status) {
      const wanted = String(req.query.status)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (wanted.length) filter.status = { $in: wanted };
    }
    const docs = await AutopilotRunRequest.find(filter)
      .sort({ createdAt: -1 })
      .limit(clampLimit(req.query.limit))
      .lean();
    res.status(200).json({ success: true, count: docs.length, data: docs });
  } catch (error) {
    console.error("listAutopilotQueue failed:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * POST /autopilot/queue/claim   (ops key)   body: { claimedBy?, limit? }
 *
 * The autopilot's poll. Claims oldest-first, one document at a time via
 * findOneAndUpdate so the read and the write are a single atomic operation -
 * two pollers can never claim the same request.
 */
export const claimAutopilotRequests = async (req, res) => {
  try {
    const claimedBy = String(req.body?.claimedBy || "").slice(0, 120);
    const want = Math.min(Math.max(Number.parseInt(req.body?.limit, 10) || 1, 1), 20);

    const claimed = [];
    for (let i = 0; i < want; i += 1) {
      const doc = await AutopilotRunRequest.findOneAndUpdate(
        { status: "queued" },
        { $set: { status: "claimed", claimedBy, claimedAt: new Date() } },
        { sort: { createdAt: 1 }, new: true }
      ).lean();
      if (!doc) break;
      claimed.push(doc);
    }

    res.status(200).json({ success: true, count: claimed.length, data: claimed });
  } catch (error) {
    console.error("claimAutopilotRequests failed:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * POST /autopilot/queue/:id/finish   (ops key)
 * body: { status: "done"|"failed", outcome?, outcomeLabel?, message?, runId? }
 *
 * Closes a claimed request. Once it leaves queued/claimed the partial unique
 * index releases, so the client can be queued again.
 */
export const finishAutopilotRequest = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: "bad id" });
    }
    const status = ["done", "failed", "cancelled"].includes(req.body?.status) ? req.body.status : "done";

    const set = {
      status,
      finishedAt: new Date(),
      outcome: String(req.body?.outcome || "").slice(0, 200),
      outcomeLabel: String(req.body?.outcomeLabel || "").slice(0, 120),
      message: String(req.body?.message || "").slice(0, 600)
    };
    if (req.body?.runId && mongoose.isValidObjectId(req.body.runId)) set.runId = req.body.runId;

    const doc = await AutopilotRunRequest.findByIdAndUpdate(id, { $set: set }, { new: true }).lean();
    if (!doc) return res.status(404).json({ success: false, message: "request not found" });

    res.status(200).json({ success: true, data: doc });
  } catch (error) {
    console.error("finishAutopilotRequest failed:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * POST /autopilot/queue/:id/cancel
 *
 * Only a request nobody has picked up yet can be cancelled. Once the autopilot
 * has claimed it a browser is already open, and cancelling the row here would
 * not stop it - that is what the autopilot's own Stop button is for.
 */
export const cancelAutopilotRequest = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: "bad id" });
    }
    const doc = await AutopilotRunRequest.findOneAndUpdate(
      { _id: id, status: "queued" },
      { $set: { status: "cancelled", finishedAt: new Date(), message: "Cancelled from the portal." } },
      { new: true }
    ).lean();
    if (!doc) {
      return res.status(409).json({
        success: false,
        message: "Only a request that has not started yet can be cancelled."
      });
    }
    res.status(200).json({ success: true, data: doc });
  } catch (error) {
    console.error("cancelAutopilotRequest failed:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};
