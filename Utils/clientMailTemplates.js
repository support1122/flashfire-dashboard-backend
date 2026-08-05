// Branded HTML email templates for client milestone alerts.
//
// One shell, one accent per category, matching the FlashFire dashboard theme:
//   • flame gradient  #f97316 → #ef4444   (orange-500 → red-500)
//   • dark slate head #1f2937
//   • orange accent   #ea580c on #fff7ed / #fed7aa
//
// All CSS is inline and layout is table-based — the only thing email clients
// (Gmail, Outlook, Apple Mail) render reliably. No external assets, no web fonts.

const BRAND = {
  slate: "#1f2937",
  ink: "#111827",
  body: "#374151",
  muted: "#6b7280",
  faint: "#9ca3af",
  line: "#e5e7eb",
  flameFrom: "#f97316",
  flameTo: "#ef4444"
};

// Hosted FlashFire logo (public/Logo.png on the deployed portal). Email clients
// need an absolute HTTPS URL — data URIs and local files are stripped by Gmail.
// Override with CLIENT_MAIL_LOGO_URL; set it empty to show the wordmark alone.
const LOGO_URL =
  process.env.CLIENT_MAIL_LOGO_URL !== undefined
    ? process.env.CLIENT_MAIL_LOGO_URL
    : "https://portal.flashfirejobs.com/Logo.png";

// Per-category art direction + copy. `key` is the AI category; `assessment`
// is surfaced to the client as "Assignment".
const CATEGORY = {
  interview: {
    label: "Interview",
    emoji: "🎉",
    accent: "#7c3aed", // violet
    tint: "#f5f3ff",
    border: "#ddd6fe",
    headline: "You've got an interview",
    blurb: "A company wants to talk to you. Here are the details we spotted."
  },
  assessment: {
    label: "Assignment",
    emoji: "📝",
    accent: "#0891b2", // cyan
    tint: "#ecfeff",
    border: "#a5f3fc",
    headline: "You've received an assignment",
    blurb: "A company sent you a task or assessment. Don't miss the deadline."
  },
  offer: {
    label: "Offer",
    emoji: "🏆",
    accent: "#16a34a", // green
    tint: "#f0fdf4",
    border: "#bbf7d0",
    headline: "You've got an offer",
    blurb: "This looks like an offer landed in your inbox. Congratulations."
  }
};

// Categories that can be surfaced to the client. Exported so the notifier and
// the templates never drift apart.
export const NOTIFIABLE_CATEGORIES = Object.keys(CATEGORY);

