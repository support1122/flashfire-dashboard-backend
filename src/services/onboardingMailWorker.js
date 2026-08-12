// onboardingMailWorker — fires a short email sequence to a client's PAYMENT email
// when their FIRST job reaches the "Applied" column.
//
// Sequence (spaced ~90 min apart, sent over the App-Password SMTP account):
//   1. base résumé is ready       → check WhatsApp group
//   2. cover letter is ready      → check WhatsApp group   (executive/prime only)
//   3. LinkedIn optimization done → check WhatsApp group
//
// Plan gating:
//   executive / prime → all three
//   professional / ignite → base résumé + LinkedIn (no cover letter)
//
// SAFETY — the big one: every existing client already has applied jobs, so on
// first run we BACKFILL them as "skipped" (marker-guarded, one time) and never
// email them. Only a client who crosses 0→1 applied AFTER this ships is scheduled.
//
// Idempotent: one OnboardingMailState per client; a step sends at most once
// (sentAt guard); steps go out in order, one per tick, so spacing survives
// restarts. Nothing here throws to the caller.

import cron from "node-cron";
import { JobModel } from "../../Schema_Models/JobModel.js";
import { ClientPaymentLookup } from "../../Schema_Models/ClientPaymentLookup.js";
import { OnboardingMailState, ONBOARDING_BACKFILL_MARKER } from "../../Schema_Models/OnboardingMailState.js";
import { sendViaSmtp, isSmtpConfigured, areEmailsDisabled } from "../../Utils/smtpSender.js";
import { renderOnboardingEmail } from "../../Utils/onboardingMailTemplates.js";

// ── Fixed config (hard-coded; no env sprawl) ──
const CRON_EXPR = "*/15 * * * *"; // every 15 min
const SPACING_MIN = 90; // gap between emails (within the 1–2h ask)
const MAX_ATTEMPTS = 4; // per step, before giving up
const APPLIED_RE = /appl/i; // currentStatus for an applied job

// Which steps each plan receives, in order.
const PLAN_STEPS = {
  executive: ["base_resume", "cover_letter", "linkedin"],
  prime: ["base_resume", "cover_letter", "linkedin"],
  professional: ["base_resume", "linkedin"],
  ignite: ["base_resume", "linkedin"]
};
const DEFAULT_STEPS = ["base_resume", "linkedin"];

// Enable only on the real Render deploy (or forced), and only with SMTP — a
// laptop sharing the prod DB must never fire onboarding mail to real clients.
const _raw = process.env.ONBOARDING_MAIL_ENABLED;
const ENABLED = _raw === "1" ? true : _raw === "0" ? false : Boolean(process.env.RENDER);
const ENABLED_REASON =
  _raw === "1" ? "forced on" : _raw === "0" ? "forced off" : Boolean(process.env.RENDER) ? "auto-on (Render)" : "off (not Render)";

let running = false;
let task = null;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const lc = (s) => String(s || "").toLowerCase().trim();

export function stepsForPlan(planType) {
  return PLAN_STEPS[lc(planType)] || DEFAULT_STEPS;
}

// ── One-time backfill: mark every client who ALREADY has applied jobs as
// skipped, so the sequence only ever fires for future first-applications. ──
async function backfillOnce() {
  const marker = await OnboardingMailState.findOne({ clientEmail: ONBOARDING_BACKFILL_MARKER }).lean();
  if (marker) return { alreadyDone: true };

  const appliedUserIDs = await JobModel.distinct("userID", { currentStatus: APPLIED_RE });
  const emails = [...new Set(appliedUserIDs.map(lc).filter((e) => EMAIL_RE.test(e)))];

  if (emails.length) {
    // Insert a 'skipped' doc for each, ignoring any that already exist.
    const ops = emails.map((clientEmail) => ({
      updateOne: {
        filter: { clientEmail },
        update: { $setOnInsert: { clientEmail, status: "skipped", skipReason: "backfill_existing", steps: [] } },
        upsert: true
      }
    }));
    try {
      await OnboardingMailState.bulkWrite(ops, { ordered: false });
    } catch (e) {
      // Duplicate-key races are expected under concurrency; ignore them.
      if (e?.code !== 11000) console.error("[onboarding-mail] backfill bulkWrite:", e?.message || e);
    }
  }

  await OnboardingMailState.updateOne(
    { clientEmail: ONBOARDING_BACKFILL_MARKER },
    { $setOnInsert: { clientEmail: ONBOARDING_BACKFILL_MARKER, status: "skipped", skipReason: "marker", steps: [] } },
    { upsert: true }
  ).catch(() => {});

  console.log(`[onboarding-mail] backfill complete — ${emails.length} existing applied-client(s) marked skipped`);
  return { backfilled: emails.length };
}

