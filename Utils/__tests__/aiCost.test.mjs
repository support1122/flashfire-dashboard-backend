// Cost-reporting tests. Pure functions only — no Mongo, no network.
//
// The bug these lock down: the milestone embed priced a day from hardcoded
// per-batch averages that measured ~2.3x below the real invoice, and called the
// result "TOTAL cost" while excluding every non-judge pipeline.

import assert from 'node:assert/strict';

const { priceTokens, rateFor } = await import('../aiRateCard.js');
const { normaliseUsage } = await import('../aiUsage.js');
const { stage1Cost, buildCostReport } = await import('../scrapeCostNotifier.js');

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log(`  ok  ${name}`); };

console.log('\n── rate card ──');

t('cached tokens are a SUBSET of input, never added on top', () => {
    // 1M input of which 1M is cached → must cost the cached rate, not in+cached.
    const p = priceTokens({ model: 'gpt-4o-mini', inputTokens: 1_000_000, cachedTokens: 1_000_000, outputTokens: 0 });
    assert.equal(Number(p.usd.toFixed(6)), 0.075);
});

t('cached cannot exceed input (clamped)', () => {
    const p = priceTokens({ model: 'gpt-4o-mini', inputTokens: 100, cachedTokens: 999999, outputTokens: 0 });
    assert.equal(p.cachedTokens, 100);
});

t('cache saving = full rate minus cached rate', () => {
    const p = priceTokens({ model: 'gpt-4o-mini', inputTokens: 1_000_000, cachedTokens: 1_000_000, outputTokens: 0 });
    assert.equal(Number(p.cacheSavedUsd.toFixed(6)), 0.075); // 0.15 - 0.075
});

t('gpt-4o is priced as gpt-4o, not silently as mini', () => {
    const mini = priceTokens({ model: 'gpt-4o-mini', inputTokens: 1_000_000, outputTokens: 1_000_000 });
    const full = priceTokens({ model: 'gpt-4o', inputTokens: 1_000_000, outputTokens: 1_000_000 });
    assert.ok(full.usd > mini.usd * 15, `gpt-4o should be ~16x mini, got ${full.usd / mini.usd}x`);
});

t('an unknown model prices HIGH, never at zero', () => {
    const p = priceTokens({ model: 'gpt-6-turbo-omega', inputTokens: 1_000_000, outputTokens: 0 });
    assert.ok(p.usd > 0, 'unknown model must not price at 0 — that hides spend');
    assert.equal(rateFor('gpt-6-turbo-omega').asOf, 'unknown-model');
});

console.log('\n── usage normalisation ──');

t('OpenAI shape', () => {
    assert.deepEqual(
        normaliseUsage({ prompt_tokens: 900, completion_tokens: 120, prompt_tokens_details: { cached_tokens: 700 } }),
        { inputTokens: 900, cachedTokens: 700, outputTokens: 120 },
    );
});

t('Vertex shape', () => {
    assert.deepEqual(
        normaliseUsage({ promptTokenCount: 900, candidatesTokenCount: 120, totalTokenCount: 1020 }),
        { inputTokens: 900, cachedTokens: 0, outputTokens: 120 },
    );
});

t('missing/garbage usage returns null (so the call is counted as unmeasured)', () => {
    assert.equal(normaliseUsage(null), null);
    assert.equal(normaliseUsage({}), null);
    assert.equal(normaliseUsage('nope'), null);
});

console.log('\n── stage 1: measured vs fallback ──');

const REAL_EXT = { captures: 20000, openaiBatches: 2500, geminiBatches: 0, inputTokens: 22_000_000, outputTokens: 1_250_000, cachedTokens: 4_500_000 };

t('real extension tokens are used verbatim and flagged measured', () => {
    const s = stage1Cost(REAL_EXT, 20000);
    assert.equal(s.measured, true);
    assert.equal(s.inputTokens, 22_000_000);
    assert.equal(s.batches, 2500);
});

t('no reported tokens → fallback estimate, flagged NOT measured', () => {
    const s = stage1Cost({ captures: 20000, openaiBatches: 0, geminiBatches: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0 }, 20000);
    assert.equal(s.measured, false);
    assert.equal(s.batches, 2500);
});

t('the fallback no longer under-reports 2.3x — it is >= the observed invoice rate', () => {
    // Observed on the real account: 301,724,897 tokens / 33,571 requests.
    const OBSERVED_PER_REQUEST = 301_724_897 / 33_571; // ~8,988
    const s = stage1Cost({ inputTokens: 0, outputTokens: 0, cachedTokens: 0 }, 20000);
    const perBatch = (s.inputTokens + s.outputTokens) / s.batches;
    assert.ok(
        perBatch >= OBSERVED_PER_REQUEST,
        `fallback ${perBatch.toFixed(0)} tok/batch must not be below the observed ${OBSERVED_PER_REQUEST.toFixed(0)}`,
    );
    // And the old default really was far too low — this is the regression guard.
    assert.ok(3900 < OBSERVED_PER_REQUEST * 0.5, 'sanity: the old 3900 was <50% of reality');
});

