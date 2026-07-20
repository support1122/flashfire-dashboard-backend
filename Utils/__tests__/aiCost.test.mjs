// Cost-reporting tests. Pure functions only — no Mongo, no network.
//
// The bug these lock down: the milestone embed priced a day from hardcoded
// per-batch averages that measured ~2.3x below the real invoice, and called the
// result "TOTAL cost" while excluding every non-judge pipeline.

import assert from 'node:assert/strict';

// Set every RETIRED env var to a value that would visibly change the output if
// it were still read — BEFORE importing the modules, so a re-introduced
// process.env read would be caught at module-init time. Cost math is code, not
// deployment config; this is the guard that keeps it that way.
process.env.USD_INR_FIXED = '9999';
process.env.AI_BATCH_SIZE = '1';
process.env.AI_TOKENS_IN_PER_BATCH = '1';
process.env.AI_TOKENS_OUT_PER_BATCH = '1';
process.env.AI_CACHED_TOKENS_PER_BATCH = '1';
process.env.OPENAI_INPUT_PER_M = '99';
process.env.OPENAI_OUTPUT_PER_M = '99';
process.env.OPENAI_MODEL = 'gpt-4o';       // the 16x stage-1 mis-pricing trap
process.env.OPENAI_JUDGE_MODEL = 'gpt-4o';

const { priceTokens, rateFor, FX_USD_INR, inr } = await import('../aiRateCard.js');
const { normaliseUsage } = await import('../aiUsage.js');
const { stage1Cost, buildCostReport, mergeSessionRows } = await import('../scrapeCostNotifier.js');

// Await every case: several are async, and an un-awaited rejection would be
// reported as an unhandled rejection rather than a named failing assertion.
let pass = 0, failed = 0;
const t = async (name, fn) => {
    try { await fn(); pass++; console.log(`  ok  ${name}`); }
    catch (err) { failed++; console.error(`  FAIL  ${name}\n        ${err.message}`); }
};


console.log('\n── nothing is reachable from the environment ──');

await t('FX stays 94 despite USD_INR_FIXED=9999', () => {
    assert.equal(FX_USD_INR, 94);
    assert.equal(inr(1), 94);
});

await t('rate card ignores OPENAI_INPUT_PER_M / OPENAI_OUTPUT_PER_M', () => {
    assert.equal(rateFor('gpt-4o-mini').in, 0.15);
    assert.equal(rateFor('gpt-4o-mini').out, 0.60);
});

await t('fallback batch size stays 8 despite AI_BATCH_SIZE=1', () => {
    assert.equal(stage1Cost({ inputTokens: 0, outputTokens: 0, cachedTokens: 0 }, 20000).batches, 2500);
});

await t('fallback token estimates stay 8800/500 despite env=1', () => {
    const s = stage1Cost({ inputTokens: 0, outputTokens: 0, cachedTokens: 0 }, 20000);
    assert.equal(s.inputTokens, 2500 * 8800);
    assert.equal(s.outputTokens, 2500 * 500);
});

await t('stage 1 prices as gpt-4o-mini even with OPENAI_MODEL=gpt-4o (the 16x trap)', () => {
    const s = stage1Cost({ inputTokens: 1_000_000, cachedTokens: 0, outputTokens: 0, openaiBatches: 10 }, 100);
    assert.equal(Number(s.usd.toFixed(6)), 0.15); // mini; gpt-4o would be 2.50
});

console.log('\n── rate card ──');

await t('cached tokens are a SUBSET of input, never added on top', () => {
    // 1M input of which 1M is cached → must cost the cached rate, not in+cached.
    const p = priceTokens({ model: 'gpt-4o-mini', inputTokens: 1_000_000, cachedTokens: 1_000_000, outputTokens: 0 });
    assert.equal(Number(p.usd.toFixed(6)), 0.075);
});

await t('cached cannot exceed input (clamped)', () => {
    const p = priceTokens({ model: 'gpt-4o-mini', inputTokens: 100, cachedTokens: 999999, outputTokens: 0 });
    assert.equal(p.cachedTokens, 100);
});

