import mongoose from "mongoose";
import { AutopilotRun } from "../Schema_Models/AutopilotRun.js";
import { ExtensionSessionStat } from "../Schema_Models/ExtensionSessionStat.js";
import { JobModel } from "../Schema_Models/JobModel.js";
import { parseDaysParam, startOfIstDayWindow, istWindowLabel } from "../Utils/istWindow.js";

// GET /autopilot/manual/summary?days=
//
// The Auto Extension page reports what the autopilot scraped. Operators also run
// the same jr-direct-extension by hand, and that work never reached the page.
// This endpoint reports the MANUAL half with the same three numbers, over the
// same IST window, so the two sit side by side and add up.
//
// Separating manual from autopilot
// --------------------------------
// The autopilot drives the very same extension, so its sessions land in
// ExtensionSessionStat exactly like an operator's. Operator code can't tell them
// apart either: the autopilot signs the panel in with whatever code is saved in
// that client's creds. The one thing that does separate them is time. A session
// is autopilot work when an AutopilotRun for the same client was open at that
// moment; everything else is an operator at a keyboard.
//
// Where each number comes from
// ----------------------------
//   Captured - ExtensionSessionStat.captures. It is the only record of cards
//              pulled off a board, so there is no ground truth to prefer.
//   Pushed   - JobModel, not the session stat. AutopilotRuns.js documents a run
//              whose panel read "pushed 0" while 33 jobs landed; the jobs cannot
//              be misread, so they are the count. Extension pushes are the ones
//              AddJob stamped with a 5-digit extensionCode, which leaves out jobs
//              an operator typed into the dashboard by hand. Manual pushed is
//              that total minus what the autopilot's own rows counted, which is
//              what makes Autopilot + Manual add up to all extension pushes.
//   Rejected - captured minus pushed, floored at 0, same as the autopilot rows.

// Slack around an autopilot run when deciding whether a session was inside it.
// The run row opens a beat after the extension starts and closes a beat after
// the last heartbeat, so an exact boundary would leak its first and last
// sessions into the manual column.
const RUN_EDGE_MS = 2 * 60 * 1000;

const EXTENSION_CODE_RX = /^\d{5}$/;

const oidAt = (d) =>
  new mongoose.Types.ObjectId(
    Math.floor(d.getTime() / 1000).toString(16).padStart(8, "0") + "0000000000000000"
  );

const toMs = (v) => {
  if (!v) return NaN;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : NaN;
};

const cleanEmail = (v) => String(v || "").toLowerCase().trim();

/**
 * Autopilot run rows -> Map<clientEmail, [[startMs, endMs], ...]>.
 * Older rows have no startedAt; `minutes` recovers it.
 */
export function buildRunIntervals(runs) {
  const byClient = new Map();
  for (const r of runs || []) {
    const email = cleanEmail(r.clientEmail);
    const end = toMs(r.finishedAt);
    if (!email || !Number.isFinite(end)) continue;
    let start = toMs(r.startedAt);
    if (!Number.isFinite(start)) start = end - Math.max(0, Number(r.minutes) || 0) * 60000;
    const list = byClient.get(email) || [];
    list.push([start - RUN_EDGE_MS, end + RUN_EDGE_MS]);
    byClient.set(email, list);
  }
  return byClient;
}

export function insideAutopilotRun(intervals, clientEmail, whenMs) {
  if (!Number.isFinite(whenMs)) return false;
  const list = intervals.get(cleanEmail(clientEmail));
  if (!list) return false;
  return list.some(([a, b]) => whenMs >= a && whenMs <= b);
}

/**
 * Session-stat rows -> per-client manual capture totals.
 *
 * One capture session can leave several rows: a Chrome service-worker eviction
 * used to drop the sessionId, so each later heartbeat inserted a fresh row
 * carrying the same running total. Rows are therefore folded per session and
 * the session keeps its MAX captures - summing them would count the same cards
 * again. Separate sessions are summed. (The auto-run cycle mints a new session
 * per 100-card batch, so a long run is several sessions and sums correctly.)
 */
export function summariseManualSessions(rows, intervals) {
  const sessions = new Map();
  let autopilotRows = 0;
  for (const r of rows || []) {
    const email = cleanEmail(r.clientEmail);
    if (!email) continue;
    const startMs = toMs(r.startedAt);
    const endMs = toMs(r.endedAt);
    const when = Number.isFinite(startMs) ? startMs : endMs;
    if (insideAutopilotRun(intervals, email, when)) { autopilotRows += 1; continue; }

    const key = r.sessionId
      ? `sid:${r.sessionId}`
      : `${String(r.operatorName || "").trim()}|${email}|${Number.isFinite(startMs) ? startMs : `row:${r._id}`}`;
    const cur = sessions.get(key);
    const captures = Math.max(0, Number(r.captures) || 0);
    if (!cur) {
      sessions.set(key, {
        clientEmail: email,
        clientName: String(r.clientName || ""),
        operatorName: String(r.operatorName || "").trim(),
        captures,
        lastAt: endMs,
      });
    } else {
      cur.captures = Math.max(cur.captures, captures);
      if (Number.isFinite(endMs) && !(endMs <= cur.lastAt)) cur.lastAt = endMs;
      if (!cur.clientName && r.clientName) cur.clientName = String(r.clientName);
    }
  }

  const byClient = new Map();
  for (const s of sessions.values()) {
    const c = byClient.get(s.clientEmail) || {
      clientEmail: s.clientEmail,
      clientName: "",
      operators: new Set(),
      sessions: 0,
      captured: 0,
      lastAt: NaN,
    };
    if (!c.clientName && s.clientName) c.clientName = s.clientName;
    if (s.operatorName) c.operators.add(s.operatorName);
    c.sessions += 1;
    c.captured += s.captures;
    if (Number.isFinite(s.lastAt) && !(s.lastAt <= c.lastAt)) c.lastAt = s.lastAt;
    byClient.set(s.clientEmail, c);
  }
  return { byClient, autopilotRows, sessions: sessions.size };
}