console.log('\n── whole-day report ──');

const USAGE = {
    complete: true,
    callsMissingUsage: 0,
    cacheSavedUsd: 0.01,
    rows: [
        { source: 'second-judge', model: 'gpt-4o-mini', calls: 200, inputTokens: 500_000, cachedTokens: 290_000, outputTokens: 24_000, usd: 0.05, inr: 4.7, cacheSavedUsd: 0.02 },
        { source: 'recruiter-template', model: 'gpt-4o', calls: 40, inputTokens: 200_000, cachedTokens: 0, outputTokens: 40_000, usd: 0.90, inr: 84.6, cacheSavedUsd: 0 },
        { source: 'ai-summary', model: 'gpt-4o-mini', calls: 120, inputTokens: 900_000, cachedTokens: 0, outputTokens: 60_000, usd: 0.17, inr: 16, cacheSavedUsd: 0 },
    ],
};
const SECOND = { completed: 524, fastKept: 324, skipped: 0, llm: 200 };

t('total includes EVERY pipeline, not just judging', async () => {
    const r = await buildCostReport({ scrapedJobs: 20000, ext: REAL_EXT, usage: USAGE, secondStats: SECOND });
    const expected = r.stage1.usd + 0.05 + 0.90 + 0.17;
    assert.equal(Number(r.totalUsd.toFixed(6)), Number(expected.toFixed(6)));
    // The old report would have shown stage1 + second only, hiding $1.07.
    assert.ok(r.totalUsd - (r.stage1.usd + 0.05) > 1.0, 'recruiter+summary spend must be visible');
});

t('gpt-4o recruiter spend is the single biggest line — the thing nobody could see', async () => {
    const r = await buildCostReport({ scrapedJobs: 20000, ext: REAL_EXT, usage: USAGE, secondStats: SECOND });
    assert.equal(r.rows[0].source, 'second-judge'); // rows arrive pre-sorted by caller in prod
    const recruiter = r.rows.find((x) => x.source === 'recruiter-template');
    assert.ok(recruiter.usd > r.rows.find((x) => x.source === 'ai-summary').usd);
});

t('fast-screen saving is priced from a MEASURED run, not a guess', async () => {
    const r = await buildCostReport({ scrapedJobs: 20000, ext: REAL_EXT, usage: USAGE, secondStats: SECOND });
    // 324 skipped jobs × ($0.05 / 200 real runs)
    assert.equal(Number(r.fastScreenSavedUsd.toFixed(6)), Number((324 * (0.05 / 200)).toFixed(6)));
});

t('no measured stage-2 run → saving is 0, not an invented number', async () => {
    const r = await buildCostReport({
        scrapedJobs: 20000, ext: REAL_EXT, secondStats: SECOND,
        usage: { complete: true, callsMissingUsage: 0, cacheSavedUsd: 0, rows: [] },
    });
    assert.equal(r.fastScreenSavedUsd, 0);
});

t('fullyMeasured is false when stage 1 fell back to the estimate', async () => {
    const r = await buildCostReport({
        scrapedJobs: 20000, ext: { inputTokens: 0, outputTokens: 0, cachedTokens: 0 },
        usage: USAGE, secondStats: SECOND,
    });
    assert.equal(r.fullyMeasured, false);
});

t('fullyMeasured is false when any backend call lacked a usage block', async () => {
    const r = await buildCostReport({
        scrapedJobs: 20000, ext: REAL_EXT, secondStats: SECOND,
        usage: { ...USAGE, complete: false, callsMissingUsage: 7 },
    });
    assert.equal(r.fullyMeasured, false);
    assert.equal(r.callsMissingUsage, 7);
});

t('per-job cost uses the ACTUAL scrape count, not the rounded milestone', async () => {
    const r = await buildCostReport({ scrapedJobs: 21734, ext: REAL_EXT, usage: USAGE, secondStats: SECOND });
    assert.equal(Number(r.perJobUsd.toFixed(9)), Number((r.totalUsd / 21734).toFixed(9)));
});

t('zero scraped jobs does not divide by zero', async () => {
    const r = await buildCostReport({
        scrapedJobs: 0, ext: { inputTokens: 0, outputTokens: 0, cachedTokens: 0 },
        usage: { complete: true, callsMissingUsage: 0, cacheSavedUsd: 0, rows: [] }, secondStats: SECOND,
    });
    assert.equal(r.perJobUsd, 0);
    assert.ok(Number.isFinite(r.totalUsd));
});

console.log(`\n${pass} assertions passed\n`);