await t('cache saving = full rate minus cached rate', () => {
    const p = priceTokens({ model: 'gpt-4o-mini', inputTokens: 1_000_000, cachedTokens: 1_000_000, outputTokens: 0 });
    assert.equal(Number(p.cacheSavedUsd.toFixed(6)), 0.075); // 0.15 - 0.075
});

await t('gpt-4o is priced as gpt-4o, not silently as mini', () => {
    const mini = priceTokens({ model: 'gpt-4o-mini', inputTokens: 1_000_000, outputTokens: 1_000_000 });
    const full = priceTokens({ model: 'gpt-4o', inputTokens: 1_000_000, outputTokens: 1_000_000 });
    assert.ok(full.usd > mini.usd * 15, `gpt-4o should be ~16x mini, got ${full.usd / mini.usd}x`);
});

await t('an unknown model prices HIGH, never at zero', () => {
    const p = priceTokens({ model: 'gpt-6-turbo-omega', inputTokens: 1_000_000, outputTokens: 0 });
    assert.ok(p.usd > 0, 'unknown model must not price at 0 — that hides spend');
    assert.equal(rateFor('gpt-6-turbo-omega').asOf, 'unknown-model');
});

console.log('\n── usage normalisation ──');

await t('OpenAI shape', () => {
    assert.deepEqual(
        normaliseUsage({ prompt_tokens: 900, completion_tokens: 120, prompt_tokens_details: { cached_tokens: 700 } }),
        { inputTokens: 900, cachedTokens: 700, outputTokens: 120 },
    );
});

await t('Vertex shape', () => {
    assert.deepEqual(
        normaliseUsage({ promptTokenCount: 900, candidatesTokenCount: 120, totalTokenCount: 1020 }),
        { inputTokens: 900, cachedTokens: 0, outputTokens: 120 },
    );
});

await t('missing/garbage usage returns null (so the call is counted as unmeasured)', () => {
    assert.equal(normaliseUsage(null), null);
    assert.equal(normaliseUsage({}), null);
    assert.equal(normaliseUsage('nope'), null);
});

console.log('\n── stage 1: measured vs fallback ──');

const REAL_EXT = { captures: 20000, openaiBatches: 2500, geminiBatches: 0, inputTokens: 22_000_000, outputTokens: 1_250_000, cachedTokens: 4_500_000 };

await t('real extension tokens are used verbatim and flagged measured', () => {
    const s = stage1Cost(REAL_EXT, 20000);
    assert.equal(s.measured, true);
    assert.equal(s.inputTokens, 22_000_000);
    assert.equal(s.batches, 2500);
});

await t('no reported tokens → fallback estimate, flagged NOT measured', () => {
    const s = stage1Cost({ captures: 20000, openaiBatches: 0, geminiBatches: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0 }, 20000);
    assert.equal(s.measured, false);
    assert.equal(s.batches, 2500);
});

