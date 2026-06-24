// scrapeCostNotifier — fires a Discord webhook each time today's cumulative
// extension scrape count crosses a 5000-multiple milestone (5k, 10k, 15k,
// 20k, …). Idempotent per day: the last-fired milestone is stored in
// AppSettings so a duplicate POST never fires even when the backend
// restarts mid-day.
//
// Cost model (OpenAI gpt-4o-mini, server-side — no extension reporting needed)
// ---------------------------------------------------------------------------
// Backend only knows the scrape count (from ExtensionSessionStat captures), so
// cost is derived from per-batch averages:
//   batches      = ceil(jobs / AI_BATCH_SIZE)
//   input tokens = batches × AI_TOKENS_IN_PER_BATCH   (avg)
//   output       = batches × AI_TOKENS_OUT_PER_BATCH  (avg)
//   cached input = batches × AI_CACHED_TOKENS_PER_BATCH (the fixed grader
//                  prompt, reused across batches; OpenAI bills cached at 50%)
//   gpt-4o-mini  = $0.15 / 1M in · $0.60 / 1M out · cached in at 50%
//   FX (fixed)   = ₹94 / USD
// Override via env: OPENAI_INPUT_PER_M, OPENAI_OUTPUT_PER_M, USD_INR_FIXED,
//   AI_TOKENS_IN_PER_BATCH, AI_TOKENS_OUT_PER_BATCH, AI_CACHED_TOKENS_PER_BATCH,
//   AI_BATCH_SIZE.

import axios from "axios";
import { AppSettingsModel } from "../Schema_Models/AppSettings.js";
import { ExtensionSessionStat } from "../Schema_Models/ExtensionSessionStat.js";
import { JobModel } from "../Schema_Models/JobModel.js";

const MILESTONE_STEP = 5000;
const BATCH_SIZE = Number(process.env.AI_BATCH_SIZE) || 8;
// Low-end averages: first judge runs on JobRight's own short description (no
// scraper enrichment), so input/batch is small. Conservative (lower) defaults.
const TOKENS_PER_BATCH_IN = Number(process.env.AI_TOKENS_IN_PER_BATCH) || 3500;
const TOKENS_PER_BATCH_OUT = Number(process.env.AI_TOKENS_OUT_PER_BATCH) || 400;
// Fixed grader prompt reused every batch → cached after the first hit. Billed
// at 50%. Conservative default ≈ the system prompt size.
const CACHED_TOKENS_PER_BATCH = Number(process.env.AI_CACHED_TOKENS_PER_BATCH) || 1800;
// Second-stage screening (secondJudgeWorker): 1 OpenAI call PER pushed job on
// the scraped real-site text. No batching. Avg tokens per call (low-end).
const SECOND_TOKENS_IN = Number(process.env.AI2_TOKENS_IN_PER_CALL) || 2700;
const SECOND_TOKENS_OUT = Number(process.env.AI2_TOKENS_OUT_PER_CALL) || 120;
const FX_USD_INR = Number(process.env.USD_INR_FIXED) || 94;

const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const OPENAI_INPUT_PER_M = Number(process.env.OPENAI_INPUT_PER_M) || 0.15;
const OPENAI_OUTPUT_PER_M = Number(process.env.OPENAI_OUTPUT_PER_M) || 0.60;

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

// Sum captures across ALL ExtensionSessionStat rows for today (IST).
async function getTodayTotalScraped() {
    const r = await ExtensionSessionStat.aggregate([
        { $match: todayMatch() },
        { $group: { _id: null, captures: { $sum: "$captures" } } },
    ]);
    return r?.[0]?.captures || 0;
}

// Count today's second-stage screening runs (1 OpenAI call each). Terminal
// secondJudge states with a completedAt today (IST).
async function getTodaySecondJudgeRuns() {
    try {
        return await JobModel.countDocuments({
            "secondJudge.completedAt": { $gte: startOfTodayIST() },
        });
    } catch {
        return 0;
    }
}

