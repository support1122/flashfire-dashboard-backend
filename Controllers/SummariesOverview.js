// SummariesOverview: one aggregate so the admin "AI Summaries" page can
// render the master list (every client with summary status + push count
// + cap progress + per-operator breakdown) without N+1 round-trips.
//
// Performance: the previous version aggregated ALL JobModel rows. With ~3.5k
// jobs and growing this was O(seconds). We now run two aggregates side-by-side
// against the userID+createdByRole index and parallelise every read.
//
// Output shape:
//   {
//     success: true,
//     totals: { clients, withSummary, withoutSummary, stale, withCap, opsTotal,
//               opsToday, captureSessionsToday, linkedinSkippedToday },
//     operators: [{ operator, jobsLifetime, jobsToday, clientsServed,
//                   linkedinSkipped, captures }],
//     rows: [{
//       email, name, planType, preferredRoles, preferredLocations,
//       hasSummary, summaryStale, summaryBuiltAt, summaryWordCount, summarySource,
//       targetJobCount, effectiveCap, isDefaultCap,
//       currentOpsCount, currentOpsToday, currentAllCount,
//       capRemaining, capStatus,
//       operatorBreakdown: [{ operator, count, lastPushAt, todayCount }],
//       extensionStats: { captures, linkedinSkipped, lastSessionAt }
//     }]
//   }

import { ProfileModel } from "../Schema_Models/ProfileModel.js";
import { JobModel } from "../Schema_Models/JobModel.js";
import { UserModel } from "../Schema_Models/UserModel.js";
import { ExtensionSessionStat } from "../Schema_Models/ExtensionSessionStat.js";
import { startOfTodayIST, DEFAULT_DAILY_CAP } from "../Utils/dailyCapGuard.js";

const DEFAULT_CAP = DEFAULT_DAILY_CAP;

