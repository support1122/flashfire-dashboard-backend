// Manual-vs-autopilot split for the Auto Extension page. Pure functions only.
//
// The bug these guard against: the autopilot drives the same extension, so its
// sessions land in ExtensionSessionStat too. Counting every session as "manual"
// would report the autopilot's work twice on the same page.

import assert from 'node:assert/strict';

const {
    buildRunIntervals,
    insideAutopilotRun,
    summariseManualSessions,
    buildManualReport,
} = await import('../../Controllers/ManualExtensionSummary.js');

let pass = 0, failed = 0;
const t = async (name, fn) => {
    try { await fn(); pass++; console.log(`  ok  ${name}`); }
    catch (err) { failed++; console.error(`  FAIL  ${name}\n        ${err.message}`); }
};

const A = 'a@x.com';
const B = 'b@x.com';
const at = (hhmm) => `2026-09-24T${hhmm}:00.000Z`;

// Autopilot ran for A from 10:00 to 10:30.
const RUNS = [{ clientEmail: A, startedAt: at('10:00'), finishedAt: at('10:30'), pushed: 12 }];
const IV = buildRunIntervals(RUNS);

console.log('\n── telling autopilot sessions from manual ones ──');

await t('a session inside the run window is autopilot', () => {
    assert.equal(insideAutopilotRun(IV, A, Date.parse(at('10:15'))), true);
});
await t('the 2-minute edge catches the first and last heartbeats', () => {
    assert.equal(insideAutopilotRun(IV, A, Date.parse(at('09:59'))), true);
    assert.equal(insideAutopilotRun(IV, A, Date.parse(at('10:31'))), true);
});
await t('outside the window is manual', () => {
    assert.equal(insideAutopilotRun(IV, A, Date.parse(at('11:00'))), false);
});
await t('another client at the same minute is manual', () => {
    assert.equal(insideAutopilotRun(IV, B, Date.parse(at('10:15'))), false);
});
await t('email case does not break the match', () => {
    assert.equal(insideAutopilotRun(IV, 'A@X.COM', Date.parse(at('10:15'))), true);
});
await t('an old run with no startedAt is rebuilt from minutes', () => {
    const iv = buildRunIntervals([{ clientEmail: A, finishedAt: at('12:00'), minutes: 20 }]);
    assert.equal(insideAutopilotRun(iv, A, Date.parse(at('11:45'))), true);
    assert.equal(insideAutopilotRun(iv, A, Date.parse(at('11:30'))), false);
});

console.log('\n── captures: no double counting ──');

await t('autopilot session rows are excluded from manual captures', () => {
    const { byClient, autopilotRows } = summariseManualSessions([
        { sessionId: 's1', clientEmail: A, operatorName: 'op', captures: 100, startedAt: at('10:05'), endedAt: at('10:20') },
        { sessionId: 's2', clientEmail: A, operatorName: 'Asha', captures: 40, startedAt: at('11:00'), endedAt: at('11:20') },
    ], IV);
    assert.equal(autopilotRows, 1);
    assert.equal(byClient.get(A).captured, 40);
    assert.deepEqual([...byClient.get(A).operators], ['Asha']);
});

await t('heartbeat rows of one session take the MAX, not the sum', () => {
    const { byClient } = summariseManualSessions([
        { sessionId: 's9', clientEmail: B, operatorName: 'Asha', captures: 20, startedAt: at('11:00'), endedAt: at('11:05') },
        { sessionId: 's9', clientEmail: B, operatorName: 'Asha', captures: 55, startedAt: at('11:00'), endedAt: at('11:10') },
    ], IV);
    assert.equal(byClient.get(B).captured, 55);
    assert.equal(byClient.get(B).sessions, 1);
});

await t('eviction duplicates without a sessionId still fold on operator+client+start', () => {
    const { byClient } = summariseManualSessions([
        { clientEmail: B, operatorName: 'Asha', captures: 60, startedAt: at('11:00'), endedAt: at('11:05') },
        { clientEmail: B, operatorName: 'Asha', captures: 60, startedAt: at('11:00'), endedAt: at('11:06') },
    ], IV);
    assert.equal(byClient.get(B).captured, 60);
});

