// clientMailNotifier — emails the client when their connected inbox receives a
// positive milestone (interview / assignment / offer), using the branded
// flame-theme templates.
//
// Delivery (per product requirement):
//  • Sent over SMTP with the shared Gmail App Password (the same account
//    clients-tracking sends milestone mail from). Gmail auto-saves a copy to
//    that account's Sent folder → durable proof we sent it.
//  • Addressed to the client's stored PAYMENT EMAIL (dashboardtrackings.paymentEmail),
//    NOT the connected mailbox or dashboard login. No payment email on file →
//    the alert is skipped and the reason recorded (never sent to a guessed address).
//
// Design:
//  • Eligibility is decided ONCE from the classification (deriveEligibility),
//    stored on the MailDigest at creation time. Positive milestones only.
//  • Idempotent: clientNotifiedAt is the dedupe guard, flipped only after the
//    send is accepted. A retry can never double-send.
//  • FAIL-SOFT: a send failure is recorded and retried on later ticks (capped),
//    and NEVER blocks the poll or the Discord path.

import { MailDigest } from "../../Schema_Models/MailDigest.js";
import { sendEmail, isSendgridConfigured } from "../../Utils/sendgridClient.js";
import { sendViaSmtp, isSmtpConfigured } from "../../Utils/smtpSender.js";
import { renderClientMilestoneEmail, NOTIFIABLE_CATEGORIES } from "../../Utils/clientMailTemplates.js";

const ENABLED = process.env.CLIENT_MAIL_NOTIFY_ENABLED !== "0";

// Delivery channel. "smtp" (default) sends via the App-Password Gmail account so
// the mail is provably in that account's Sent folder. "sendgrid" is the legacy
// transactional path (no Sent-folder proof).
const CHANNEL = (process.env.CLIENT_MAIL_CHANNEL || "smtp").toLowerCase() === "sendgrid" ? "sendgrid" : "smtp";

function isChannelConfigured() {
  return CHANNEL === "smtp" ? isSmtpConfigured() : isSendgridConfigured();
}

// Which AI categories email the client. Default: positive milestones only.
// Override with a comma-separated env list, e.g. "interview,assessment,offer,recruiter-outreach".
const NOTIFY_CATEGORIES = new Set(
  (process.env.CLIENT_MAIL_NOTIFY_CATEGORIES || "interview,assessment,offer")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
);

// Only email milestones the model was confident about — a low-confidence guess
// on an ambiguous subject shouldn't fire a "you got an offer!" mail.
// Set CLIENT_MAIL_NOTIFY_MIN_PRIORITY=low to relax.
const MIN_PRIORITY = (process.env.CLIENT_MAIL_NOTIFY_MIN_PRIORITY || "medium").toLowerCase();
const PRIORITY_RANK = { low: 0, medium: 1, high: 2 };

const MAX_ATTEMPTS = Math.max(1, Number(process.env.CLIENT_MAIL_NOTIFY_MAX_ATTEMPTS) || 4);
// CTA button target. Falls back to the known portal so the email always has a
// working button even when CLIENT_DASHBOARD_URL / FRONTEND_URL are unset.
const DASHBOARD_URL =
  process.env.CLIENT_DASHBOARD_URL || process.env.FRONTEND_URL || "https://portal.flashfirejobs.com";
const FROM_EMAIL = process.env.CLIENT_MAIL_FROM_EMAIL || process.env.SENDGRID_FROM_EMAIL || "";
const FROM_NAME = process.env.CLIENT_MAIL_FROM_NAME || "FlashFire";

// deriveEligibility: pure, decided at digest-creation time from the classifier
// output. Works for either source:
//   • AI    → pass confident = aiSucceeded
//   • rules → pass confident = matched (a real category rule fired)
// A mail only emails the client when the classification is confident, the
// category is notifiable, and the priority clears the floor.
export function deriveEligibility({ category, priority, confident, aiSucceeded, matched }) {
  const cat = String(category || "").toLowerCase();
  // Back-compat: accept the old aiSucceeded arg, or the rules `matched` flag.
  const trustworthy = confident ?? (aiSucceeded === true || matched === true);
  const eligible =
    trustworthy === true &&
    NOTIFY_CATEGORIES.has(cat) &&
    NOTIFIABLE_CATEGORIES.includes(cat) &&
    (PRIORITY_RANK[priority] ?? 0) >= (PRIORITY_RANK[MIN_PRIORITY] ?? 1);
  return {
    clientNotifyEligible: eligible,
    clientNotifyCategory: eligible ? cat : ""
  };
}

