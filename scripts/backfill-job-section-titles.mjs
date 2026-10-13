/**
 * Copy each client's renamed section headings onto the job resumes that lost
 * them.
 *
 *   node scripts/backfill-job-section-titles.mjs                         # dry run, every client
 *   node scripts/backfill-job-section-titles.mjs --email a@b.com         # dry run, one client
 *   node scripts/backfill-job-section-titles.mjs --email a@b.com --apply # write for one client
 *   node scripts/backfill-job-section-titles.mjs --apply                 # write for everyone
 *
 * Until this fix, saving a resume onto a job dropped `sectionTitles`, so a
 * client whose base resume renames the leadership section to "ADDITIONAL
 * INFORMATION" saw "LEADERSHIP & VOLUNTEERING" on every job card and in every
 * PDF downloaded from one. New saves keep the titles; this repairs the old ones.
 * The logic lives in Utils/backfillSectionTitles.js, shared with the temporary
 * GET /maintenance/backfill-section-titles route.
 *
 * Reads MONGODB_URI and RESUME_API_URL from the environment. Deploy the resume
 * service first: it now names `sectionTitles` in /api/resume-by-email.
 */

import mongoose from 'mongoose';
import { backfillSectionTitles, resumeServiceTitleReader } from '../Utils/backfillSectionTitles.js';

const APPLY = process.argv.includes('--apply');
const emailArg = (() => {
  const i = process.argv.indexOf('--email');
  return i > -1 ? String(process.argv[i + 1] || '').trim().toLowerCase() : '';
})();

const uri = process.env.MONGODB_URI;
const resumeApi = process.env.RESUME_API_URL;
if (!uri || !resumeApi) {
  console.error('MONGODB_URI and RESUME_API_URL must both be set. Try:\n  export $(grep -E "^(MONGODB_URI|RESUME_API_URL)=" .env | xargs)');
  process.exit(1);
}
if (process.argv.includes('--email') && !emailArg.includes('@')) {
  console.error('--email needs an address, e.g. --email client@example.com');
  process.exit(1);
}

await mongoose.connect(uri, { serverSelectionTimeoutMS: 20000 });
console.log(APPLY ? '── APPLYING ──\n' : '── DRY RUN (nothing will be written) ──\n');

const summary = await backfillSectionTitles({
  jobs: mongoose.connection.db.collection('jobdbs'),
  readTitles: resumeServiceTitleReader(resumeApi),
  apply: APPLY,
  email: emailArg,
  log: (line) => console.log(line),
});

console.log(
  `\n${summary.clientsScanned} client(s) scanned; ${summary.clientsWithTitles} have renamed sections; ` +
  `${summary.jobsUpdated} job(s) ${APPLY ? 'updated' : 'would be updated'}; ` +
  `${summary.lookupFailures} lookup failure(s).`,
);
if (!APPLY) console.log('Re-run with --apply to write.');

await mongoose.disconnect();