await t('separate sessions (auto-run batches) are summed', () => {
    const { byClient } = summariseManualSessions([
        { sessionId: 'b1', clientEmail: B, operatorName: 'Asha', captures: 100, startedAt: at('11:00'), endedAt: at('11:10') },
        { sessionId: 'b2', clientEmail: B, operatorName: 'Asha', captures: 100, startedAt: at('11:10'), endedAt: at('11:20') },
        { sessionId: 'b3', clientEmail: B, operatorName: 'Asha', captures: 37, startedAt: at('11:20'), endedAt: at('11:25') },
    ], IV);
    assert.equal(byClient.get(B).captured, 237);
    assert.equal(byClient.get(B).sessions, 3);
});

await t('lastScrapedAt is the latest heartbeat', () => {
    const { byClient } = summariseManualSessions([
        { sessionId: 's1', clientEmail: B, captures: 5, startedAt: at('11:00'), endedAt: at('11:05') },
        { sessionId: 's1', clientEmail: B, captures: 6, startedAt: at('11:00'), endedAt: at('11:40') },
        { sessionId: 's1', clientEmail: B, captures: 6, startedAt: at('11:00'), endedAt: at('11:20') },
    ], IV);
    assert.equal(byClient.get(B).lastAt, Date.parse(at('11:40')));
});

console.log('\n── pushes: ground truth minus the autopilot ──');

const byClient = summariseManualSessions([
    { sessionId: 'm1', clientEmail: A, operatorName: 'Asha', captures: 40, startedAt: at('11:00'), endedAt: at('11:20') },
], IV).byClient;

await t('manual pushed = extension pushes minus what the autopilot rows counted', () => {
    const { data } = buildManualReport({
        byClient,
        extensionPushes: new Map([[A, 20]]),
        autopilotPushes: new Map([[A, 12]]),
    });
    assert.equal(data[0].pushed, 8);
    assert.equal(data[0].rejected, 32);
});

await t('autopilot + manual add up to all extension pushes', () => {
    const { data } = buildManualReport({
        byClient,
        extensionPushes: new Map([[A, 20]]),
        autopilotPushes: new Map([[A, 12]]),
    });
    assert.equal(data[0].pushed + 12, 20);
});

await t('pushed never goes negative', () => {
    const { data } = buildManualReport({
        byClient,
        extensionPushes: new Map([[A, 5]]),
        autopilotPushes: new Map([[A, 12]]),
    });
    assert.equal(data[0].pushed, 0);
    assert.equal(data[0].rejected, 40);
});

await t('a client whose pushes are all autopilot does not appear as manual', () => {
    const { data } = buildManualReport({
        byClient: new Map(),
        extensionPushes: new Map([[A, 12]]),
        autopilotPushes: new Map([[A, 12]]),
    });
    assert.equal(data.length, 0);
});

await t('manual pushes with no session row still show (older builds)', () => {
    const { data } = buildManualReport({
        byClient: new Map(),
        extensionPushes: new Map([[B, 7]]),
        autopilotPushes: new Map(),
    });
    assert.equal(data.length, 1);
    assert.equal(data[0].pushed, 7);
    assert.equal(data[0].captured, 0);
});

await t('totals add up across clients and count distinct operators', () => {
    const bc = summariseManualSessions([
        { sessionId: 'x1', clientEmail: A, operatorName: 'Asha', captures: 40, startedAt: at('11:00'), endedAt: at('11:20') },
        { sessionId: 'x2', clientEmail: B, operatorName: 'Asha', captures: 30, startedAt: at('12:00'), endedAt: at('12:20') },
        { sessionId: 'x3', clientEmail: B, operatorName: 'Ravi', captures: 10, startedAt: at('13:00'), endedAt: at('13:20') },
    ], IV).byClient;
    const { totals } = buildManualReport({
        byClient: bc,
        extensionPushes: new Map([[A, 22], [B, 6]]),
        autopilotPushes: new Map([[A, 12]]),
    });
    assert.equal(totals.clients, 2);
    assert.equal(totals.operators, 2);
    assert.equal(totals.sessions, 3);
    assert.equal(totals.captured, 80);
    assert.equal(totals.pushed, 16);
    assert.equal(totals.rejected, 64);
});

if (failed) {
    console.error(`\n${failed} FAILED, ${pass} passed\n`);
    process.exit(1);
}
console.log(`\n${pass} assertions passed\n`);
