// scrapeCostNotifier — fires a Discord webhook each time today's cumulative
// extension scrape count crosses a 5000-multiple milestone (5k, 10k, 15k,
// 20k, …). Idempotent per day: the last-fired milestone is stored in
// AppSettings so a duplicate POST never fires even when the backend
// restarts mid-day.
//
// Judge-model split
// -----------------
// The JR-Direct extension routes ~10-15% of its AI-judge batches to Gemini
// 2.5 Flash Lite (via /extension/gemini-judge → Vertex AI); the rest run on
// OpenAI gpt-4o-mini. Each session reports modelStats { geminiBatches,
// geminiErrors, openaiBatches }. This notifier aggregates today's real
// modelStats and prices each model with its own rate, so the milestone
// embed shows the genuine split + the genuine Gemini error count. When no
// modelStats exist yet (older extension builds) it falls back to an
// all-OpenAI estimate.
//
// Cost math (per 8-job batch):
//   Avg input  ≈ 8,800 input tokens   Avg output ≈ 500 output tokens
//   gpt-4o-mini        = $0.15 / 1M in  · $0.60 / 1M out
//   gemini-2.5-flash-lite = $0.10 / 1M in · $0.40 / 1M out
//   FX (fixed)         = ₹94 / USD
// Override via env: OPENAI_INPUT_PER_M, OPENAI_OUTPUT_PER_M,
//   GEMINI_INPUT_PER_M, GEMINI_OUTPUT_PER_M, USD_INR_FIXED,
//   AI_TOKENS_IN_PER_BATCH, AI_TOKENS_OUT_PER_BATCH, AI_BATCH_SIZE.

import axios from "axios";
import { AppSettingsModel } from "../Schema_Models/AppSettings.js";
import { ExtensionSessionStat } from "../Schema_Models/ExtensionSessionStat.js";

const MILESTONE_STEP = 5000;
const BATCH_SIZE = Number(process.env.AI_BATCH_SIZE) || 8;
const TOKENS_PER_BATCH_IN = Number(process.env.AI_TOKENS_IN_PER_BATCH) || 8800;
const TOKENS_PER_BATCH_OUT = Number(process.env.AI_TOKENS_OUT_PER_BATCH) || 500;
const FX_USD_INR = Number(process.env.USD_INR_FIXED) || 94;

const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const OPENAI_INPUT_PER_M = Number(process.env.OPENAI_INPUT_PER_M) || 0.15;
const OPENAI_OUTPUT_PER_M = Number(process.env.OPENAI_OUTPUT_PER_M) || 0.60;

const GEMINI_MODEL = process.env.GEMINI_JUDGE_MODEL || "gemini-2.5-flash-lite";
const GEMINI_INPUT_PER_M = Number(process.env.GEMINI_INPUT_PER_M) || 0.10;
const GEMINI_OUTPUT_PER_M = Number(process.env.GEMINI_OUTPUT_PER_M) || 0.40;

// Asia/Kolkata day bucket — matches /addjob daily cap window so all
// milestone counts align with what the AI Summaries UI shows.
function istDateKey(now = new Date()) {
    const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
    return ist.toISOString().slice(0, 10);
}
function startOfTodayIST() {
    const offsetMs = 5.5 * 60 * 60 * 1000;
    const istNow = new Date(Date.now() + offsetMs);
    istNow.setUTCHours(0, 0, 0, 0);
    return new Date(istNow.getTime() - offsetMs);
}

function todayMatch() {
    const todayStart = startOfTodayIST();
    return {
        $or: [
            { endedAt: { $gte: todayStart } },
            { startedAt: { $gte: todayStart } },
            { updatedAt: { $gte: todayStart } },
        ],
    };
}

// getTodayModelStats — sum the real per-model batch counts across every
// ExtensionSessionStat row for today (IST). Returns the genuine split the
// extension performed.
async function getTodayModelStats() {
    const r = await ExtensionSessionStat.aggregate([
        { $match: todayMatch() },
        {
            $group: {
                _id: null,
                geminiBatches: { $sum: { $ifNull: ["$modelStats.geminiBatches", 0] } },
                geminiErrors: { $sum: { $ifNull: ["$modelStats.geminiErrors", 0] } },
                openaiBatches: { $sum: { $ifNull: ["$modelStats.openaiBatches", 0] } },
            },
        },
    ]);
    const g = r?.[0] || {};
    return {
        geminiBatches: g.geminiBatches || 0,
        geminiErrors: g.geminiErrors || 0,
        openaiBatches: g.openaiBatches || 0,
    };
}

