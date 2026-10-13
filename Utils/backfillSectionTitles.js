import { sanitizeSectionTitles } from "./sectionTitles.js";

/**
 * Copy each client's renamed section headings onto the job resumes that lost
 * them. Shared by scripts/backfill-job-section-titles.mjs and the temporary
 * GET /maintenance/backfill-section-titles route, so both do exactly the same
 * thing.
 *
 * Writes only `optimizedResume.sectionTitles`, only on jobs that have an
 * optimized resume and no titles yet, and only for clients whose base resume
 * renames a section. A job that already has titles is never overwritten, so
 * running this twice is harmless: the second run finds nothing to do.
 */

// A job needs repair when it has an optimized resume and no titles at all.
export const NEEDS_TITLES = {
     "optimizedResume.hasResume": true,
     $or: [
          { "optimizedResume.sectionTitles": { $exists: false } },
          { "optimizedResume.sectionTitles": null },
          { "optimizedResume.sectionTitles": {} },
     ],
};

/**
 * Read a client's base-resume titles from the resume service, the same way the
 * auto-optimization worker reads the resume.
 *
 * @param {string} resumeApiUrl
 * @returns {(email: string) => Promise<Record<string, string>>}
 */
export function resumeServiceTitleReader(resumeApiUrl) {
     const base = String(resumeApiUrl || "").replace(/\/+$/, "");
     return async (email) => {
          const res = await fetch(`${base}/api/resume-by-email`, {
               method: "POST",
               headers: { "Content-Type": "application/json" },
               body: JSON.stringify({ email }),
               signal: AbortSignal.timeout(20000),
          });
          if (res.status === 404) return {};
          if (!res.ok) throw new Error(`resume service answered ${res.status}`);
          const body = await res.json();
          return sanitizeSectionTitles(body?.sectionTitles);
     };
}

/**
 * @param {object} args
 * @param {import('mongodb').Collection} args.jobs  the jobdbs collection
 * @param {(email: string) => Promise<Record<string, string>>} args.readTitles
 * @param {boolean} [args.apply=false]  false = dry run, writes nothing
 * @param {string} [args.email]  limit to one client
 * @param {(line: string) => void} [args.log]
 */
export async function backfillSectionTitles({ jobs, readTitles, apply = false, email = "", log = () => {} }) {
     const only = String(email || "").trim().toLowerCase();
     const filter = only ? { ...NEEDS_TITLES, userID: only } : NEEDS_TITLES;
     const emails = (await jobs.distinct("userID", filter)).filter(Boolean);

     const summary = {
          applied: apply,
          clientsScanned: emails.length,
          clientsWithTitles: 0,
          jobsUpdated: 0,
          lookupFailures: 0,
          clients: [],
     };

     for (const clientEmail of emails) {
          let titles;
          try {
               titles = await readTitles(clientEmail);
          } catch (err) {
               summary.lookupFailures += 1;
               summary.clients.push({ email: clientEmail, error: err.message });
               log(`  ! ${clientEmail}: could not read base resume (${err.message}), skipped`);
               continue;
          }
          if (!Object.keys(titles).length) continue;

          summary.clientsWithTitles += 1;
          const clientFilter = { ...NEEDS_TITLES, userID: clientEmail };
          let jobsForClient;
          if (apply) {
               // The filter is re-checked inside the write, so a job saved with
               // titles in the meantime is left alone.
               const { modifiedCount } = await jobs.updateMany(clientFilter, {
                    $set: { "optimizedResume.sectionTitles": titles },
               });
               jobsForClient = modifiedCount;
          } else {
               jobsForClient = await jobs.countDocuments(clientFilter);
          }
          summary.jobsUpdated += jobsForClient;
          summary.clients.push({ email: clientEmail, jobs: jobsForClient, titles });
          log(`  ${clientEmail}: ${jobsForClient} job(s) <- ${JSON.stringify(titles)}`);
     }

     return summary;
}
