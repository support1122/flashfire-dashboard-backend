import axios from 'axios';
import { JobModel } from '../../Schema_Models/JobModel.js';
import { uploadJSONToR2 } from '../../Utils/r2Storage.js';
import { DiscordConnect } from '../../Utils/DiscordConnect.js';

// ─── Configuration ───────────────────────────────────────────────────
const RESUME_API_URL = process.env.RESUME_API_URL || 'http://localhost:5000';
const POLL_INTERVAL_MS = parseInt(process.env.AUTO_OPT_POLL_INTERVAL_MS) || 10000;
const DELAY_BETWEEN_JOBS_MS = parseInt(process.env.AUTO_OPT_DELAY_BETWEEN_JOBS_MS) || 5000;
const MAX_ATTEMPTS = parseInt(process.env.AUTO_OPT_MAX_ATTEMPTS) || 3;
const REQUEST_TIMEOUT_MS = parseInt(process.env.AUTO_OPT_REQUEST_TIMEOUT_MS) || 120000;
const WORKER_ENABLED = process.env.AUTO_OPT_ENABLED !== 'false';
const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
const DISCORD_ERROR_URL = process.env.DISCORD_OPTIMIZATION_ERROR_URL;

const OPTIMIZATION_PROMPT =
  'if you recieve any HTML tages please ignore it and optimize the resume according to the given JD. ' +
  'Make sure not to cut down or shorten any points in the Work Experience section. ' +
  'IN all fields please do not cut down or shorten any points or content. ' +
  'For example, if a role in the base resume has 6 points, the optimized version should also retain all 6 points. ' +
  'The content should be aligned with the JD but the number of points per role must remain the same. ' +
  'Do not touch or optimize publications if given to you.';

let isProcessing = false;
let workerRunning = false;
let pollTimer = null;

// ─── Discord Error Notification ─────────────────────────────────────
async function sendOptimizationError({ job, stage, error, attempts, isPermanent }) {
  if (!DISCORD_ERROR_URL) return;
  try {
    const status = isPermanent ? '🔴 PERMANENTLY FAILED' : `🟡 RETRY (attempt ${attempts}/${MAX_ATTEMPTS})`;
    const geminiInfo = error?.response?.data
      ? `\nGemini Response: ${JSON.stringify(error.response.data).slice(0, 300)}`
      : '';
    const statusCode = error?.response?.status ? `\nHTTP Status: ${error.response.status}` : '';

    const message =
      `\n━━━ Optimization Error ━━━` +
      `\n${status}` +
      `\n\n📋 Job Card Details:` +
      `\n• Job ID: ${job._id}` +
      `\n• Job Title: ${job.jobTitle || 'N/A'}` +
      `\n• Company: ${job.companyName || 'N/A'}` +
      `\n• Client (userID): ${job.userID || 'N/A'}` +
      `\n• Job ID (external): ${job.jobID || 'N/A'}` +
      `\n\n⚠️ Error Details:` +
      `\n• Stage: ${stage}` +
      `\n• Error: ${(error?.message || String(error)).slice(0, 400)}` +
      statusCode +
      geminiInfo +
      `\n\n🕐 Time: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}` +
      `\n━━━━━━━━━━━━━━━━━━━━━━━━`;

    await Promise.race([
      DiscordConnect(DISCORD_ERROR_URL, message),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Discord timeout')), 3000))
    ]);
  } catch (discordErr) {
    console.error('[AutoOptWorker] Failed to send Discord error notification:', discordErr.message);
  }
}

// ─── Stale Job Recovery ──────────────────────────────────────────────
async function recoverStaleJobs() {
  const cutoff = new Date(Date.now() - STALE_THRESHOLD_MS);
  const result = await JobModel.updateMany(
    {
      'autoOptimization.status': 'processing',
      'autoOptimization.startedAt': { $lt: cutoff }
    },
    {
      $set: {
        'autoOptimization.status': 'pending',
        'autoOptimization.error': 'Recovered from stale processing state (worker restart)'
      }
    }
  );
  if (result.modifiedCount > 0) {
    console.log(`[AutoOptWorker] Recovered ${result.modifiedCount} stale processing job(s)`);
  }
}

