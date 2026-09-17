// Covers the /operations/job-ai-decision controller.
//
// The real JobModel is swapped out with mock.module so the test exercises the
// shipping controller - its id-form branching, its projection and its response
// shape - without a database.
//
// mock.module needs --experimental-test-module-mocks, which the repo's `npm
// test` script now passes. Running this file with a bare `node --test` will
// fail on the mock.module call, not on the controller.

import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

let lastQuery = null;
let lastSelect = '';
let nextDoc = null;

mock.module('../../Schema_Models/JobModel.js', {
    namedExports: {
        JobModel: {
            findOne(query) {
                lastQuery = query;
                return {
                    select(fields) { lastSelect = fields; return this; },
                    lean() { return Promise.resolve(nextDoc); },
                };
            },
        },
    },
});

const { default: GetJobAiDecision } = await import('../../Controllers/GetJobAiDecision.js');

function res() {
    const r = { code: 0, body: null };
    r.status = (c) => { r.code = c; return r; };
    r.json = (b) => { r.body = b; return r; };
    return r;
}

test('a 24-char hex id is looked up as _id', async () => {
    nextDoc = { jobTitle: 'Senior QA Analyst', companyName: 'Acme', aiDecision: { reason: 'r', score: 80 } };
    const r = res();
    await GetJobAiDecision({ body: { jobId: '689602d987b7d2042d9eaa21' } }, r);
    assert.deepEqual(lastQuery, { _id: '689602d987b7d2042d9eaa21' });
    assert.equal(r.code, 200);
    assert.equal(r.body.aiDecision.score, 80);
    assert.equal(r.body.jobTitle, 'Senior QA Analyst');
});

test("anything else is looked up as the extension's jobID string", async () => {
    nextDoc = { jobTitle: 'x', companyName: 'y', aiDecision: null };
    await GetJobAiDecision({ body: { jobId: '1754661591588' } }, res());
    assert.deepEqual(lastQuery, { jobID: '1754661591588' });
});

test('only the four needed fields are selected, never the whole document', async () => {
    nextDoc = { aiDecision: null };
    await GetJobAiDecision({ body: { jobId: 'abc' } }, res());
    assert.equal(lastSelect, 'aiDecision jobTitle companyName createdByRole');
    assert.ok(!/jobDescription/.test(lastSelect), 'must not pull the job description');
});

test('a job with no recorded verdict answers 200 with null, not 404', async () => {
    nextDoc = { jobTitle: 'Old Job', companyName: 'Acme', aiDecision: null };
    const r = res();
    await GetJobAiDecision({ body: { jobId: 'abc' } }, r);
    assert.equal(r.code, 200);
    assert.equal(r.body.success, true);
    assert.equal(r.body.aiDecision, null);
});

test('a missing job is 404', async () => {
    nextDoc = null;
    const r = res();
    await GetJobAiDecision({ body: { jobId: 'abc' } }, r);
    assert.equal(r.code, 404);
    assert.equal(r.body.success, false);
});

test('a missing jobId is rejected before any query', async () => {
    for (const body of [{}, { jobId: '' }, { jobId: '   ' }]) {
        const r = res();
        await GetJobAiDecision({ body }, r);
        assert.equal(r.code, 400, `should reject ${JSON.stringify(body)}`);
    }
});

test('accepts `id` as well as `jobId`', async () => {
    nextDoc = { aiDecision: null };
    const r = res();
    await GetJobAiDecision({ body: { id: '689602d987b7d2042d9eaa21' } }, r);
    assert.equal(r.code, 200);
});