// Sum captures across ALL ExtensionSessionStat rows for today (IST).
async function getTodayTotalScraped() {
    const r = await ExtensionSessionStat.aggregate([
        { $match: todayMatch() },
        { $group: { _id: null, captures: { $sum: "$captures" } } },
    ]);
    return r?.[0]?.captures || 0;
}

// estimateScrapeCost — pure math, no I/O. Splits the estimated batch count
// by the REAL Gemini/OpenAI ratio the extension reported and prices each
// model separately. `modelTally` is today's aggregated modelStats; when its
// batch counts are all zero the whole run is priced as OpenAI.
export function estimateScrapeCost(scrapedJobs, modelTally = {}) {
    const n = Math.max(0, Number(scrapedJobs) || 0);
    const totalBatches = Math.ceil(n / BATCH_SIZE);

    const gBatchesReal = Math.max(0, Number(modelTally.geminiBatches) || 0);
    const oBatchesReal = Math.max(0, Number(modelTally.openaiBatches) || 0);
    const geminiErrors = Math.max(0, Number(modelTally.geminiErrors) || 0);
    const reportedBatches = gBatchesReal + oBatchesReal;

    // Real ratio of batches that ran on Gemini. 0 when nothing reported yet.
    const geminiShare = reportedBatches > 0 ? gBatchesReal / reportedBatches : 0;

    const geminiBatches = Math.round(totalBatches * geminiShare);
    const openaiBatches = Math.max(0, totalBatches - geminiBatches);

    const priceBatches = (batches, inPerM, outPerM) => {
        const inputTokens = batches * TOKENS_PER_BATCH_IN;
        const outputTokens = batches * TOKENS_PER_BATCH_OUT;
        const usd = (inputTokens / 1_000_000) * inPerM + (outputTokens / 1_000_000) * outPerM;
        return { batches, inputTokens, outputTokens, usd };
    };

    const openai = priceBatches(openaiBatches, OPENAI_INPUT_PER_M, OPENAI_OUTPUT_PER_M);
    const gemini = priceBatches(geminiBatches, GEMINI_INPUT_PER_M, GEMINI_OUTPUT_PER_M);

    const usd = openai.usd + gemini.usd;
    const inputTokens = openai.inputTokens + gemini.inputTokens;
    const outputTokens = openai.outputTokens + gemini.outputTokens;
    const geminiPct = totalBatches > 0 ? (geminiBatches / totalBatches) * 100 : 0;

    return {
        scraped: n,
        batches: totalBatches,
        inputTokens,
        outputTokens,
        usd: Number(usd.toFixed(6)),
        inr: Number((usd * FX_USD_INR).toFixed(2)),
        perJobUsd: n ? Number((usd / n).toFixed(6)) : 0,
        perJobInr: n ? Number(((usd * FX_USD_INR) / n).toFixed(4)) : 0,
        fxRate: FX_USD_INR,
        hasModelSplit: reportedBatches > 0,
        geminiErrors,
        geminiPct: Number(geminiPct.toFixed(1)),
        openai: {
            model: OPENAI_MODEL,
            batches: openai.batches,
            inputTokens: openai.inputTokens,
            outputTokens: openai.outputTokens,
            usd: Number(openai.usd.toFixed(6)),
        },
        gemini: {
            model: GEMINI_MODEL,
            batches: gemini.batches,
            inputTokens: gemini.inputTokens,
            outputTokens: gemini.outputTokens,
            usd: Number(gemini.usd.toFixed(6)),
        },
    };
}

// Atomically claim a milestone. Returns the milestone integer (5000 * k)
// on success, null when already fired today. Idempotent across restarts.
async function claimMilestone(today, currentTotal) {
    const target = Math.floor(currentTotal / MILESTONE_STEP) * MILESTONE_STEP;
    if (target < MILESTONE_STEP) return null;
    const fieldKey = `scrapeMilestones.${today}`;
    await AppSettingsModel.findOneAndUpdate(
        { key: "singleton" },
        { $max: { [fieldKey]: target } },
        { upsert: true, new: true, lean: true },
    );
    const firedKey = `scrapeMilestonesFired.${today}.${target}`;
    const claim = await AppSettingsModel.findOneAndUpdate(
        { key: "singleton", [firedKey]: { $exists: false } },
        { $set: { [firedKey]: new Date() } },
        { new: false },
    );
    if (!claim) return null; // someone else fired it
    return target;
}