// ─── Claim Next Pending Job (Atomic) ─────────────────────────────────
async function claimNextJob() {
  return JobModel.findOneAndUpdate(
    {
      'autoOptimization.status': 'pending',
      'autoOptimization.attempts': { $lt: MAX_ATTEMPTS },
      jobDescription: { $exists: true, $nin: [null, ''] },
      'optimizedResume.hasResume': { $ne: true },
      $or: [
        { 'autoOptimization.retryAfter': { $exists: false } },
        { 'autoOptimization.retryAfter': null },
        { 'autoOptimization.retryAfter': { $lte: new Date() } }
      ]
    },
    {
      $set: {
        'autoOptimization.status': 'processing',
        'autoOptimization.startedAt': new Date()
      },
      $inc: { 'autoOptimization.attempts': 1 }
    },
    { new: true, sort: { _id: 1 } }
  ).lean();
}

// ─── Mark Job as Failed (with backoff) ───────────────────────────────
async function markFailed(jobId, errorMessage, attempts) {
  const backoffMinutes = Math.pow(2, attempts - 1); // 1, 2, 4 min
  const update = {
    'autoOptimization.error': errorMessage.slice(0, 500),
    'autoOptimization.lastFailedAt': new Date()
  };

  if (attempts >= MAX_ATTEMPTS) {
    update['autoOptimization.status'] = 'failed';
    console.error(`[AutoOptWorker] Job ${jobId} permanently failed after ${attempts} attempts: ${errorMessage}`);
  } else {
    update['autoOptimization.status'] = 'pending';
    update['autoOptimization.retryAfter'] = new Date(Date.now() + backoffMinutes * 60 * 1000);
    console.log(`[AutoOptWorker] Job ${jobId} will retry after ${backoffMinutes} min (attempt ${attempts}/${MAX_ATTEMPTS})`);
  }

  await JobModel.findByIdAndUpdate(jobId, { $set: update });
}

// ─── Mark Job as Skipped (permanent, no retry) ──────────────────────
async function markSkipped(jobId, reason) {
  await JobModel.findByIdAndUpdate(jobId, {
    $set: {
      'autoOptimization.status': 'skipped',
      'autoOptimization.error': reason,
      'autoOptimization.completedAt': new Date()
    }
  });
}

// ─── Process a Single Job ────────────────────────────────────────────
async function processJob(job) {
  const tag = `[AutoOptWorker] [${job.userID}] [${job._id}]`;
  console.log(`${tag} Starting optimization for "${job.jobTitle}" at ${job.companyName}`);
  const startMs = Date.now();

  // Step 1: Fetch user's resume from gemini microservice
  let resumeData;
  try {
    const res = await axios.post(
      `${RESUME_API_URL}/api/resume-by-email`,
      { email: job.userID },
      { timeout: REQUEST_TIMEOUT_MS }
    );
    resumeData = res.data;
  } catch (err) {
    if (err.response?.status === 404) {
      await markSkipped(job._id, 'No resume assigned to user');
      console.log(`${tag} Skipped: no resume assigned`);
      return;
    }
    err._stage = 'Resume Fetch (Gemini microservice)';
    throw err;
  }

  if (!resumeData || !resumeData.personalInfo) {
    await markSkipped(job._id, 'Invalid resume data (missing personalInfo)');
    console.log(`${tag} Skipped: invalid resume data`);
    return;
  }

  // Step 2: Prepare filtered resume (mirrors frontend logic from JobModal.tsx)
  const checkboxStates = resumeData.checkboxStates || {};
  const filteredResume = {
    ...resumeData,
    summary: checkboxStates.showSummary !== false ? resumeData.summary : '',
    projects: checkboxStates.showProjects ? resumeData.projects : [],
    leadership: checkboxStates.showLeadership ? resumeData.leadership : [],
    publications: resumeData.publications || []
  };

  // Step 3: Call optimize-with-gemini
  try {
    var optimizeRes = await axios.post(
      `${RESUME_API_URL}/api/optimize-with-gemini`,
      {
        resume_data: filteredResume,
        job_description: OPTIMIZATION_PROMPT + job.jobDescription
      },
      { timeout: REQUEST_TIMEOUT_MS }
    );
  } catch (err) {
    err._stage = 'Gemini Optimization API';
    throw err;
  }

  const optimizedData = optimizeRes.data;
  if (!optimizedData || (!optimizedData.summary && !optimizedData.workExperience)) {
    const err = new Error('Optimization returned empty/invalid data');
    err._stage = 'Gemini Optimization Response Validation';
    throw err;
  }

  // Step 4: Upload optimized resume to R2
  const r2Result = await uploadJSONToR2(optimizedData, {
    clientName: job.userID,
    jobID: job.jobID || job._id.toString(),
    folder: 'flashfirejobs'
  });

  if (!r2Result.success) {
    const err = new Error(`R2 upload failed: ${r2Result.error || 'unknown'}`);
    err._stage = 'R2 Storage Upload';
    throw err;
  }

  // Step 5: Update job in MongoDB with optimized resume + metadata
  const sectionOrder = resumeData.sectionOrder || [
    'personalInfo', 'summary', 'workExperience', 'projects',
    'leadership', 'skills', 'education', 'publications'
  ];

  await JobModel.findByIdAndUpdate(job._id, {
    $set: {
      changesMade: {
        startingContent: { summary: resumeData.summary || '' },
        finalChanges: { summary: optimizedData.summary || '' },
        timestamp: new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }),
        changedSections: ['summary'],
        source: 'auto-optimization'
      },
      optimizedResume: {
        resumeDataKey: r2Result.key,
        hasResume: true,
        showSummary: checkboxStates.showSummary !== false,
        showProjects: checkboxStates.showProjects || false,
        showLeadership: checkboxStates.showLeadership || false,
        showPublications: checkboxStates.showPublications || false,
        version: (job.optimizedResume?.version || 0) + 1,
        createdAt: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
        sectionOrder,
        storageType: 'r2'
      },
      optimizedResumeSeen: false,
      'autoOptimization.status': 'completed',
      'autoOptimization.completedAt': new Date(),
      'autoOptimization.error': null,
      updatedAt: new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })
    }
  });

  const durationSec = ((Date.now() - startMs) / 1000).toFixed(1);
  console.log(`${tag} Completed in ${durationSec}s. R2 key: ${r2Result.key}`);
}

