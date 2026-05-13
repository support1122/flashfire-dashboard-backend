// scrapeCostNotifier — fires a Discord webhook each time today's cumulative
// extension scrape count crosses a 5000-multiple milestone (5k, 10k, 15k,
// 20k, …). Idempotent per day: the last-fired milestone is stored in
// AppSettings so a duplicate POST never fires even when the backend
// restarts mid-day.
//
// Cost math (kept inline so the same numbers show in the Discord post AND
// in any future UI tile):
//   BATCH = 8 jobs per OpenAI call
//   Avg input per batch  ≈ 8 × 1100 input-tokens (~4.5k chars JD * 8)
//                        ≈ 8,800 input tokens
//   Avg output per batch ≈ 500 output tokens (JSON decision array)
//   gpt-4o-mini price    = $0.15 / 1M input + $0.60 / 1M output
//   ⇒ per-batch cost = (8800/1M × 0.15) + (500/1M × 0.60) = $0.00162
//   ⇒ per-job   cost = $0.00162 / 8 = $0.000_2025 per scraped job
//   FX (fixed)         = ₹94 / USD  (user-requested constant)
//
// Override either field via env (OPENAI_INPUT_PER_M, OPENAI_OUTPUT_PER_M,
// USD_INR_FIXED) — defaults are the values above.

import axios from "axios";
import { AppSettingsModel } from "../Schema_Models/AppSettings.js";
import { ExtensionSessionStat } from "../Schema_Models/ExtensionSessionStat.js";

const MILESTONE_STEP = 5000;
const BATCH_SIZE = Number(process.env.AI_BATCH_SIZE) || 8;
const INPUT_PER_M = Number(process.env.OPENAI_INPUT_PER_M) || 0.15;     // USD per 1M input tokens
const OUTPUT_PER_M = Number(process.env.OPENAI_OUTPUT_PER_M) || 0.60;   // USD per 1M output tokens
const TOKENS_PER_BATCH_IN = Number(process.env.AI_TOKENS_IN_PER_BATCH) || 8800;
const TOKENS_PER_BATCH_OUT = Number(process.env.AI_TOKENS_OUT_PER_BATCH) || 500;
const FX_USD_INR = Number(process.env.USD_INR_FIXED) || 94;

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

// estimateScrapeCost: pure math, no I/O. Returns USD + INR + per-job cost
// so the Discord embed AND any future cost dashboard read the SAME numbers.
export function estimateScrapeCost(scrapedJobs) {
    const n = Math.max(0, Number(scrapedJobs) || 0);
    const batches = Math.ceil(n / BATCH_SIZE);
    const inputTokens = batches * TOKENS_PER_BATCH_IN;
    const outputTokens = batches * TOKENS_PER_BATCH_OUT;
    const usd = (inputTokens / 1_000_000) * INPUT_PER_M
              + (outputTokens / 1_000_000) * OUTPUT_PER_M;
    return {
        scraped: n,
        batches,
        inputTokens,
        outputTokens,
        usd: Number(usd.toFixed(6)),
        inr: Number((usd * FX_USD_INR).toFixed(2)),
        perJobUsd: n ? Number((usd / n).toFixed(6)) : 0,
        perJobInr: n ? Number(((usd * FX_USD_INR) / n).toFixed(4)) : 0,
        fxRate: FX_USD_INR,
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
    };
}

// Sum captures across ALL ExtensionSessionStat rows for today (IST).
async function getTodayTotalScraped() {
    const todayStart = startOfTodayIST();
    const r = await ExtensionSessionStat.aggregate([
        { $match: { $or: [
            { endedAt:   { $gte: todayStart } },
            { startedAt: { $gte: todayStart } },
            { updatedAt: { $gte: todayStart } },
        ] } },
        { $group: { _id: null, captures: { $sum: "$captures" } } },
    ]);
    return r?.[0]?.captures || 0;
}

// Atomically claim a milestone. Returns the milestone integer (5000 * k)
// on success, null when already fired today. Idempotent across restarts.
async function claimMilestone(today, currentTotal) {
    const target = Math.floor(currentTotal / MILESTONE_STEP) * MILESTONE_STEP;
    if (target < MILESTONE_STEP) return null;
    const fieldKey = `scrapeMilestones.${today}`;
    // findOneAndUpdate w/ $max — only writes when target > stored value.
    const updated = await AppSettingsModel.findOneAndUpdate(
        { key: "singleton" },
        { $max: { [fieldKey]: target } },
        { upsert: true, new: true, lean: true },
    );
    const stored = updated?.scrapeMilestones?.[today] || 0;
    // We won the race only when stored EQUALS target AND prior was lower.
    // Easiest: check stored === target AND $max actually bumped it. Since
    // we can't easily detect the prior value, fall back to: was this
    // milestone already announced? Look at a separate "fired" sub-map.
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
    const embed = {
        title: `📈 Scrape milestone: ${milestone.toLocaleString()} jobs today`,
        description: `Today (${today} IST) the JR-Direct extension has captured **${milestone.toLocaleString()}** jobs across all operators.`,
        color: 0x10b981,
        fields: [
            { name: "Today scraped",   value: `**${costInfo.scraped.toLocaleString()}** jobs`, inline: true },
            { name: "AI batches",      value: `${costInfo.batches.toLocaleString()} × ${BATCH_SIZE} jobs`, inline: true },
            { name: "Model",           value: `\`${costInfo.model}\``, inline: true },
            { name: "Input tokens",    value: costInfo.inputTokens.toLocaleString(), inline: true },
            { name: "Output tokens",   value: costInfo.outputTokens.toLocaleString(), inline: true },
            { name: "FX rate (fixed)", value: `₹${costInfo.fxRate} / USD`, inline: true },
            { name: "Cost (USD)",      value: `**$${costInfo.usd.toFixed(4)}**`, inline: true },
            { name: "Cost (INR)",      value: `**₹${costInfo.inr.toFixed(2)}**`, inline: true },
            { name: "Per-job cost",    value: `$${costInfo.perJobUsd.toFixed(6)} · ₹${costInfo.perJobInr.toFixed(4)}`, inline: true },
        ],
        footer: { text: `Rate: $${INPUT_PER_M}/1M in · $${OUTPUT_PER_M}/1M out · ${TOKENS_PER_BATCH_IN}/${TOKENS_PER_BATCH_OUT} tokens per batch` },
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
// no milestone — one aggregation + one findOneAndUpdate. No-op when
// webhook env unset. Always fire-and-forget from the caller.
export async function checkAndNotifyScrapeMilestone() {
    try {
        const today = istDateKey();
        const total = await getTodayTotalScraped();
        if (total < MILESTONE_STEP) return; // nothing to do under first threshold
        const milestone = await claimMilestone(today, total);
        if (!milestone) return; // already announced
        const cost = estimateScrapeCost(milestone);
        await fireDiscord(milestone, cost, today);
    } catch (err) {
        console.warn("[scrapeCostNotifier] check failed:", err.message);
    }
}