// estimateScrapeCost — pure math, no I/O. OpenAI gpt-4o-mini only, priced from
// per-batch averages + the cached (prompt-reuse) portion at 50%.
export function estimateScrapeCost(scrapedJobs, secondRuns = 0) {
    const n = Math.max(0, Number(scrapedJobs) || 0);
    const batches = Math.ceil(n / BATCH_SIZE);
    const inputTokens = batches * TOKENS_PER_BATCH_IN;
    const outputTokens = batches * TOKENS_PER_BATCH_OUT;
    const cachedTokens = Math.min(inputTokens, batches * CACHED_TOKENS_PER_BATCH);

    // Stage 1 — first judge (extension, batched on JobRight desc).
    const usd =
        ((inputTokens - cachedTokens) / 1_000_000) * OPENAI_INPUT_PER_M +
        (cachedTokens / 1_000_000) * (OPENAI_INPUT_PER_M * 0.5) +
        (outputTokens / 1_000_000) * OPENAI_OUTPUT_PER_M;
    const cacheSavedUsd = (cachedTokens / 1_000_000) * (OPENAI_INPUT_PER_M * 0.5);

    // Stage 2 — second judge (dashboard backend, 1 call per pushed job).
    const s = Math.max(0, Number(secondRuns) || 0);
    const secondIn = s * SECOND_TOKENS_IN;
    const secondOut = s * SECOND_TOKENS_OUT;
    const secondUsd =
        (secondIn / 1_000_000) * OPENAI_INPUT_PER_M +
        (secondOut / 1_000_000) * OPENAI_OUTPUT_PER_M;

    const totalUsd = usd + secondUsd;

    return {
        scraped: n,
        batches,
        inputTokens,
        outputTokens,
        cachedTokens,
        usd: Number(usd.toFixed(6)),
        inr: Number((usd * FX_USD_INR).toFixed(2)),
        cacheSavedUsd: Number(cacheSavedUsd.toFixed(6)),
        cacheSavedInr: Number((cacheSavedUsd * FX_USD_INR).toFixed(2)),
        second: {
            runs: s,
            inputTokens: secondIn,
            outputTokens: secondOut,
            usd: Number(secondUsd.toFixed(6)),
            inr: Number((secondUsd * FX_USD_INR).toFixed(2)),
        },
        totalUsd: Number(totalUsd.toFixed(6)),
        totalInr: Number((totalUsd * FX_USD_INR).toFixed(2)),
        perJobUsd: n ? Number((totalUsd / n).toFixed(6)) : 0,
        perJobInr: n ? Number(((totalUsd * FX_USD_INR) / n).toFixed(4)) : 0,
        fxRate: FX_USD_INR,
        model: OPENAI_MODEL,
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

    const cachePct = costInfo.inputTokens ? Math.round((costInfo.cachedTokens / costInfo.inputTokens) * 100) : 0;
    const fields = [
        { name: "Today scraped", value: `**${costInfo.scraped.toLocaleString()}** jobs`, inline: true },
        { name: "AI batches", value: `${costInfo.batches.toLocaleString()} × ${BATCH_SIZE} jobs`, inline: true },
        { name: "Model", value: `\`${costInfo.model}\``, inline: true },
        { name: "Input tokens", value: costInfo.inputTokens.toLocaleString(), inline: true },
        { name: "Output tokens", value: costInfo.outputTokens.toLocaleString(), inline: true },
        { name: "Cached input (50% off)", value: `${costInfo.cachedTokens.toLocaleString()} (${cachePct}%)`, inline: true },
        { name: "💰 Prompt-cache saved", value: `$${costInfo.cacheSavedUsd.toFixed(4)} · ₹${costInfo.cacheSavedInr.toFixed(2)}`, inline: true },
        { name: "FX rate (fixed)", value: `₹${costInfo.fxRate} / USD`, inline: true },
        { name: "Stage 1 — first judge", value: `$${costInfo.usd.toFixed(4)} · ₹${costInfo.inr.toFixed(2)}`, inline: true },
        { name: "Stage 2 — second judge", value: `${costInfo.second.runs.toLocaleString()} runs · $${costInfo.second.usd.toFixed(4)} · ₹${costInfo.second.inr.toFixed(2)}`, inline: true },
        { name: "💵 TOTAL cost", value: `**$${costInfo.totalUsd.toFixed(4)} · ₹${costInfo.totalInr.toFixed(2)}**`, inline: true },
        { name: "Per-job (all-in)", value: `$${costInfo.perJobUsd.toFixed(6)} · ₹${costInfo.perJobInr.toFixed(4)}`, inline: true },
    ];

    const embed = {
        title: `📈 Scrape milestone: ${milestone.toLocaleString()} jobs today`,
        description: `Today (${today} IST) the JR-Direct extension has captured **${milestone.toLocaleString()}** jobs across all operators.`,
        color: 0x10b981,
        fields,
        footer: { text: `OpenAI ${costInfo.model} · $${OPENAI_INPUT_PER_M}/1M in · $${OPENAI_OUTPUT_PER_M}/1M out · stage1 ${TOKENS_PER_BATCH_IN}/${TOKENS_PER_BATCH_OUT} tok/batch (~${CACHED_TOKENS_PER_BATCH} cached, 50% off) · stage2 ${SECOND_TOKENS_IN}/${SECOND_TOKENS_OUT} tok/run` },
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
// no milestone — one aggregation + one findOneAndUpdate. No-op when webhook
// env unset. Always fire-and-forget from the caller.
export async function checkAndNotifyScrapeMilestone() {
    try {
        const today = istDateKey();
        const total = await getTodayTotalScraped();
        if (total < MILESTONE_STEP) return; // nothing to do under first threshold
        const milestone = await claimMilestone(today, total);
        if (!milestone) return; // already announced
        const secondRuns = await getTodaySecondJudgeRuns();
        await fireDiscord(milestone, estimateScrapeCost(milestone, secondRuns), today);
    } catch (err) {
        console.warn("[scrapeCostNotifier] check failed:", err.message);
    }
}