// ── Detect clients whose FIRST application just landed, and schedule them. ──
async function detectAndSchedule() {
  // Candidate clients = tracked clients with a valid payment email, not already
  // handled (no OnboardingMailState doc).
  const clients = await ClientPaymentLookup.find({})
    .select("email name planType paymentEmail")
    .lean()
    .catch(() => []);

  const known = new Set(
    (await OnboardingMailState.find({}).select("clientEmail").lean().catch(() => [])).map((d) => lc(d.clientEmail))
  );

  const candidates = clients
    .map((c) => ({
      email: lc(c.email),
      name: c.name || "",
      planType: lc(c.planType),
      paymentEmail: lc(c.paymentEmail)
    }))
    .filter((c) => c.email && !known.has(c.email) && EMAIL_RE.test(c.paymentEmail));

  if (!candidates.length) return { scheduled: 0 };

  // One query: which candidates have at least one applied job.
  const appliedSet = new Set(
    (await JobModel.distinct("userID", {
      userID: { $in: candidates.map((c) => c.email) },
      currentStatus: APPLIED_RE
    }).catch(() => [])).map(lc)
  );

  let scheduled = 0;
  const now = Date.now();
  for (const c of candidates) {
    if (!appliedSet.has(c.email)) continue; // not applied yet → check again next tick

    const keys = stepsForPlan(c.planType);
    const steps = keys.map((key, i) => ({
      key,
      subject: "",
      sendAt: new Date(now + i * SPACING_MIN * 60 * 1000),
      sentAt: null,
      attempts: 0,
      error: ""
    }));

    try {
      await OnboardingMailState.create({
        clientEmail: c.email,
        clientName: c.name,
        planType: c.planType,
        paymentEmail: c.paymentEmail,
        firstAppliedAt: new Date(),
        status: "scheduled",
        steps
      });
      scheduled++;
      console.log(`[onboarding-mail] scheduled ${keys.length}-step sequence for ${c.email} (${c.planType || "?"})`);
    } catch (e) {
      if (e?.code !== 11000) console.error(`[onboarding-mail] schedule failed for ${c.email}: ${e?.message || e}`);
    }
  }
  return { scheduled };
}

// ── Send due steps — one step per client per tick, in order, honouring spacing. ──
export async function sendDue() {
  // Global kill switch — don't send, and don't touch attempt counters, so a
  // paused sequence resumes cleanly when re-enabled (see Utils/smtpSender.js).
  if (areEmailsDisabled()) return { sent: 0, skipped: "emails_disabled" };
  if (!isSmtpConfigured()) return { sent: 0, skipped: "smtp_not_configured" };

  const docs = await OnboardingMailState.find({ status: "scheduled" }).catch(() => []);
  let sent = 0;

  for (const doc of docs) {
    // First not-yet-sent step, in order.
    const idx = doc.steps.findIndex((s) => !s.sentAt);
    if (idx === -1) {
      doc.status = "done";
      await doc.save().catch(() => {});
      continue;
    }
    const step = doc.steps[idx];
    if (new Date(step.sendAt).getTime() > Date.now()) continue; // not due yet
    if ((step.attempts || 0) >= MAX_ATTEMPTS) continue; // give up on this step (blocks the rest by design)

    const rendered = renderOnboardingEmail({ key: step.key, clientName: doc.clientName, clientEmail: doc.paymentEmail });
    if (!rendered) {
      step.attempts = MAX_ATTEMPTS; // unknown step key — don't spin on it
      step.error = "unknown_step";
      await doc.save().catch(() => {});
      continue;
    }

    const result = await sendViaSmtp({ to: doc.paymentEmail, subject: rendered.subject, html: rendered.html, text: rendered.text });
    step.attempts = (step.attempts || 0) + 1;
    if (result.ok) {
      step.sentAt = new Date();
      step.messageId = result.messageId || "";
      step.subject = rendered.subject;
      step.error = "";
      sent++;
      // If that was the last step, close out the sequence.
      if (doc.steps.every((s) => s.sentAt)) doc.status = "done";
      console.log(`[onboarding-mail] sent '${step.key}' to ${doc.paymentEmail} (${doc.clientEmail})`);
    } else {
      step.error = String(result.error || "send_failed").slice(0, 300);
      console.warn(`[onboarding-mail] send '${step.key}' to ${doc.paymentEmail} failed: ${step.error}`);
    }
    await doc.save().catch((e) => console.error("[onboarding-mail] save failed:", e?.message || e));
  }
  return { sent };
}

export async function onboardingTick({ trigger = "cron" } = {}) {
  if (!ENABLED) return { disabled: true, reason: ENABLED_REASON };
  if (running) return { skipped: "already_running" };
  running = true;
  const startedAt = Date.now();
  try {
    // Order matters: backfill (skip existing) BEFORE detect, so pre-existing
    // clients can never be scheduled. Detect ONLY after the marker is confirmed
    // set — if backfill was interrupted, we'd rather wait a tick than risk
    // scheduling an existing client before their skip-doc exists.
    await backfillOnce();
    const backfillConfirmed = await OnboardingMailState.exists({ clientEmail: ONBOARDING_BACKFILL_MARKER });
    let d = { scheduled: 0 };
    if (backfillConfirmed) {
      d = await detectAndSchedule();
    } else {
      console.warn("[onboarding-mail] backfill not confirmed — skipping detect this tick (safety)");
    }
    const s = await sendDue();
    const out = { trigger, scheduled: d.scheduled || 0, sent: s.sent || 0, tookMs: Date.now() - startedAt };
    if (out.scheduled || out.sent) console.log(`[onboarding-mail] tick — scheduled=${out.scheduled} sent=${out.sent}`);
    return out;
  } catch (err) {
    console.error("[onboarding-mail] tick crashed:", err);
    return { error: err.message };
  } finally {
    running = false;
  }
}

export function startOnboardingMailWorker() {
  if (!ENABLED) {
    console.log(`[onboarding-mail] disabled (${ENABLED_REASON})`);
    return null;
  }
  if (task) return task;
  task = cron.schedule(CRON_EXPR, () => onboardingTick({ trigger: "cron" }), { timezone: "Asia/Kolkata" });
  console.log(`[onboarding-mail] worker registered (${ENABLED_REASON}, cron='${CRON_EXPR}', spacing=${SPACING_MIN}m)`);
  return task;
}
