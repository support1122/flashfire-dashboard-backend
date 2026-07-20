// GET /admin/ai-cost?day=YYYY-MM-DD&days=N
//
// The reconciliation endpoint. Returns REAL AI spend for one IST day (or the
// last N days), broken down by pipeline and model, priced from token counts the
// providers actually reported — not from per-batch guesses.
//
// This exists so a number in Discord can be checked against the OpenAI usage
// dashboard. If the two disagree, the `coverage` block tells you why:
//   • notMeasured        — pipelines still running on estimates
//   • callsMissingUsage  — calls whose response carried no usage block
//   • the note about other services sharing the same API key
//
// Response:
//   { success, day, totalUsd, totalInr, bySource[], byModel[], coverage{} }

import { getDailyUsage, istDay } from "../Utils/aiUsage.js";
import { AiUsageDaily } from "../Schema_Models/AiUsageDaily.js";
import { priceTokens, inr, AI_RATES, FX_USD_INR } from "../Utils/aiRateCard.js";

function dayMinus(day, n) {
    const d = new Date(`${day}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - n);
    return d.toISOString().slice(0, 10);
}

export default async function AiCostReport(req, res) {
    try {
        const day = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.day || ""))
            ? String(req.query.day)
            : istDay();
        const span = Math.min(90, Math.max(1, Number(req.query.days) || 1));

        if (span === 1) {
            const u = await getDailyUsage(day);
            // Same tokens, regrouped by model — this is the view that answers
            // "is gpt-4o quietly eating the budget?", which per-source hides
            // when one pipeline can fall back between models.
            const byModel = new Map();
            for (const r of u.rows) {
                const m = byModel.get(r.model) || { model: r.model, calls: 0, inputTokens: 0, cachedTokens: 0, outputTokens: 0, usd: 0 };
                m.calls += r.calls;
                m.inputTokens += r.inputTokens;
                m.cachedTokens += r.cachedTokens;
                m.outputTokens += r.outputTokens;
                m.usd += r.usd;
                byModel.set(r.model, m);
            }
            return res.json({
                success: true,
                day,
                totalUsd: Number(u.totalUsd.toFixed(6)),
                totalInr: Number(u.totalInr.toFixed(2)),
                cacheSavedUsd: Number((u.cacheSavedUsd || 0).toFixed(6)),
                bySource: u.rows.map((r) => ({ ...r, usd: Number(r.usd.toFixed(6)), inr: Number(r.inr.toFixed(2)) })),
                byModel: [...byModel.values()]
                    .map((m) => ({ ...m, usd: Number(m.usd.toFixed(6)), inr: Number(inr(m.usd).toFixed(2)) }))
                    .sort((a, b) => b.usd - a.usd),
                coverage: {
                    complete: u.complete,
                    callsMissingUsage: u.callsMissingUsage,
                    note: "Backend-recorded calls only. Stage-1 judge batches run in the extension and are reported via ExtensionSessionStat.modelStats, not here. Will not match the OpenAI invoice if other services share the API key.",
                },
                rateCard: AI_RATES,
                fxRate: FX_USD_INR,
            });
        }

        // Multi-day trend.
        const days = Array.from({ length: span }, (_, i) => dayMinus(day, i));
        const docs = await AiUsageDaily.find({ day: { $in: days } }).lean();
        const byDay = new Map(days.map((d) => [d, { day: d, usd: 0, calls: 0 }]));
        for (const d of docs) {
            const p = priceTokens({
                model: d.model,
                inputTokens: d.inputTokens,
                cachedTokens: d.cachedInputTokens,
                outputTokens: d.outputTokens,
            });
            const row = byDay.get(d.day);
            if (!row) continue;
            row.usd += p.usd;
            row.calls += d.calls || 0;
        }
        const series = [...byDay.values()]
            .map((r) => ({ day: r.day, calls: r.calls, usd: Number(r.usd.toFixed(6)), inr: Number(inr(r.usd).toFixed(2)) }))
            .sort((a, b) => a.day.localeCompare(b.day));
        const totalUsd = series.reduce((a, r) => a + r.usd, 0);
        return res.json({
            success: true,
            from: series[0]?.day,
            to: series[series.length - 1]?.day,
            totalUsd: Number(totalUsd.toFixed(6)),
            totalInr: Number(inr(totalUsd).toFixed(2)),
            series,
            fxRate: FX_USD_INR,
        });
    } catch (err) {
        console.error("[AiCostReport] error:", err?.message || err);
        return res.status(500).json({ success: false, error: "INTERNAL", message: err.message });
    }
}