// fireDiscord: post the embed. Pulls webhook from env on each call so
// .env edits take effect without restart. No-op when webhook missing.
async function fireDiscord(milestone, costInfo, today) {
    const webhook = (process.env.DISCORD_SCRAPE_WEBHOOK_URL || "").trim();
    if (!webhook) {
        console.log(`[scrapeCostNotifier] milestone ${milestone} reached but DISCORD_SCRAPE_WEBHOOK_URL not set — skipping`);
        return;
    }

    const fields = [
        { name: "Today scraped", value: `**${costInfo.scraped.toLocaleString()}** jobs`, inline: true },
        { name: "AI batches", value: `${costInfo.batches.toLocaleString()} × ${BATCH_SIZE} jobs`, inline: true },
        { name: "Input tokens", value: costInfo.inputTokens.toLocaleString(), inline: true },
    ];

    if (costInfo.hasModelSplit) {
        fields.push(
            {
                name: `${costInfo.gemini.model} (${costInfo.geminiPct}%)`,
                value: `${costInfo.gemini.batches.toLocaleString()} batches · $${costInfo.gemini.usd.toFixed(4)}`,
                inline: true,
            },
            {
                name: `${costInfo.openai.model} (fallback)`,
                value: `${costInfo.openai.batches.toLocaleString()} batches · $${costInfo.openai.usd.toFixed(4)}`,
                inline: true,
            },
            {
                name: "Gemini errors → OpenAI",
                value: `${costInfo.geminiErrors.toLocaleString()}`,
                inline: true,
            },
        );
    } else {
        fields.push({ name: "Model", value: `\`${costInfo.openai.model}\``, inline: true });
    }

    fields.push(
        { name: "Output tokens", value: costInfo.outputTokens.toLocaleString(), inline: true },
        { name: "FX rate (fixed)", value: `₹${costInfo.fxRate} / USD`, inline: true },
        { name: "Cost (USD)", value: `**$${costInfo.usd.toFixed(4)}**`, inline: true },
        { name: "Cost (INR)", value: `**₹${costInfo.inr.toFixed(2)}**`, inline: true },
        { name: "Per-job cost", value: `$${costInfo.perJobUsd.toFixed(6)} · ₹${costInfo.perJobInr.toFixed(4)}`, inline: true },
    );

    const footer = costInfo.hasModelSplit
        ? `Gemini $${GEMINI_INPUT_PER_M}/1M in · $${GEMINI_OUTPUT_PER_M}/1M out — OpenAI $${OPENAI_INPUT_PER_M}/1M in · $${OPENAI_OUTPUT_PER_M}/1M out`
        : `Rate: $${OPENAI_INPUT_PER_M}/1M in · $${OPENAI_OUTPUT_PER_M}/1M out · ${TOKENS_PER_BATCH_IN}/${TOKENS_PER_BATCH_OUT} tokens per batch`;

    const embed = {
        title: `📈 Scrape milestone: ${milestone.toLocaleString()} jobs today`,
        description: `Today (${today} IST) the JR-Direct extension has captured **${milestone.toLocaleString()}** jobs across all operators.`,
        color: 0x10b981,
        fields,
        footer: { text: footer },
        timestamp: new Date().toISOString(),
    };
    try {
        await axios.post(webhook, { embeds: [embed] }, { timeout: 8000 });
        console.log(`[scrapeCostNotifier] fired milestone ${milestone} → Discord`);
    } catch (err) {
        console.warn(`[scrapeCostNotifier] Discord POST failed for milestone ${milestone}:`, err.message);
    }
}

// checkAndNotify: call after every ExtensionSessionStat upsert. Cheap when
// no milestone — two aggregations + one findOneAndUpdate. No-op when
// webhook env unset. Always fire-and-forget from the caller.
export async function checkAndNotifyScrapeMilestone() {
    try {
        const today = istDateKey();
        const total = await getTodayTotalScraped();
        if (total < MILESTONE_STEP) return; // nothing to do under first threshold
        const milestone = await claimMilestone(today, total);
        if (!milestone) return; // already announced
        const modelTally = await getTodayModelStats();
        const cost = estimateScrapeCost(milestone, modelTally);
        await fireDiscord(milestone, cost, today);
    } catch (err) {
        console.warn("[scrapeCostNotifier] check failed:", err.message);
    }
}