export function categoryMeta(category) {
  return CATEGORY[category] || null;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Only allow http(s) links into href attributes — never a javascript: URI.
function safeUrl(u) {
  const s = String(u || "").trim();
  return /^https?:\/\//i.test(s) ? s : "";
}

function firstName(client) {
  const n = (client?.name || "").trim();
  if (n) return n.split(/\s+/)[0];
  const email = client?.email || "";
  return email ? email.split("@")[0] : "there";
}

/**
 * Render a milestone alert email for one classified mail.
 *
 * @param {Object} a
 * @param {Object} a.client   - { name, email }
 * @param {Object} a.digest   - { category, subject, from, fromEmail, summary,
 *                               keyPoints[], actionRequired, urls[], date }
 * @param {string} [a.dashboardUrl] - CTA target (defaults to the dashboard root)
 * @returns {{subject: string, html: string, text: string, category: string}}
 */
export function renderClientMilestoneEmail({ client = {}, digest = {}, dashboardUrl }) {
  const meta = CATEGORY[digest.category] || CATEGORY.interview;
  const name = firstName(client);

  const subjectLine = digest.subject ? String(digest.subject) : "(no subject)";
  const sender = digest.from || digest.fromEmail || "a company";
  const summary = digest.summary || digest.snippet || "";
  const keyPoints = Array.isArray(digest.keyPoints) ? digest.keyPoints.slice(0, 5) : [];
  const action = digest.actionRequired || "";
  const primaryUrl = safeUrl((digest.urls || []).find((u) => safeUrl(u)));
  const cta = safeUrl(dashboardUrl) || primaryUrl;

  // ── Subject line of OUR email ──
  const subject = `${meta.emoji} ${meta.headline} — ${subjectLine}`.slice(0, 180);

  // ── Key points list ──
  const keyPointsHtml = keyPoints.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 4px;">
         ${keyPoints
           .map(
             (k) => `<tr><td style="padding:4px 0;color:${BRAND.body};font-size:15px;line-height:1.5;vertical-align:top;">
               <span style="color:${meta.accent};font-weight:700;">•</span>&nbsp; ${escapeHtml(k)}</td></tr>`
           )
           .join("")}
       </table>`
    : "";

  const actionHtml = action
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0 0;">
         <tr><td style="background:${meta.tint};border:1px solid ${meta.border};border-radius:10px;padding:14px 16px;">
           <div style="color:${meta.accent};font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">Next step</div>
           <div style="color:${BRAND.body};font-size:15px;line-height:1.5;">${escapeHtml(action)}</div>
         </td></tr>
       </table>`
    : "";

  const ctaHtml = cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 4px;">
         <tr><td style="border-radius:10px;background-image:linear-gradient(90deg, ${BRAND.flameFrom}, ${BRAND.flameTo});">
           <a href="${cta}" target="_blank"
              style="display:inline-block;padding:13px 28px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px;">
              ${primaryUrl && cta === primaryUrl ? "Open the email" : "Open your dashboard"} &rarr;</a>
         </td></tr>
       </table>`
    : "";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light">
  <title>${escapeHtml(meta.headline)}</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(meta.headline)}: ${escapeHtml(subjectLine)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;">

        <!-- Header -->
        <tr><td style="background:${BRAND.slate};border-radius:14px 14px 0 0;padding:22px 28px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
            <td style="vertical-align:middle;">
              ${
                LOGO_URL
                  ? `<img src="${LOGO_URL}" width="26" height="26" alt="FlashFire" style="display:inline-block;width:26px;height:26px;border-radius:7px;vertical-align:middle;border:0;outline:none;">`
                  : ""
              }
              <span style="color:#ffffff;font-size:17px;font-weight:800;letter-spacing:-0.01em;vertical-align:middle;${LOGO_URL ? "margin-left:10px;" : ""}">FlashFire</span>
            </td>
            <td align="right" style="vertical-align:middle;">
              <span style="color:${BRAND.faint};font-size:11px;text-transform:uppercase;letter-spacing:0.08em;">Job Alert</span>
            </td>
          </tr></table>
        </td></tr>

        <!-- Body -->
        <tr><td style="background:#ffffff;padding:30px 28px 8px;">
          <span style="display:inline-block;background:${meta.tint};color:${meta.accent};border:1px solid ${meta.border};font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;padding:5px 12px;border-radius:999px;">${meta.emoji}&nbsp; ${escapeHtml(meta.label)}</span>
          <h1 style="margin:16px 0 6px;color:${BRAND.ink};font-size:24px;line-height:1.25;font-weight:800;">${escapeHtml(meta.headline)}, ${escapeHtml(name)}</h1>
          <p style="margin:0 0 18px;color:${BRAND.muted};font-size:15px;line-height:1.5;">${escapeHtml(meta.blurb)}</p>

          <!-- Source mail card -->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${BRAND.line};border-radius:12px;overflow:hidden;">
            <tr><td style="padding:16px 18px;">
              <div style="color:${BRAND.faint};font-size:11px;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:3px;">From</div>
              <div style="color:${BRAND.body};font-size:14px;font-weight:600;margin-bottom:12px;">${escapeHtml(sender)}</div>
              <div style="color:${BRAND.faint};font-size:11px;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:3px;">Subject</div>
              <div style="color:${BRAND.ink};font-size:16px;font-weight:700;line-height:1.35;">${escapeHtml(subjectLine)}</div>
            </td></tr>
            ${
              summary
                ? `<tr><td style="padding:0 18px 16px;">
                     <div style="border-top:1px solid ${BRAND.line};padding-top:14px;">
                       <div style="color:${BRAND.faint};font-size:11px;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:6px;">What it says</div>
                       <div style="color:${BRAND.body};font-size:15px;line-height:1.55;">${escapeHtml(summary)}</div>
                       ${keyPointsHtml}
                     </div>
                   </td></tr>`
                : ""
            }
          </table>

          ${actionHtml}
          ${ctaHtml}
        </td></tr>

        <!-- Reassurance strip -->
        <tr><td style="background:#ffffff;padding:8px 28px 26px;">
          <p style="margin:14px 0 0;color:${BRAND.faint};font-size:13px;line-height:1.5;border-top:1px solid ${BRAND.line};padding-top:16px;">
            We spotted this in your connected inbox and flagged it so it doesn't slip past you.
            Your FlashFire team is on it.
          </p>
        </td></tr>

        <!-- Footer -->
        <tr><td style="background:#ffffff;border-radius:0 0 14px 14px;padding:0 28px 24px;">
          <div style="text-align:center;color:${BRAND.faint};font-size:12px;line-height:1.6;">
            © 2026 FlashFire · You're receiving this because your job-search inbox is connected to FlashFire.
          </div>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  // ── Plaintext fallback ──
  const textLines = [
    `${meta.headline}, ${name}`,
    "",
    meta.blurb,
    "",
    `From: ${sender}`,
    `Subject: ${subjectLine}`
  ];
  if (summary) textLines.push("", summary);
  if (keyPoints.length) textLines.push("", ...keyPoints.map((k) => `- ${k}`));
  if (action) textLines.push("", `Next step: ${action}`);
  if (cta) textLines.push("", cta);
  textLines.push("", "— FlashFire · flagged from your connected inbox.");
  const text = textLines.join("\n");

  return { subject, html, text, category: digest.category };
}
