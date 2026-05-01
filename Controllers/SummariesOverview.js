// SummariesOverview: one aggregate so the admin "AI Summaries" page can
// render the master list (every client with summary status + push count
// + cap progress) without N+1 round-trips.
//
// Output shape:
//   {
//     success: true,
//     totals: { clients, withSummary, withoutSummary, withCap, opsTotal },
//     rows: [{
//       email, name, planType, preferredRoles, preferredLocations,
//       hasSummary, summaryBuiltAt, summaryWordCount, summarySource,
//       targetJobCount, currentOpsCount, currentAllCount, capRemaining,
//       capStatus: 'no-cap' | 'within' | 'reached' | 'over',
//     }]
//   }

import { ProfileModel } from "../Schema_Models/ProfileModel.js";
import { JobModel } from "../Schema_Models/JobModel.js";
import { UserModel } from "../Schema_Models/UserModel.js";

export default async function SummariesOverview(req, res) {
  try {
    // 1) all profiles — only the fields we need for the list view.
    const profiles = await ProfileModel.find(
      {},
      {
        email: 1,
        firstName: 1,
        lastName: 1,
        preferredRoles: 1,
        preferredLocations: 1,
        aiSummary: 1,
        aiSummaryMeta: 1,
        targetJobCount: 1,
        summaryStale: 1,
      },
    ).lean();

    // 2) ops-pushed counts per client, in one pipeline.
    const opsCounts = await JobModel.aggregate([
      { $match: { createdByRole: "operations" } },
      { $group: { _id: "$userID", count: { $sum: 1 } } },
    ]);
    const opsByEmail = new Map();
    for (const r of opsCounts) {
      opsByEmail.set(String(r._id || "").toLowerCase(), r.count);
    }

    // 3) all-roles counts (so we can show "all jobs" in the side list too).
    const allCounts = await JobModel.aggregate([
      { $group: { _id: "$userID", count: { $sum: 1 } } },
    ]);
    const allByEmail = new Map();
    for (const r of allCounts) {
      allByEmail.set(String(r._id || "").toLowerCase(), r.count);
    }

    // 4) plan + name from UserModel (some Profiles have firstName/lastName,
    //    others rely on UserModel.name — pull both).
    const users = await UserModel.find({}, { email: 1, name: 1, planType: 1 }).lean();
    const userByEmail = new Map();
    for (const u of users) {
      userByEmail.set(String(u.email || "").toLowerCase(), u);
    }

    let withSummary = 0;
    let withCap = 0;
    let opsTotal = 0;
    let staleCount = 0;

    const rows = profiles
      .map((p) => {
        const email = String(p.email || "").toLowerCase();
        const u = userByEmail.get(email);
        const ops = opsByEmail.get(email) || 0;
        const all = allByEmail.get(email) || 0;
        const cap = Number.isFinite(Number(p.targetJobCount)) && p.targetJobCount > 0
          ? p.targetJobCount
          : null;
        const hasSummary = !!(p.aiSummary && p.aiSummary.trim());
        const summaryStale = p.summaryStale !== false; // default true
        if (hasSummary) withSummary += 1;
        if (hasSummary && summaryStale) staleCount += 1;
        if (cap != null) withCap += 1;
        opsTotal += ops;

        let capStatus = "no-cap";
        if (cap != null) {
          if (ops >= cap) capStatus = ops > cap ? "over" : "reached";
          else capStatus = "within";
        }

        const fullName =
          (u?.name && u.name.trim())
          || [p.firstName, p.lastName].filter(Boolean).join(" ").trim()
          || email;

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
          targetJobCount: cap,
          currentOpsCount: ops,
          currentAllCount: all,
          capRemaining: cap != null ? Math.max(0, cap - ops) : null,
          capStatus,
        };
      })
      .sort((a, b) => {
        // Recent push first → easier to spot active clients.
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
      },
      rows,
    });
  } catch (err) {
    console.error("SummariesOverview error:", err);
    return res
      .status(500)
      .json({ success: false, error: "INTERNAL", message: err.message });
  }
}
