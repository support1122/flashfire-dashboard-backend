// The section-titles backfill runs from an unauthenticated GET, so the things
// that matter are: a dry run writes nothing, it never overwrites titles a job
// already has, and a second call finds nothing to do.

import assert from 'node:assert/strict';
import test from 'node:test';

import { backfillSectionTitles } from '../backfillSectionTitles.js';

// Just enough of a Mongo collection for this module, with the NEEDS_TITLES
// filter evaluated by hand.
function fakeJobs(rows) {
     const needs = (j) => {
          const t = j.optimizedResume?.sectionTitles;
          return j.optimizedResume?.hasResume === true
               && (t === undefined || t === null || (typeof t === 'object' && Object.keys(t).length === 0));
     };
     const matches = (j, filter) => needs(j) && (!filter.userID || j.userID === filter.userID);
     return {
          rows,
          writes: 0,
          async distinct(field, filter) {
               return [...new Set(rows.filter((j) => matches(j, filter)).map((j) => j[field]))];
          },
          async countDocuments(filter) {
               return rows.filter((j) => matches(j, filter)).length;
          },
          async updateMany(filter, update) {
               let modifiedCount = 0;
               for (const j of rows) {
                    if (!matches(j, filter)) continue;
                    j.optimizedResume.sectionTitles = update.$set['optimizedResume.sectionTitles'];
                    modifiedCount += 1;
               }
               this.writes += 1;
               return { modifiedCount };
          },
     };
}

const job = (userID, sectionTitles) => ({
     userID,
     optimizedResume: { hasResume: true, ...(sectionTitles === undefined ? {} : { sectionTitles }) },
});

const BASE = {
     'abhinav@example.com': { leadership: 'ADDITIONAL INFORMATION' },
     'plain@example.com': {},
};
const readTitles = async (email) => {
     if (email === 'broken@example.com') throw new Error('resume service answered 500');
     return BASE[email] || {};
};

test('a dry run reports the work and writes nothing', async () => {
     const jobs = fakeJobs([job('abhinav@example.com'), job('abhinav@example.com', {}), job('plain@example.com')]);
     const s = await backfillSectionTitles({ jobs, readTitles, apply: false });
     assert.equal(s.jobsUpdated, 2);
     assert.equal(s.clientsWithTitles, 1);
     assert.equal(jobs.writes, 0);
     assert.equal(jobs.rows[0].optimizedResume.sectionTitles, undefined);
});

test('apply fills the missing titles, and a second run does nothing', async () => {
     const jobs = fakeJobs([job('abhinav@example.com'), job('abhinav@example.com', null)]);
     const first = await backfillSectionTitles({ jobs, readTitles, apply: true });
     assert.equal(first.jobsUpdated, 2);
     for (const r of jobs.rows) assert.deepEqual(r.optimizedResume.sectionTitles, { leadership: 'ADDITIONAL INFORMATION' });

     const second = await backfillSectionTitles({ jobs, readTitles, apply: true });
     assert.equal(second.clientsScanned, 0);
     assert.equal(second.jobsUpdated, 0);
});

test('titles a job already has are never overwritten', async () => {
     const jobs = fakeJobs([job('abhinav@example.com', { leadership: 'KEEP ME' })]);
     const s = await backfillSectionTitles({ jobs, readTitles, apply: true });
     assert.equal(s.jobsUpdated, 0);
     assert.deepEqual(jobs.rows[0].optimizedResume.sectionTitles, { leadership: 'KEEP ME' });
});

test('the email filter limits it to one client', async () => {
     const jobs = fakeJobs([job('abhinav@example.com'), job('other@example.com')]);
     BASE['other@example.com'] = { leadership: 'RESEARCH' };
     const s = await backfillSectionTitles({ jobs, readTitles, apply: true, email: ' Abhinav@Example.com ' });
     assert.equal(s.jobsUpdated, 1);
     assert.equal(jobs.rows[1].optimizedResume.sectionTitles, undefined);
});

test('one client whose lookup fails is skipped, the rest still run', async () => {
     const jobs = fakeJobs([job('broken@example.com'), job('abhinav@example.com')]);
     const s = await backfillSectionTitles({ jobs, readTitles, apply: true });
     assert.equal(s.lookupFailures, 1);
     assert.equal(s.jobsUpdated, 1);
     assert.equal(jobs.rows[0].optimizedResume.sectionTitles, undefined);
});