/**
 * Join captures with pushes into the rows and totals the page renders.
 *   extensionPushes - Map<clientEmail, all extension-coded pushes in the window>
 *   autopilotPushes - Map<clientEmail, what that client's autopilot rows counted>
 */
export function buildManualReport({ byClient, extensionPushes, autopilotPushes }) {
  const emails = new Set([...byClient.keys()]);
  for (const [email, n] of extensionPushes) {
    // A client with extension pushes but no manual session row is still manual
    // work (an older build that never reported sessions) - but only if the
    // pushes are not all accounted for by the autopilot.
    if (n - (autopilotPushes.get(email) || 0) > 0) emails.add(email);
  }

  const data = [];
  for (const email of emails) {
    const c = byClient.get(email);
    const captured = c ? c.captured : 0;
    const pushed = Math.max(0, (extensionPushes.get(email) || 0) - (autopilotPushes.get(email) || 0));
    if (captured === 0 && pushed === 0) continue;
    data.push({
      clientEmail: email,
      clientName: c ? c.clientName : "",
      operators: c ? [...c.operators].sort() : [],
      sessions: c ? c.sessions : 0,
      captured,
      pushed,
      rejected: Math.max(captured - pushed, 0),
      lastScrapedAt: c && Number.isFinite(c.lastAt) ? new Date(c.lastAt).toISOString() : null,
    });
  }
  data.sort((a, b) => (b.lastScrapedAt || "").localeCompare(a.lastScrapedAt || "") || b.captured - a.captured);

  const operators = new Set();
  for (const c of byClient.values()) for (const o of c.operators) operators.add(o);
  const totals = data.reduce(
    (acc, r) => ({
      ...acc,
      clients: acc.clients + 1,
      sessions: acc.sessions + r.sessions,
      captured: acc.captured + r.captured,
      pushed: acc.pushed + r.pushed,
      rejected: acc.rejected + r.rejected,
    }),
    { clients: 0, operators: operators.size, sessions: 0, captured: 0, pushed: 0, rejected: 0 }
  );
  return { data, totals };
}

export const getManualExtensionSummary = async (req, res) => {
  try {
    const days = parseDaysParam(req.query.days, { fallback: 30, max: 365 });
    const since = startOfIstDayWindow(days);
    const until = new Date();

    const [runs, sessionRows, pushRows] = await Promise.all([
      // Same window rule as /autopilot/runs/summary (finishedAt), so the
      // autopilot pushes subtracted here are exactly the ones on that page.
      AutopilotRun.find({ finishedAt: { $gte: since, $lte: until } })
        .select("clientEmail startedAt finishedAt minutes pushed")
        .lean(),
      // endedAt is refreshed on every heartbeat, so it is the session's latest
      // activity - and it is indexed.
      ExtensionSessionStat.find({ endedAt: { $gte: since, $lte: until } })
        .select("sessionId clientEmail clientName operatorName captures startedAt endedAt")
        .lean(),
      JobModel.aggregate([
        {
          $match: {
            createdByRole: "operations",
            extensionCode: { $regex: EXTENSION_CODE_RX },
            _id: { $gte: oidAt(since), $lte: oidAt(until) },
          },
        },
        { $group: { _id: "$userID", n: { $sum: 1 } } },
      ]),
    ]);

    const intervals = buildRunIntervals(runs);
    const { byClient, autopilotRows } = summariseManualSessions(sessionRows, intervals);

    const extensionPushes = new Map();
    for (const p of pushRows) extensionPushes.set(cleanEmail(p._id), p.n);
    const autopilotPushes = new Map();
    for (const r of runs) {
      const e = cleanEmail(r.clientEmail);
      autopilotPushes.set(e, (autopilotPushes.get(e) || 0) + (Number(r.pushed) || 0));
    }

    const { data, totals } = buildManualReport({ byClient, extensionPushes, autopilotPushes });

    res.status(200).json({
      success: true,
      days,
      windowStart: since.toISOString(),
      windowLabel: istWindowLabel(days),
      timezone: "Asia/Kolkata",
      totals,
      // Diagnostic: session rows set aside because an autopilot run covered
      // them. Non-zero is normal; it is the double count this avoids.
      autopilotSessionRowsExcluded: autopilotRows,
      count: data.length,
      data,
    });
  } catch (error) {
    console.error("getManualExtensionSummary failed:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};