// ─── Polling Loop ────────────────────────────────────────────────────
async function pollLoop() {
  if (!workerRunning) return;

  try {
    const job = await claimNextJob();
    if (job) {
      isProcessing = true;
      try {
        await processJob(job);
      } catch (err) {
        const attempts = job.autoOptimization?.attempts || 1;
        const isPermanent = attempts >= MAX_ATTEMPTS;
        await markFailed(job._id, err.message, attempts);
        await sendOptimizationError({
          job,
          stage: err._stage || 'Unknown Stage',
          error: err,
          attempts,
          isPermanent
        });
      }
      isProcessing = false;
      // Short delay between consecutive jobs to avoid overloading Gemini
      pollTimer = setTimeout(pollLoop, DELAY_BETWEEN_JOBS_MS);
    } else {
      // No pending jobs — wait before checking again
      pollTimer = setTimeout(pollLoop, POLL_INTERVAL_MS);
    }
  } catch (err) {
    console.error('[AutoOptWorker] Poll loop error:', err.message);
    isProcessing = false;
    pollTimer = setTimeout(pollLoop, POLL_INTERVAL_MS);
  }
}

// ─── Public API ──────────────────────────────────────────────────────
export function startAutoOptimizationWorker() {
  if (!WORKER_ENABLED) {
    console.log('[AutoOptWorker] Disabled (AUTO_OPT_ENABLED=false)');
    return;
  }
  if (workerRunning) {
    console.log('[AutoOptWorker] Already running');
    return;
  }

  workerRunning = true;
  console.log('[AutoOptWorker] Starting auto-optimization worker');
  console.log(`[AutoOptWorker] Config: poll=${POLL_INTERVAL_MS}ms, delay=${DELAY_BETWEEN_JOBS_MS}ms, maxAttempts=${MAX_ATTEMPTS}, timeout=${REQUEST_TIMEOUT_MS}ms`);
  console.log(`[AutoOptWorker] Gemini service: ${RESUME_API_URL}`);

  recoverStaleJobs()
    .then(() => pollLoop())
    .catch(err => {
      console.error('[AutoOptWorker] Failed to start:', err);
      workerRunning = false;
    });
}

export function stopAutoOptimizationWorker() {
  workerRunning = false;
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  console.log('[AutoOptWorker] Stopped');
}

export function getWorkerStatus() {
  return {
    running: workerRunning,
    processing: isProcessing,
    enabled: WORKER_ENABLED,
    config: {
      pollIntervalMs: POLL_INTERVAL_MS,
      delayBetweenJobsMs: DELAY_BETWEEN_JOBS_MS,
      maxAttempts: MAX_ATTEMPTS,
      requestTimeoutMs: REQUEST_TIMEOUT_MS,
      geminiServiceUrl: RESUME_API_URL
    }
  };
}
