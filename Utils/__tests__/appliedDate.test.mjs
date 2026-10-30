import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldSetAppliedDate, isBlankAppliedDate } from '../appliedDate.js';

test('saved -> applied stamps, with or without attribution', () => {
  assert.equal(shouldSetAppliedDate('saved', 'applied by Ops'), true);
  assert.equal(shouldSetAppliedDate('saved by Sathya', 'applied by Sathya'), true);
  assert.equal(shouldSetAppliedDate('Saved', 'Applied'), true);
});

test('restored or odd source statuses still stamp', () => {
  assert.equal(shouldSetAppliedDate('deleted by Ops', 'applied by Ops'), true);
  assert.equal(shouldSetAppliedDate('removed', 'applied'), true);
  assert.equal(shouldSetAppliedDate('', 'applied'), true);
  assert.equal(shouldSetAppliedDate(undefined, 'applied by user'), true);
  assert.equal(shouldSetAppliedDate('interviewing by Ops', 'applied by Ops'), true);
});

test('applied -> applied never re-stamps', () => {
  assert.equal(shouldSetAppliedDate('applied by Ops', 'applied by Sathya'), false);
  assert.equal(shouldSetAppliedDate('applied', 'applied'), false);
});

test('non-applied targets never stamp', () => {
  assert.equal(shouldSetAppliedDate('saved', 'saved by Ops'), false);
  assert.equal(shouldSetAppliedDate('saved', 'deleted by Ops'), false);
  assert.equal(shouldSetAppliedDate('saved', ''), false);
  assert.equal(shouldSetAppliedDate('saved', null), false);
});

test('blank appliedDate: null, empty and lone space count as unset', () => {
  for (const v of [null, undefined, '', ' ', '  ']) assert.equal(isBlankAppliedDate(v), true);
  assert.equal(isBlankAppliedDate('26/10/2026, 3:45:12 pm'), false);
});