export default async function SummariesOverview(req, res) {
  try {
    const todayStart = startOfTodayIST();
    const todaySeconds = Math.floor(todayStart.getTime() / 1000);
    const ObjectId = JobModel.base.Types.ObjectId;
    const todayLowBound = new ObjectId(
      todaySeconds.toString(16).padStart(8, "0") + "0000000000000000",
    );

    // Run every read in parallel — saves ~60% wall time on the slow Job
    // aggregates. Profile + User reads are tiny but free to parallelise.
    const [
      profiles,
      users,
      opsLifetime,
      opsToday,
      allLifetime,
      operatorAgg,
      perClientOperators,
      sessionStats,
      removedAgg,
      flaggedAgg,
    ] = await Promise.all([
      // Heavy aiSummary text NEVER lands in the list payload — only a
      // computed `hasSummary` boolean. Cuts the response from ~500KB to
      // ~80KB on a 156-client deploy. Right pane lazy-loads full summary
      // via /get-profile when operator picks a client.
      ProfileModel.aggregate([
        {
          $project: {
            email: 1,
            firstName: 1,
            lastName: 1,
            preferredRoles: 1,
            preferredLocations: 1,
            aiSummaryMeta: 1,
            targetJobCount: 1,
            summaryStale: 1,
            hasSummary: {
              $gt: [{ $strLenCP: { $ifNull: ["$aiSummary", ""] } }, 0],
            },
          },
        },
      ]),
      UserModel.find({}, { email: 1, name: 1, planType: 1 }).lean(),
      // Lifetime ops by client.
      JobModel.aggregate([
        { $match: { createdByRole: "operations" } },
        { $group: { _id: "$userID", count: { $sum: 1 } } },
      ]),
      // Today ops by client (drives cap math).
      JobModel.aggregate([
        { $match: { createdByRole: "operations", _id: { $gte: todayLowBound } } },
        { $group: { _id: "$userID", count: { $sum: 1 } } },
      ]),
      // All-roles count (display only).
      JobModel.aggregate([
        { $group: { _id: "$userID", count: { $sum: 1 } } },
      ]),
      // Per-operator totals (lifetime + today + clients-served).
      JobModel.aggregate([
        { $match: { createdByRole: "operations" } },
        {
          $group: {
            _id: { $ifNull: ["$operatorName", "(unknown)"] },
            jobsLifetime: { $sum: 1 },
            jobsToday: {
              $sum: { $cond: [{ $gte: ["$_id", todayLowBound] }, 1, 0] },
            },
            clients: { $addToSet: "$userID" },
            lastPushAt: { $max: "$_id" },
          },
        },
        {
          $project: {
            _id: 0,
            operator: "$_id",
            jobsLifetime: 1,
            jobsToday: 1,
            clientsServed: { $size: "$clients" },
            lastPushAt: 1,
          },
        },
        { $sort: { jobsToday: -1, jobsLifetime: -1 } },
      ]),
      // Per-client × per-operator breakdown (drives the per-client list of
      // who pushed how many).
      JobModel.aggregate([
        { $match: { createdByRole: "operations" } },
        {
          $group: {
            _id: {
              userID: "$userID",
              operator: { $ifNull: ["$operatorName", "(unknown)"] },
            },
            count: { $sum: 1 },
            todayCount: {
              $sum: { $cond: [{ $gte: ["$_id", todayLowBound] }, 1, 0] },
            },
            lastPushAt: { $max: "$_id" },
          },
        },
        { $sort: { count: -1 } },
      ]),
      // Extension session stats (captures + LinkedIn skips), aggregated by
      // client. Tolerate missing collection so old DBs without ExtensionSessionStat
      // don't break the overview.
      (async () => {
        try {
          return await ExtensionSessionStat.aggregate([
            {
              $group: {
                _id: { client: { $toLower: { $ifNull: ["$clientEmail", ""] } }, operator: "$operatorName" },
                extensionCode: { $last: "$extensionCode" },
                captures: { $sum: "$captures" },
                linkedinSkipped: { $sum: "$linkedinSkipped" },
                pushed: { $sum: "$pushed" },
                judged: { $sum: "$judged" },
                picks: { $sum: "$picks" },
                duplicates: { $sum: "$duplicates" },
                blocked: { $sum: "$blocked" },
                errors: { $sum: "$errors" },
                roleMismatch:      { $sum: { $ifNull: ["$skipsRollup.roleMismatch", 0] } },
                seniorityMismatch: { $sum: { $ifNull: ["$skipsRollup.seniorityMismatch", 0] } },
                locationMismatch:  { $sum: { $ifNull: ["$skipsRollup.locationMismatch", 0] } },
                authMismatch:      { $sum: { $ifNull: ["$skipsRollup.authMismatch", 0] } },
                threshold:         { $sum: { $ifNull: ["$skipsRollup.threshold", 0] } },
                companyBlocked:    { $sum: { $ifNull: ["$skipsRollup.companyBlocked", 0] } },
                otherSkip:         { $sum: { $ifNull: ["$skipsRollup.other", 0] } },
                sessions: { $sum: 1 },
                firstSessionAt: { $min: "$startedAt" },
                lastSessionAt: { $max: "$endedAt" },
              },
            },
          ]);
        } catch {
          return [];
        }
      })(),
      // Removed jobs per client: total removed + the AI subset (removedBy:'AI'
      // or currentStatus "… by AI"). Powers the Removed / Removed-by-AI split.
      JobModel.aggregate([
        { $match: { currentStatus: { $regex: /^(deleted|removed)/i } } },
        {
          $group: {
            _id: "$userID",
            removed: { $sum: 1 },
            removedByAI: {
              $sum: {
                $cond: [
                  {
                    $or: [
                      { $eq: ["$removedBy", "AI"] },
                      { $regexMatch: { input: { $ifNull: ["$currentStatus", ""] }, regex: /by ai$/i } },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
          },
        },
      ]),
      // AI second-stage FLAGS per client (secondJudge.status:'failed'). These
      // are kept jobs the AI flagged for operator review (not removed).
      JobModel.aggregate([
        { $match: { "secondJudge.status": "failed" } },
        { $group: { _id: "$userID", count: { $sum: 1 } } },
      ]),
    ]);

    const opsLifetimeBy = new Map();
    for (const r of opsLifetime) opsLifetimeBy.set(String(r._id || "").toLowerCase(), r.count);
    const opsTodayBy = new Map();
    for (const r of opsToday) opsTodayBy.set(String(r._id || "").toLowerCase(), r.count);
    const allBy = new Map();
    for (const r of allLifetime) allBy.set(String(r._id || "").toLowerCase(), r.count);
    const removedBy = new Map();
    for (const r of removedAgg) {
      removedBy.set(String(r._id || "").toLowerCase(), {
        removed: r.removed || 0,
        removedByAI: r.removedByAI || 0,
      });
    }
    const flaggedBy = new Map();
    for (const r of flaggedAgg) flaggedBy.set(String(r._id || "").toLowerCase(), r.count || 0);
    const userByEmail = new Map();
    for (const u of users) userByEmail.set(String(u.email || "").toLowerCase(), u);

    // Per-client operator breakdown map: { clientEmail -> [{operator, count, todayCount, lastPushAt}] }
    const perClientOps = new Map();
    for (const row of perClientOperators) {
      const email = String(row._id?.userID || "").toLowerCase();
      if (!email) continue;
      if (!perClientOps.has(email)) perClientOps.set(email, []);
      perClientOps.get(email).push({
        operator: row._id.operator || "(unknown)",
        count: row.count,
        todayCount: row.todayCount || 0,
        lastPushAt: row.lastPushAt || null,
      });
    }

    // Extension stats per client (sum across operators) + per-operator detail.
    const extByClient = new Map();
    const extByClientOperator = new Map();
    for (const r of sessionStats) {
      const c = String(r._id?.client || "").toLowerCase();
      const op = r._id?.operator || "(unknown)";
      if (!c) continue;
      const totalSkipsExceptRole = (r.threshold || 0) + (r.seniorityMismatch || 0)
        + (r.locationMismatch || 0) + (r.authMismatch || 0)
        + (r.companyBlocked || 0) + (r.otherSkip || 0);
      const totalRejected = (r.roleMismatch || 0) + totalSkipsExceptRole;

      const cur = extByClient.get(c) || {
        captures: 0, linkedinSkipped: 0, pushed: 0, judged: 0, picks: 0,
        rejected: 0, roleMismatch: 0, otherSkip: 0,
        sessions: 0, firstSessionAt: null, lastSessionAt: null,
      };
      cur.captures        += r.captures || 0;
      cur.linkedinSkipped += r.linkedinSkipped || 0;
      cur.pushed          += r.pushed || 0;
      cur.judged          += r.judged || 0;
      cur.picks           += r.picks || 0;
      cur.rejected        += totalRejected;
      cur.roleMismatch    += r.roleMismatch || 0;
      cur.otherSkip       += totalSkipsExceptRole;
      cur.sessions        += r.sessions || 1;
      if (r.firstSessionAt && (!cur.firstSessionAt || r.firstSessionAt < cur.firstSessionAt)) cur.firstSessionAt = r.firstSessionAt;
      if (r.lastSessionAt  && (!cur.lastSessionAt  || r.lastSessionAt  > cur.lastSessionAt))  cur.lastSessionAt  = r.lastSessionAt;
      extByClient.set(c, cur);

      extByClientOperator.set(`${c}::${op}`, {
        extensionCode: r.extensionCode || "",
        captures: r.captures || 0,
        linkedinSkipped: r.linkedinSkipped || 0,
        pushed: r.pushed || 0,
        judged: r.judged || 0,
        picks: r.picks || 0,
        rejected: totalRejected,
        roleMismatch: r.roleMismatch || 0,
        otherSkip: totalSkipsExceptRole,
        duplicates: r.duplicates || 0,
        blocked: r.blocked || 0,
        errors: r.errors || 0,
        sessions: r.sessions || 1,
        firstSessionAt: r.firstSessionAt || null,
        lastSessionAt: r.lastSessionAt || null,
      });
    }

    let withSummary = 0;
    let withCap = 0;
    let opsTotal = 0;
    let opsTodayTotal = 0;
    let staleCount = 0;
    let captureSessionsToday = 0;
    let linkedinSkippedTotal = 0;
    let removedTotal = 0;
    let removedByAITotal = 0;
    let flaggedByAITotal = 0;

    const rows = profiles
      .map((p) => {
        const email = String(p.email || "").toLowerCase();
        const u = userByEmail.get(email);
        const opsLife = opsLifetimeBy.get(email) || 0;
        const opsTodayCount = opsTodayBy.get(email) || 0;
        const all = allBy.get(email) || 0;
        const rawCap = Number(p.targetJobCount);
        const explicitCap = Number.isFinite(rawCap) && rawCap > 0 ? rawCap : null;
        const effectiveCap = explicitCap ?? DEFAULT_CAP;
        const hasSummary = p.hasSummary === true;
        const summaryStale = p.summaryStale !== false;
        if (hasSummary) withSummary += 1;
        if (hasSummary && summaryStale) staleCount += 1;
        if (explicitCap != null) withCap += 1;
        opsTotal += opsLife;
        opsTodayTotal += opsTodayCount;

        let capStatus;
        if (opsTodayCount >= effectiveCap) capStatus = opsTodayCount > effectiveCap ? "over" : "reached";
        else capStatus = "within";

        const fullName =
          (u?.name && u.name.trim()) ||
          [p.firstName, p.lastName].filter(Boolean).join(" ").trim() ||
          email;

        const ext = extByClient.get(email);
        if (ext) linkedinSkippedTotal += ext.linkedinSkipped;

        const rem = removedBy.get(email) || { removed: 0, removedByAI: 0 };
        removedTotal += rem.removed;
        removedByAITotal += rem.removedByAI;
        const flaggedByAI = flaggedBy.get(email) || 0;
        flaggedByAITotal += flaggedByAI;

        // Per-client operator chips. Carries the full ExtensionSessionStat
        // rollup so the UI can render an English breakdown sentence per
        // operator (scraped X · LinkedIn Y · rejected Z · saved W).
        const ops = (perClientOps.get(email) || []).map((row) => {
          const ek = extByClientOperator.get(`${email}::${row.operator}`);
          return {
            operator: row.operator,
            count: row.count,
            todayCount: row.todayCount,
            lastPushAt: row.lastPushAt,
            // Extension-reported lifetime metadata (null when this operator
            // hasn't run a session for this client through v1.15+ extension).
            extensionCode: ek?.extensionCode || "",
            captures: ek?.captures || 0,
            linkedinSkipped: ek?.linkedinSkipped || 0,
            judged: ek?.judged || 0,
            picks: ek?.picks || 0,
            rejected: ek?.rejected || 0,
            roleMismatch: ek?.roleMismatch || 0,
            otherSkip: ek?.otherSkip || 0,
            pushedExt: ek?.pushed || 0,
            sessions: ek?.sessions || 0,
            firstSessionAt: ek?.firstSessionAt || null,
            lastSessionAt: ek?.lastSessionAt || null,
          };
        });

        return {
          email,
          name: fullName,
          planType: u?.planType || "",
          preferredRoles: Array.isArray(p.preferredRoles) ? p.preferredRoles : [],
          preferredLocations: Array.isArray(p.preferredLocations) ? p.preferredLocations : [],
          hasSummary,
          summaryStale,
          summaryBuiltAt: p.aiSummaryMeta?.builtAt || null,
          summaryWordCount: p.aiSummaryMeta?.wordCount || 0,
          summarySource: p.aiSummaryMeta?.source || "",
          targetJobCount: explicitCap,
          effectiveCap,
          isDefaultCap: explicitCap == null,
          currentOpsCount: opsLife,
          currentOpsToday: opsTodayCount,
          currentAllCount: all,
          removed: rem.removed,
          removedByAI: rem.removedByAI,
          flaggedByAI,
          capRemaining: Math.max(0, effectiveCap - opsTodayCount),
          capStatus,
          operatorBreakdown: ops,
          extensionStats: ext
            ? {
                captures: ext.captures,
                linkedinSkipped: ext.linkedinSkipped,
                pushed: ext.pushed,
                lastSessionAt: ext.lastSessionAt,
              }
            : null,
        };
      })
      .sort((a, b) => {
        if (b.currentOpsToday !== a.currentOpsToday) return b.currentOpsToday - a.currentOpsToday;
        if (b.currentOpsCount !== a.currentOpsCount) return b.currentOpsCount - a.currentOpsCount;
        return a.name.localeCompare(b.name);
      });

    return res.json({
      success: true,
      totals: {
        clients: rows.length,
        withSummary,
        withoutSummary: rows.length - withSummary,
        stale: staleCount,
        withCap,
        opsTotal,
        opsToday: opsTodayTotal,
        linkedinSkippedTotal,
        removedTotal,
        removedByAITotal,
        flaggedByAITotal,
      },
      operators: operatorAgg.map((o) => ({
        operator: o.operator || "(unknown)",
        jobsLifetime: o.jobsLifetime,
        jobsToday: o.jobsToday,
        clientsServed: o.clientsServed,
        lastPushAt: o.lastPushAt,
      })),
      rows,
    });
  } catch (err) {
    console.error("SummariesOverview error:", err);
    return res
      .status(500)
      .json({ success: false, error: "INTERNAL", message: err.message });
  }
}
