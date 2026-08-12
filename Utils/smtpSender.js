// SMTP sender using a Gmail App Password.
//
// Mirrors DASH/clients-tracking/applications_monitor_backend/utils/smtpSender.js
// on purpose: client milestone alerts are sent through the SAME Gmail account
// (same SMTP_USER / SMTP_PASS) so that a copy lands in that account's Sent
// folder — the "proof we sent it" the product needs. Gmail auto-saves every
// message sent through smtp.gmail.com to Sent, so no IMAP append is required.
//
// Required env:
//   SMTP_USER  = full Gmail address (e.g. support@flashfirejobs.com)
//   SMTP_PASS  = 16-char Google App Password (NOT the account password)
// Optional:
//   SMTP_HOST  = smtp.gmail.com   (default)
//   SMTP_PORT  = 465              (default; 587 also works)
//   SMTP_SECURE= true             (default true for 465; false for 587)
//   SMTP_FROM_EMAIL = From address (default SMTP_USER)
//   SMTP_FROM_NAME  = From display name (e.g. "FlashFire Team")

import nodemailer from "nodemailer";

// ============================================================
//  KILL SWITCH — set to false to resume sending client emails.
// ============================================================
// When true, sendViaSmtp() sends NOTHING. This is the single hard stop for
// every client-facing email that goes through SMTP: the milestone alerts
// (interview / assignment / offer), the onboarding sequence, and the test route.
// Paused because the AI/rules classifier produced a false "you've got an
// interview" from an Amazon "Thank you for applying" auto-acknowledgement, so no
// client should receive these until detection is fixed. Flip to false to re-enable.
const EMAILS_DISABLED = true;

export function isSmtpConfigured() {
  return Boolean(process.env.SMTP_USER && process.env.SMTP_PASS);
}

/** Whether outbound client emails are currently paused by the kill switch. */
export function areEmailsDisabled() {
  return EMAILS_DISABLED;
}

export function smtpFromEmail() {
  return process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER || "";
}

// Singleton transporter — built once, reused for every send.
let _transporter = null;
function getTransporter() {
  if (_transporter) return _transporter;
  const port = Number(process.env.SMTP_PORT) || 465;
  const secure =
    process.env.SMTP_SECURE != null
      ? String(process.env.SMTP_SECURE).toLowerCase() === "true"
      : port === 465;
  _transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port,
    secure,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
  return _transporter;
}

// Test-seam: let verification inject a fake transporter without real SMTP.
export function __setTransporter(t) {
  _transporter = t;
}

/**
 * Actually connect + authenticate to the SMTP server (nodemailer verify()).
 * Used by the health route to prove the App Password works. Never throws.
 * @returns {Promise<{ok: boolean, user?: string, from?: string, error?: string}>}
 */
export async function verifySmtp() {
  if (!isSmtpConfigured()) return { ok: false, error: "smtp_not_configured" };
  try {
    await getTransporter().verify();
    return { ok: true, user: process.env.SMTP_USER, from: smtpFromEmail() };
  } catch (err) {
    return { ok: false, user: process.env.SMTP_USER, error: String(err?.message || err).slice(0, 300) };
  }
}

/**
 * Send one email over SMTP. Never throws — returns a result object.
 *
 * @param {Object} a
 * @param {string} a.to
 * @param {string} a.subject
 * @param {string} [a.html]
 * @param {string} [a.text]
 * @param {string} [a.replyTo]
 * @param {Object} [a.attachment] - { filename, mimetype, content (Buffer) }
 * @returns {Promise<{ok: boolean, messageId?: string, from?: string, error?: string}>}
 */
export async function sendViaSmtp({ to, subject, html, text, replyTo, attachment }) {
  // Hard stop — send nothing while the kill switch is on.
  if (EMAILS_DISABLED) {
    console.warn(`[smtpSender] EMAILS DISABLED — not sending "${String(subject || "").slice(0, 60)}" to ${to}`);
    return { ok: false, error: "emails_disabled", disabled: true };
  }
  if (!isSmtpConfigured()) return { ok: false, error: "smtp_not_configured" };
  if (!to || !subject || (!html && !text)) return { ok: false, error: "missing_required_fields" };

  const fromEmail = smtpFromEmail();
  // Default the display name so a bare SMTP_USER/SMTP_PASS setup still sends
  // from "FlashFire <address>" rather than a naked address.
  const fromName = process.env.SMTP_FROM_NAME || "FlashFire";
  const from = fromName ? `"${fromName}" <${fromEmail}>` : fromEmail;

  const mail = { from, to, subject, html, text, ...(replyTo ? { replyTo } : {}) };
  if (attachment) {
    mail.attachments = [
      { filename: attachment.filename, content: attachment.content, contentType: attachment.mimetype }
    ];
  }

  try {
    const info = await getTransporter().sendMail(mail);
    return { ok: true, messageId: info?.messageId || "", from };
  } catch (err) {
    return { ok: false, error: String(err?.message || err).slice(0, 400) };
  }
}
