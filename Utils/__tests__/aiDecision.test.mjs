// sanitizeAiDecision guards a PUBLIC endpoint (/addjob), so every field it
// accepts is re-derived with its own type and length cap. These tests pin that
// behaviour: a malformed or hostile body must never reach JobModel intact.
//
// The function is defined inside Controllers/AddJob.js, which pulls in mongoose
// models and a dozen utils on import. Lifting the source is cheaper than
// standing all that up, and it still tests the shipping text.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../../Controllers/AddJob.js', import.meta.url), 'utf8');
const start = src.indexOf('function sanitizeAiDecision(raw) {');
const end = src.indexOf('\nexport default async function AddJob', start);
assert.ok(start >= 0 && end > start, 'sanitizeAiDecision no longer found in AddJob.js');
const sanitize = new Function(`${src.slice(start, end)}\nreturn sanitizeAiDecision;`)();

test('keeps a well-formed verdict', () => {
    const out = sanitize({
        reason: 'Pick — "Senior QA Analyst" suits "QA Lead"; test strategy ownership.',
        score: 82, matchedRole: 'QA Lead', jrScore: 94,
        model: 'gpt-4o-mini', judgedAt: '2026-09-17T10:00:00.000Z',
    });
    assert.equal(out.score, 82);
    assert.equal(out.jrScore, 94);
    assert.equal(out.matchedRole, 'QA Lead');
    assert.equal(out.judgedAt.toISOString(), '2026-09-17T10:00:00.000Z');
});

test('returns null when there is nothing to store', () => {
    assert.equal(sanitize(null), null);
    assert.equal(sanitize(undefined), null);
    assert.equal(sanitize('a string'), null);
    assert.equal(sanitize({}), null);
    assert.equal(sanitize({ model: 'gpt-4o-mini' }), null, 'a model alone carries no information');
});

test('rejects scores outside 0-100 rather than storing a lie', () => {
    assert.equal(sanitize({ reason: 'x', score: 900 }).score, null);
    assert.equal(sanitize({ reason: 'x', score: -5 }).score, null);
    assert.equal(sanitize({ reason: 'x', score: 'high' }).score, null);
    assert.equal(sanitize({ reason: 'x', score: NaN }).score, null);
    assert.equal(sanitize({ reason: 'x', score: Infinity }).score, null);
    assert.equal(sanitize({ reason: 'x', score: 0 }).score, 0, '0 is a real score, not a missing one');
    assert.equal(sanitize({ reason: 'x', score: 100 }).score, 100);
    assert.equal(sanitize({ reason: 'x', score: 61.7 }).score, 62, 'rounded, not truncated');
});

test('caps text so a long body cannot bloat the document', () => {
    const out = sanitize({ reason: 'r'.repeat(5000), matchedRole: 'm'.repeat(999), model: 'g'.repeat(999), score: 50 });
    assert.equal(out.reason.length, 500);
    assert.equal(out.matchedRole.length, 120);
    assert.equal(out.model.length, 60);
});

test('drops unknown fields instead of passing them through', () => {
    const out = sanitize({ reason: 'x', score: 50, currentStatus: 'applied', userID: 'someone@else.com', __proto__: { polluted: true } });
    assert.deepEqual(Object.keys(out).sort(), ['jrScore', 'judgedAt', 'matchedRole', 'model', 'reason', 'score']);
    assert.equal(out.currentStatus, undefined);
    assert.equal(out.userID, undefined);
});

test('a bad or missing timestamp falls back to now, never Invalid Date', () => {
    for (const v of [undefined, '', 'not-a-date', {}, NaN]) {
        const out = sanitize({ reason: 'x', judgedAt: v });
        assert.ok(out.judgedAt instanceof Date, `judgedAt should be a Date for ${String(v)}`);
        assert.ok(!Number.isNaN(out.judgedAt.getTime()), `judgedAt should be valid for ${String(v)}`);
    }
});

test('blank strings normalise to null, not empty string', () => {
    const out = sanitize({ reason: '   ', matchedRole: '', score: 50 });
    assert.equal(out.reason, null);
    assert.equal(out.matchedRole, null);
});
