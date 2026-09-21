import dotenv from 'dotenv';
import mongoose from 'mongoose';
import path from 'path';
import url from 'url';

// Local imports
import connectDB from '../Utils/ConnectDB.js';
import { JobModel } from '../Schema_Models/JobModel.js';
import { uploadJSONToR2 } from '../Utils/r2Storage.js';

dotenv.config();

// Parse CLI flags
const args = process.argv.slice(2);
const flags = new Map(
  args
    .filter(arg => arg.startsWith('--'))
    .map(arg => {
      const [k, ...rest] = arg.replace(/^--/, '').split('=');
      return [k, rest.length ? rest.join('=') : true];
    })
);

const isDryRun = flags.get('dry-run') !== undefined || flags.get('dryRun') !== undefined || process.env.DRY_RUN === 'true';
// Default: clear old data unless user opts out with --keep-old
const clearOldData = flags.get('keep-old') === undefined && flags.get('keepOld') === undefined && process.env.KEEP_OLD_DATA !== 'true';
// Default: store the full URL in resumeDataKey unless user opts out
const useUrlInKey = (flags.get('use-url-in-key') !== undefined || process.env.USE_URL_IN_KEY === 'true')
  || (flags.get('no-use-url-in-key') === undefined && process.env.USE_URL_IN_KEY !== 'false');
const batchSize = Number(flags.get('batch-size') ?? flags.get('batchSize') ?? process.env.BATCH_SIZE ?? 25);
const userEmail = flags.get('user') || flags.get('email') || null; // optional: migrate for a single user

function fmtTs() {
  return new Date().toISOString();
}

function logHeader(title) {
  console.log('\n========================================');
  console.log(title);
  console.log('========================================');
}

async function main() {
  logHeader('🚀 RESUME DATA MIGRATION TO R2 (Standalone)');
  console.log(`Mode: ${isDryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log(`Clear Old Data: ${clearOldData ? 'YES' : 'NO'}`);
  console.log(`Store URL in resumeDataKey: ${useUrlInKey ? 'YES' : 'NO'}`);
  console.log(`Batch Size: ${batchSize}`);
  if (userEmail) console.log(`Filter: userID = ${userEmail}`);
  console.log('');

  // 1) Connect to DB first
  await connectDB();

  try {
    // 2) Find legacy jobs
    const legacyFilter = {
      'optimizedResume.hasResume': true,
      $or: [
        { 'optimizedResume.storageType': 'legacy' },
        { 'optimizedResume.storageType': 'mongodb' },
        { 'optimizedResume.storageType': { $exists: false } },
      ],
      ...(userEmail ? { userID: String(userEmail).toLowerCase() } : {}),
    };

    const legacyJobs = await JobModel.find(legacyFilter)
      .select('_id jobID jobTitle companyName userID optimizedResume.hasResume optimizedResume.storageType')
      .lean();

    console.log(`📊 Found ${legacyJobs.length} candidate jobs with potential legacy resume data`);
    if (legacyJobs.length === 0) {
      console.log('No jobs to migrate. Exiting.');
      process.exit(0);
    }

    // 3) Confirm which actually have resumeData
    const jobsToMigrate = [];
    for (const job of legacyJobs) {
      const fullJob = await JobModel.findById(job._id).lean();
      if (fullJob?.optimizedResume?.resumeData) {
        jobsToMigrate.push(fullJob);
      }
    }

    console.log(`✅ ${jobsToMigrate.length} jobs contain resumeData and will be processed`);
    if (jobsToMigrate.length === 0) {
      console.log('Nothing to migrate. Exiting.');
      process.exit(0);
    }

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < jobsToMigrate.length; i += batchSize) {
      const batch = jobsToMigrate.slice(i, Math.min(i + batchSize, jobsToMigrate.length));
      console.log(`\n📦 Batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(jobsToMigrate.length / batchSize)} — jobs ${i + 1}..${i + batch.length}`);

      for (let j = 0; j < batch.length; j++) {
        const job = batch[j];
        const idx = i + j + 1;
        const progress = `[${idx}/${jobsToMigrate.length}]`;

        console.log(`${progress} ${job.jobTitle || '(Untitled)'} @ ${job.companyName || '(Company)'} — jobID=${job.jobID} user=${job.userID}`);

        if (isDryRun) {
          console.log('   ✓ [DRY RUN] Would upload resumeData to R2 and update document');
          successCount++;
          continue;
        }

        try {
          // 4) Upload to R2
          const r2Result = await uploadJSONToR2(job.optimizedResume.resumeData, {
            clientName: job.userID,
            jobID: job.jobID,
            folder: 'Legacy',
          });

          if (!r2Result?.success || !r2Result?.key) {
            console.error('   ✗ Upload to R2 failed:', r2Result?.error || 'unknown error');
            failCount++;
            continue;
          }

          // Build full URL for convenience while keeping the key for compatibility
          const basePublic = process.env.R2_PUBLIC_URL ? process.env.R2_PUBLIC_URL.replace(/\/$/, '') : '';
          const fullUrl = basePublic
            ? `${basePublic}/${r2Result.key.replace(/^\//, '')}`
            : `https://${process.env.R2_BUCKET_NAME || 'flashfire-storage'}.r2.cloudflarestorage.com/${r2Result.key}`;

          console.log(`   ✓ Uploaded to R2: ${r2Result.key}`);
          console.log(`   ↳ URL: ${fullUrl}`);

          // 5) Update document
          const updateData = {
            'optimizedResume.resumeDataKey': useUrlInKey ? fullUrl : r2Result.key,
            'optimizedResume.resumeDataUrl': fullUrl,
            'optimizedResume.resumeDataR2Key': r2Result.key,
            'optimizedResume.storageType': 'r2',
          };
          if (clearOldData) {
            updateData['optimizedResume.resumeData'] = null;
            console.log('   ✓ Cleared legacy resumeData from Mongo');
          }

          await JobModel.updateOne({ _id: job._id }, { $set: updateData });
          console.log('   ✓ Document updated');
          successCount++;
        } catch (err) {
          console.error('   ✗ Error processing job:', err?.message || err);
          failCount++;
        }
      }
    }

    logHeader('📊 MIGRATION SUMMARY');
    console.log(`Total Candidates: ${legacyJobs.length}`);
    console.log(`Processed: ${jobsToMigrate.length}`);
    console.log(`✅ Success: ${successCount}`);
    console.log(`❌ Failed: ${failCount}`);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect().catch(() => {});
  }
}

// Execute when run directly
if (import.meta.url === url.pathToFileURL(process.argv[1]).href) {
  main();
}