await t('the fallback no longer under-reports 2.3x — it is >= the observed invoice rate', () => {
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

console.log('\n── service-worker eviction duplicates ──');

// The exact shipped-extension failure: SW evicted mid-session. restoreState()
// brings back capture.jobs (full cumulative captures) but NOT sessionId, so the
// backend inserts a SECOND row for the same session with the same capture total.
// auto.stats is not restored either, so its tokens restart from zero.
const SESSION_START = '2026-07-20T04:00:00.000Z';
const EVICTED = [
    { _id: 'a', operatorName: 'op1', clientEmail: 'c@x.com', startedAt: SESSION_START,
      captures: 6000, modelStats: { openaiBatches: 750, inputTokens: 6_600_000, outputTokens: 375_000, cachedTokens: 1_350_000 } },
    { _id: 'b', operatorName: 'op1', clientEmail: 'c@x.com', startedAt: SESSION_START,
      captures: 10000, modelStats: { openaiBatches: 500, inputTokens: 4_400_000, outputTokens: 250_000, cachedTokens: 900_000 } },
];

await t('captures are NOT double-counted across an eviction', () => {
    const m = mergeSessionRows(EVICTED);
    assert.equal(m.captures, 10000);              // max, not 6000+10000
    assert.equal(m.sessions, 1);
    assert.equal(m.duplicateRows, 1);
});

await t('the old naive sum really did inflate — this is the bug being fixed', () => {
    const naive = EVICTED.reduce((a, r) => a + r.captures, 0);
    assert.equal(naive, 16000);
    assert.equal(mergeSessionRows(EVICTED).captures, 10000);
    assert.ok(naive > mergeSessionRows(EVICTED).captures, 'naive sum over-reports by 60% here');
});

await t('tokens ARE summed across an eviction (they restart from zero, so disjoint)', () => {
    const m = mergeSessionRows(EVICTED);
    assert.equal(m.inputTokens, 11_000_000);
    assert.equal(m.outputTokens, 625_000);
    assert.equal(m.openaiBatches, 1250);
});

await t('genuinely separate sessions still add up', () => {
    const m = mergeSessionRows([
        { _id: 'a', operatorName: 'op1', clientEmail: 'c@x.com', startedAt: '2026-07-20T04:00:00.000Z', captures: 5000, modelStats: { inputTokens: 100 } },
        { _id: 'b', operatorName: 'op1', clientEmail: 'c@x.com', startedAt: '2026-07-20T09:00:00.000Z', captures: 4000, modelStats: { inputTokens: 200 } },
    ]);
    assert.equal(m.captures, 9000);
    assert.equal(m.sessions, 2);
    assert.equal(m.duplicateRows, 0);
});

await t('different operators on the same client never merge', () => {
    const m = mergeSessionRows([
        { _id: 'a', operatorName: 'op1', clientEmail: 'c@x.com', startedAt: SESSION_START, captures: 5000, modelStats: {} },
        { _id: 'b', operatorName: 'op2', clientEmail: 'c@x.com', startedAt: SESSION_START, captures: 4000, modelStats: {} },
    ]);
    assert.equal(m.captures, 9000);
    assert.equal(m.sessions, 2);
});

await t('same operator, two different clients, never merge', () => {
    const m = mergeSessionRows([
        { _id: 'a', operatorName: 'op1', clientEmail: 'c1@x.com', startedAt: SESSION_START, captures: 5000, modelStats: {} },
        { _id: 'b', operatorName: 'op1', clientEmail: 'c2@x.com', startedAt: SESSION_START, captures: 4000, modelStats: {} },
    ]);
    assert.equal(m.captures, 9000);
});

await t('legacy rows with no startedAt stay distinct instead of collapsing', () => {
    const m = mergeSessionRows([
        { _id: 'a', operatorName: 'op1', clientEmail: 'c@x.com', startedAt: null, captures: 5000, modelStats: {} },
        { _id: 'b', operatorName: 'op1', clientEmail: 'c@x.com', startedAt: null, captures: 4000, modelStats: {} },
    ]);
    assert.equal(m.captures, 9000, 'null startedAt must not merge unrelated rows');
    assert.equal(m.sessions, 2);
});

await t('equivalent startedAt in a different string form still merges', () => {
    const m = mergeSessionRows([
        { _id: 'a', operatorName: 'op1', clientEmail: 'c@x.com', startedAt: '2026-07-20T04:00:00.000Z', captures: 6000, modelStats: {} },
        { _id: 'b', operatorName: 'op1', clientEmail: 'c@x.com', startedAt: new Date('2026-07-20T04:00:00.000Z'), captures: 9000, modelStats: {} },
    ]);
    assert.equal(m.sessions, 1);
    assert.equal(m.captures, 9000);
});

await t('empty / missing modelStats does not throw or poison totals', () => {
    const m = mergeSessionRows([
        { _id: 'a', operatorName: 'op1', clientEmail: 'c@x.com', startedAt: SESSION_START, captures: 10 },
        { _id: 'b', operatorName: 'op1', clientEmail: 'c@x.com', startedAt: SESSION_START, captures: 20, modelStats: {} },
    ]);
    assert.equal(m.captures, 20);
    assert.equal(m.inputTokens, 0);
});

await t('no rows at all → all zeros, no crash', () => {
    const m = mergeSessionRows([]);
    assert.equal(m.captures, 0);
    assert.equal(m.sessions, 0);
    assert.equal(mergeSessionRows(null).captures, 0);
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

await t('total includes EVERY pipeline, not just judging', async () => {
    const r = await buildCostReport({ scrapedJobs: 20000, ext: REAL_EXT, usage: USAGE, secondStats: SECOND });
    const expected = r.stage1.usd + 0.05 + 0.90 + 0.17;
    assert.equal(Number(r.totalUsd.toFixed(6)), Number(expected.toFixed(6)));
    // The old report would have shown stage1 + second only, hiding $1.07.
    assert.ok(r.totalUsd - (r.stage1.usd + 0.05) > 1.0, 'recruiter+summary spend must be visible');
});

await t('gpt-4o recruiter spend is the single biggest line — the thing nobody could see', async () => {
    const r = await buildCostReport({ scrapedJobs: 20000, ext: REAL_EXT, usage: USAGE, secondStats: SECOND });
    assert.equal(r.rows[0].source, 'second-judge'); // rows arrive pre-sorted by caller in prod
    const recruiter = r.rows.find((x) => x.source === 'recruiter-template');
    assert.ok(recruiter.usd > r.rows.find((x) => x.source === 'ai-summary').usd);
});

await t('fast-screen saving is priced from a MEASURED run, not a guess', async () => {
    const r = await buildCostReport({ scrapedJobs: 20000, ext: REAL_EXT, usage: USAGE, secondStats: SECOND });
    // 324 skipped jobs × ($0.05 / 200 real runs)
    assert.equal(Number(r.fastScreenSavedUsd.toFixed(6)), Number((324 * (0.05 / 200)).toFixed(6)));
});

await t('no measured stage-2 run → saving is 0, not an invented number', async () => {
    const r = await buildCostReport({
        scrapedJobs: 20000, ext: REAL_EXT, secondStats: SECOND,
        usage: { complete: true, callsMissingUsage: 0, cacheSavedUsd: 0, rows: [] },
    });
    assert.equal(r.fastScreenSavedUsd, 0);
});

await t('fullyMeasured is false when stage 1 fell back to the estimate', async () => {
    const r = await buildCostReport({
        scrapedJobs: 20000, ext: { inputTokens: 0, outputTokens: 0, cachedTokens: 0 },
        usage: USAGE, secondStats: SECOND,
    });
    assert.equal(r.fullyMeasured, false);
});

await t('fullyMeasured is false when any backend call lacked a usage block', async () => {
    const r = await buildCostReport({
        scrapedJobs: 20000, ext: REAL_EXT, secondStats: SECOND,
        usage: { ...USAGE, complete: false, callsMissingUsage: 7 },
    });
    assert.equal(r.fullyMeasured, false);
    assert.equal(r.callsMissingUsage, 7);
});

await t('per-job cost uses the ACTUAL scrape count, not the rounded milestone', async () => {
    const r = await buildCostReport({ scrapedJobs: 21734, ext: REAL_EXT, usage: USAGE, secondStats: SECOND });
    assert.equal(Number(r.perJobUsd.toFixed(9)), Number((r.totalUsd / 21734).toFixed(9)));
});

await t('zero scraped jobs does not divide by zero', async () => {
    const r = await buildCostReport({
        scrapedJobs: 0, ext: { inputTokens: 0, outputTokens: 0, cachedTokens: 0 },
        usage: { complete: true, callsMissingUsage: 0, cacheSavedUsd: 0, rows: [] }, secondStats: SECOND,
    });
    assert.equal(r.perJobUsd, 0);
    assert.ok(Number.isFinite(r.totalUsd));
});

if (failed) {
    console.error(`\n${failed} FAILED, ${pass} passed\n`);
    process.exit(1);
}
console.log(`\n${pass} assertions passed\n`);
