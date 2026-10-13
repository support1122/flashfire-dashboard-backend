// Renamed section headings must survive the copy from base resume to job.
// The bug this guards: the admin editor showed "ADDITIONAL INFORMATION" while
// the client's job card and its PDF said "LEADERSHIP & VOLUNTEERING", because
// the titles were dropped on the way into the job record.

import assert from 'node:assert/strict';
import test from 'node:test';

import { sanitizeSectionTitles, sectionTitlesFrom } from '../sectionTitles.js';

test('the real case passes through unchanged', () => {
     assert.deepEqual(
          sanitizeSectionTitles({ leadership: 'ADDITIONAL INFORMATION' }),
          { leadership: 'ADDITIONAL INFORMATION' },
     );
});

test('titles are trimmed, and blank ones fall back to the default', () => {
     assert.deepEqual(
          sanitizeSectionTitles({ leadership: '  Awards  ', projects: '   ', summary: '' }),
          { leadership: 'Awards' },
     );
});

test('anything that is not a plain map of strings becomes empty, never a throw', () => {
     for (const junk of [null, undefined, 'x', 42, ['leadership'], true]) {
          assert.deepEqual(sanitizeSectionTitles(junk), {});
     }
     assert.deepEqual(sanitizeSectionTitles({ leadership: 5, projects: { $gt: '' } }), {});
});

test('operator-looking and odd keys are dropped', () => {
     assert.deepEqual(
          sanitizeSectionTitles({ $set: 'x', 'a.b': 'x', '1abc': 'x', ok_key: 'Kept' }),
          { ok_key: 'Kept' },
     );
});

test('long titles are capped, and the map is bounded', () => {
     const long = 'A'.repeat(500);
     assert.equal(sanitizeSectionTitles({ leadership: long }).leadership.length, 120);

     const many = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`s${i}`, 'T']));
     assert.equal(Object.keys(sanitizeSectionTitles(many)).length, 20);
});

test('sectionTitlesFrom prefers the explicit map, then the copy inside resumeData', () => {
     assert.deepEqual(
          sectionTitlesFrom({ sectionTitles: { leadership: 'A' }, resumeData: { sectionTitles: { leadership: 'B' } } }),
          { leadership: 'A' },
     );
     assert.deepEqual(
          sectionTitlesFrom({ resumeData: { sectionTitles: { leadership: 'B' } } }),
          { leadership: 'B' },
     );
     assert.deepEqual(sectionTitlesFrom({ sectionTitles: {}, resumeData: {} }), {});
     assert.deepEqual(sectionTitlesFrom(undefined), {});
});
