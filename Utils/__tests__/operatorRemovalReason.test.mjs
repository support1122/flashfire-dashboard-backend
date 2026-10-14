// An operator moving a card to Removed must give a written reason, and that
// reason must never reach the client.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
     OPERATOR_REASON_MIN_LENGTH,
     validateOperatorRemovalReason,
} from '../operatorRemovalReason.js';
import { JobModel } from '../../Schema_Models/JobModel.js';

test('a real reason passes, whitespace collapsed', () => {
     const r = validateOperatorRemovalReason('  Job posting closed,\n link   is dead  ');
     assert.deepEqual(r, { ok: true, reason: 'Job posting closed, link is dead' });
});

test('a missing or blank reason is refused', () => {
     for (const raw of [undefined, null, '', '   ', '\n\t', 42, {}, ['Job closed']]) {
          const r = validateOperatorRemovalReason(raw);
          assert.equal(r.ok, false, `should refuse ${JSON.stringify(raw)}`);
          assert.match(r.message, /required/);
     }
});

test('a token reason is refused: "x" and "ok" are not reasons', () => {
     for (const raw of ['x', 'ok', 'removed', 'a'.repeat(OPERATOR_REASON_MIN_LENGTH - 1)]) {
          const r = validateOperatorRemovalReason(raw);
          assert.equal(r.ok, false, `should refuse "${raw}"`);
          assert.match(r.message, new RegExp(`at least ${OPERATOR_REASON_MIN_LENGTH}`));
     }
     assert.equal(validateOperatorRemovalReason('a'.repeat(OPERATOR_REASON_MIN_LENGTH)).ok, true);
});

test('a very long reason is capped, not refused', () => {
     const r = validateOperatorRemovalReason('Duplicate '.repeat(500));
     assert.equal(r.ok, true);
     assert.equal(r.reason.length, 1000);
});

test('operatorRemoval is hidden from every query by default', () => {
     // This one setting is what keeps the note out of /getalljobs,
     // /get-removal-reason and every other client response. If someone
     // removes it, this fails before a client ever sees an internal note.
     const path = JobModel.schema.path('operatorRemoval');
     assert.ok(path, 'JobModel must define operatorRemoval');
     assert.equal(path.options.select, false);
});

test('the client reason and the operator reason are separate fields', () => {
     assert.ok(JobModel.schema.path('removalReason'));
     assert.notEqual(JobModel.schema.path('removalReason'), JobModel.schema.path('operatorRemoval'));
});