// resolveRecipient: the client's stored PAYMENT email — nothing else. The worker
// attaches client.paymentEmail (from dashboardtrackings). We never fall back to
// the dashboard or connected address: a milestone alert must go to the payment
// email on file or not at all.
function resolveRecipient(client) {
  const pay = (client?.paymentEmail || "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(pay) ? pay : "";
}

/**
 * Send the milestone alert for one already-persisted, eligible digest.
 * Records the outcome on the digest. Never throws.
 *
 * @returns {"sent"|"skipped"|"failed"|"disabled"|"already"}
 */
export async function notifyClientForDigest({ digestDoc, client, mailbox }) {
  if (!ENABLED) return "disabled";
  if (!digestDoc?.clientNotifyEligible) return "skipped";
  if (digestDoc.clientNotifiedAt) return "already";

  // Give up after repeated failures rather than emailing forever.
  if ((digestDoc.clientNotifyAttempts || 0) >= MAX_ATTEMPTS) {
    return "failed";
  }

  const recordSkip = async (reason) => {
    await MailDigest.updateOne(
      { _id: digestDoc._id },
      { $set: { clientNotifySkippedReason: reason } }
    ).catch(() => {});
  };

  if (!isChannelConfigured()) {
    await recordSkip(CHANNEL === "smtp" ? "smtp_not_configured" : "sendgrid_not_configured");
    return "skipped";
  }

  // Payment email is the ONLY acceptable recipient.
  const to = resolveRecipient(client);
  if (!to) {
    await recordSkip("no_payment_email");
    return "skipped";
  }

  const { subject, html, text } = renderClientMilestoneEmail({
    client,
    digest: digestDoc,
    dashboardUrl: DASHBOARD_URL
  });

  const result =
    CHANNEL === "smtp"
      ? await sendViaSmtp({ to, subject, html, text })
      : await sendEmail({
          to,
          subject,
          html,
          text,
          fromEmail: FROM_EMAIL || undefined,
          fromName: FROM_NAME,
          categories: ["client-milestone", `milestone-${digestDoc.clientNotifyCategory || "other"}`]
        });

  if (result.ok) {
    // Guard the flip on clientNotifiedAt still being null so two racing workers
    // can't both mark-and-count. Whoever's update matches wins; the loser is a
    // no-op (the mail was already sent by the winner in the same instant — the
    // in-process poll is single-flighted, so a true double-send cannot occur).
    // messageId is the SMTP message-id — the send receipt matching the Sent-folder copy.
    await MailDigest.updateOne(
      { _id: digestDoc._id, clientNotifiedAt: null },
      {
        $set: {
          clientNotifiedAt: new Date(),
          clientNotifyTo: to,
          clientNotifyChannel: CHANNEL,
          clientNotifyMessageId: result.messageId || "",
          clientNotifyError: "",
          clientNotifySkippedReason: ""
        },
        $inc: { clientNotifyAttempts: 1 }
      }
    ).catch(() => {});
    return "sent";
  }

  await MailDigest.updateOne(
    { _id: digestDoc._id },
    {
      $set: { clientNotifyError: String(result.error || "unknown").slice(0, 400) },
      $inc: { clientNotifyAttempts: 1 }
    }
  ).catch(() => {});
  console.warn(
    `[client-notify] ${mailbox}: send failed for ${digestDoc.messageId} (${digestDoc.clientNotifyCategory}): ${result.error}`
  );
  return "failed";
}

/**
 * Retry sweep: eligible digests not yet emailed (a prior send failed or the
 * worker crashed between claim and send). Bounded per call.
 *
 * @returns {Promise<number>} count actually sent this pass
 */
export async function retryPendingClientNotifications({ gmailEmail, client, limit = 25 }) {
  if (!ENABLED || !isChannelConfigured()) return 0;

  const pending = await MailDigest.find({
    gmailEmail,
    clientNotifyEligible: true,
    clientNotifiedAt: null,
    clientNotifyAttempts: { $lt: MAX_ATTEMPTS }
  })
    .sort({ date: 1 })
    .limit(limit);

  let sent = 0;
  for (const doc of pending) {
    const outcome = await notifyClientForDigest({ digestDoc: doc, client, mailbox: gmailEmail });
    if (outcome === "sent") sent++;
  }
  if (sent) console.log(`[client-notify] ${gmailEmail}: recovered ${sent} pending milestone alert(s)`);
  return sent;
}

export const __config = { NOTIFY_CATEGORIES, MIN_PRIORITY, MAX_ATTEMPTS, ENABLED };
