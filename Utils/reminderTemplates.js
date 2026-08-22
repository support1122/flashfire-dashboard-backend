// Email + Mattermost renderers for the client-reminder stream.
//
// Seven item kinds, one shared email shell. The shell owns all of the chrome
// (header band, flame rule, wordmark, footer, preheader); each per-kind builder
// only produces body blocks, a subject and a plaintext body. That split is the
// whole point: when the brand changes we touch one function, not seven.
//
// Constraints these templates are built around, learned the hard way from the
// onboarding + milestone mail streams already in this repo:
//   • Table layout only. No flex, no grid, no CSS classes. Outlook drops them.
//   • Inline CSS only, and no <img> anywhere. The owner asked for the wordmark
//     as TEXT, and a blocked remote image is a broken-looking email.
//   • No web fonts. System stack or nothing.
//   • Every interpolated value goes through escapeHtml(), every link through
//     safeUrl(). Job titles and company names come from scraped listings, so
//     they are attacker-influenced text, not trusted copy.
//   • The text/plain alternative is written by hand, not stripped from the
//     HTML. Plenty of clients show it, and a tag-stripped dump reads like junk.
//   • Every kind states the reporting window in the body. A digest that does
//     not say which day it covers is worse than no digest.

import { REMINDER_ITEMS, reminderItemMeta, MILESTONE_THRESHOLDS } from "./reminderItems.js";

const BRAND = {
  slate: "#1f2937",
  ink: "#111827",
  body: "#374151",
  muted: "#6b7280",
  faint: "#9ca3af",
  line: "#e5e7eb",
  wash: "#f9fafb",
  page: "#f3f4f6",
  flameFrom: "#f97316",
  flameTo: "#ef4444",
  green: "#16a34a",
  violet: "#7c3aed",
  amber: "#b45309"
};

const FONT_STACK =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

const TZ = "Asia/Kolkata";
const MAX_EMAIL_JOB_ROWS = 10;
const MAX_MM_JOB_LINES = 8;
const MM_MAX_CHARS = 4000;

// Ordered key set, straight from the catalogue. Never re-declare item keys here.
const KNOWN_KINDS = new Set(REMINDER_ITEMS.map((i) => i.key));

/* ------------------------------------------------------------------ *
 * primitives
 * ------------------------------------------------------------------ */

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Only http(s) reaches an href. Blocks javascript:, data:, and the mailto:
// tricks that turn a scraped listing into a phishing vector.
function safeUrl(u) {
  const s = String(u ?? "").trim();
  return /^https?:\/\//i.test(s) ? s : "";
}

// Mattermost renders markdown. A raw pipe inside a table cell splits the row,
// a newline ends it, and backticks/asterisks flip formatting mid-sentence.
function mmEscape(s) {
  return String(s ?? "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\|/g, "\\|")
    .replace(/([*_`~])/g, "\\$1")
    .trim();
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function plural(n, one, many) {
  return num(n) === 1 ? one : many;
}

function toDate(v) {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (v === null || v === undefined || v === "") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

const FMT_DAY = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ,
  weekday: "short",
  day: "2-digit",
  month: "short",
  year: "numeric"
});
const FMT_DAY_SHORT = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ,
  day: "2-digit",
  month: "short"
});
const FMT_DOW_SHORT = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ,
  weekday: "short",
  day: "2-digit",
  month: "short"
});
const FMT_YEAR = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, year: "numeric" });
const FMT_MONTH = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, month: "long", year: "numeric" });
const FMT_DAYKEY = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});
const FMT_STAMP = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ,
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false
});

function fmtDay(d) {
  const dt = toDate(d);
  return dt ? FMT_DAY.format(dt) : "";
}
function fmtDayShort(d) {
  const dt = toDate(d);
  return dt ? FMT_DAY_SHORT.format(dt) : "";
}
function fmtMonth(d) {
  const dt = toDate(d);
  return dt ? FMT_MONTH.format(dt) : "";
}
function fmtStamp(d) {
  const dt = toDate(d);
  return dt ? FMT_STAMP.format(dt).replace(",", "") : "";
}
function dayKey(d) {
  const dt = toDate(d);
  return dt ? FMT_DAYKEY.format(dt) : "";
}

// "YYYY-MM-DD" rows from byDay are UTC midnight once parsed; +05:30 keeps them
// on the same calendar day, so formatting in IST is safe and label-correct.
function fmtByDayLabel(key) {
  const dt = toDate(`${String(key || "")}T00:00:00Z`);
  return dt ? FMT_DOW_SHORT.format(dt) : String(key || "");
}

/**
 * A human reporting window. Prefers the label the worker computed; falls back
 * to deriving one from from/to so a hand-built preview is never blank.
 */
function windowLabel(period) {
  const label = String(period?.label || "").trim();
  if (label) return label;
  const from = toDate(period?.from);
  const to = toDate(period?.to);
  if (!from || !to) return "";
  if (dayKey(from) === dayKey(to)) return fmtDay(from);
  const fy = FMT_YEAR.format(from);
  const ty = FMT_YEAR.format(to);
  return fy === ty
    ? `${fmtDayShort(from)} - ${fmtDayShort(to)} ${ty}`
    : `${fmtDayShort(from)} ${fy} - ${fmtDayShort(to)} ${ty}`;
}

function firstName(client) {
  const n = String(client?.name || "").trim();
  if (n) return n.split(/\s+/)[0];
  const email = String(client?.email || "");
  return email ? email.split("@")[0] : "there";
}

/** Defensive read of the stats contract so a partial object never throws. */
function normStats(stats) {
  const s = stats || {};
  const list = (v) => (Array.isArray(v) ? v : []);
  return {
    addedCount: num(s.addedCount),
    appliedCount: num(s.appliedCount),
    interviewCount: num(s.interviewCount),
    offerCount: num(s.offerCount),
    rejectedCount: num(s.rejectedCount),
    removedCount: num(s.removedCount),
    addedJobs: list(s.addedJobs),
    appliedJobs: list(s.appliedJobs),
    interviewJobs: list(s.interviewJobs),
    offerJobs: list(s.offerJobs),
    topCompanies: list(s.topCompanies),
    byDay: list(s.byDay),
    isEmpty: s.isEmpty === true
  };
}

function normLifetime(lifetime) {
  const l = lifetime || {};
  const orNull = (v) => (v === null || v === undefined || v === "" ? null : num(v));
  return {
    totalJobs: num(l.totalJobs),
    totalApplied: num(l.totalApplied),
    totalInterviews: num(l.totalInterviews),
    totalOffers: num(l.totalOffers),
    planType: String(l.planType || "").trim(),
    effectiveCap: orNull(l.effectiveCap),
    remaining: orNull(l.remaining),
    percentUsed: orNull(l.percentUsed)
  };
}

/* ------------------------------------------------------------------ *
 * html building blocks
 * ------------------------------------------------------------------ */

function gradientRuleRow() {
  return `<tr><td style="height:4px;font-size:0;line-height:0;background-color:${BRAND.flameFrom};background-image:linear-gradient(90deg, ${BRAND.flameFrom}, ${BRAND.flameTo});">&nbsp;</td></tr>`;
}

/** Horizontal bar drawn with two table cells. No image, no div tricks. */
function barCells(percent, color) {
  const filled = Math.max(0, Math.min(100, Math.round(num(percent))));
  const rest = 100 - filled;
  const fill = color || BRAND.flameFrom;
  const gradient =
    fill === BRAND.flameFrom
      ? `background-color:${BRAND.flameFrom};background-image:linear-gradient(90deg, ${BRAND.flameFrom}, ${BRAND.flameTo});`
      : `background-color:${fill};`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="table-layout:fixed;border-collapse:collapse;background:#eef2f7;border-radius:999px;">
    <tr>
      ${filled > 0 ? `<td width="${filled}%" style="height:10px;font-size:0;line-height:0;${gradient}border-radius:999px;">&nbsp;</td>` : ""}
      ${rest > 0 ? `<td width="${rest}%" style="height:10px;font-size:0;line-height:0;">&nbsp;</td>` : ""}
    </tr>
  </table>`;
}

function statTiles(tiles) {
  const items = (tiles || []).filter(Boolean);
  if (!items.length) return "";
  const spacerPct = 3;
  const tileW = Math.max(10, Math.floor((100 - (items.length - 1) * spacerPct) / items.length));
  const cells = items
    .map(
      (t) => `<td width="${tileW}%" style="background:${BRAND.wash};border:1px solid ${BRAND.line};border-radius:12px;padding:14px 14px 12px;vertical-align:top;">
        <div style="color:${BRAND.faint};font-size:10px;font-weight:700;letter-spacing:0.09em;text-transform:uppercase;">${escapeHtml(t.label)}</div>
        <div style="color:${t.accent || BRAND.ink};font-size:30px;line-height:1.15;font-weight:800;padding-top:4px;">${escapeHtml(String(t.value))}</div>
        ${t.hint ? `<div style="color:${BRAND.muted};font-size:12px;line-height:1.4;padding-top:3px;">${escapeHtml(t.hint)}</div>` : ""}
      </td>`
    )
    .join(`<td width="${spacerPct}%" style="font-size:0;line-height:0;">&nbsp;</td>`);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0 2px;border-collapse:collapse;"><tr>${cells}</tr></table>`;
}

function sectionTitle(text, note) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0 0;"><tr>
    <td style="color:${BRAND.ink};font-size:13px;font-weight:800;letter-spacing:0.05em;text-transform:uppercase;">${escapeHtml(text)}</td>
    ${note ? `<td align="right" style="color:${BRAND.faint};font-size:12px;">${escapeHtml(note)}</td>` : ""}
  </tr></table>`;
}

function paragraph(text, opts = {}) {
  return `<p style="margin:${opts.tight ? "6px 0 0" : "14px 0 0"};color:${opts.color || BRAND.body};font-size:15px;line-height:1.55;">${escapeHtml(text)}</p>`;
}

function windowChip(label) {
  if (!label) return "";
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:14px 0 0;"><tr>
    <td style="background:${BRAND.page};border:1px solid ${BRAND.line};border-radius:999px;padding:6px 13px;color:${BRAND.muted};font-size:12px;font-weight:600;letter-spacing:0.02em;">
      Reporting period&nbsp;&middot;&nbsp;${escapeHtml(label)}
    </td>
  </tr></table>`;
}

function jobRows(jobs, opts = {}) {
  const max = opts.max || MAX_EMAIL_JOB_ROWS;
  const list = (jobs || []).filter(Boolean);
  if (!list.length) return "";
  const shown = list.slice(0, max);
  const hidden = list.length - shown.length;

  const rows = shown
    .map((j, idx) => {
      const role = String(j?.jobTitle || "Role not recorded");
      const company = String(j?.companyName || "");
      const url = safeUrl(j?.joblink);
      const stamp = fmtStamp(j?.at);
      return `<tr>
        <td style="padding:11px 0;${idx ? `border-top:1px solid ${BRAND.line};` : ""}vertical-align:top;">
          <div style="color:${BRAND.ink};font-size:15px;font-weight:700;line-height:1.35;">${escapeHtml(role)}</div>
          <div style="color:${BRAND.muted};font-size:13px;line-height:1.45;padding-top:2px;">${company ? escapeHtml(company) : "Company not recorded"}${stamp ? ` &middot; ${escapeHtml(stamp)}` : ""}</div>
        </td>
        <td align="right" style="padding:11px 0;${idx ? `border-top:1px solid ${BRAND.line};` : ""}vertical-align:top;white-space:nowrap;">
          ${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" style="color:${BRAND.flameTo};font-size:13px;font-weight:700;text-decoration:none;">View&nbsp;&rarr;</a>` : `<span style="color:${BRAND.faint};font-size:12px;">no link</span>`}
        </td>
      </tr>`;
    })
    .join("");

  const more = hidden > 0
    ? `<tr><td colspan="2" style="padding:11px 0 0;border-top:1px solid ${BRAND.line};color:${BRAND.muted};font-size:13px;">+${hidden} more in your dashboard</td></tr>`
    : "";

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 0;border-collapse:collapse;">${rows}${more}</table>`;
}

function byDayTable(byDay) {
  const rows = (byDay || []).filter((r) => r && r.date);
  if (!rows.length) return "";
  const peak = rows.reduce((m, r) => Math.max(m, num(r.applied), num(r.added)), 0) || 1;

  const body = rows
    .map((r) => {
      const applied = num(r.applied);
      const added = num(r.added);
      const pct = Math.round((applied / peak) * 100);
      return `<tr>
        <td width="26%" style="padding:7px 0;color:${BRAND.body};font-size:13px;white-space:nowrap;">${escapeHtml(fmtByDayLabel(r.date))}</td>
        <td width="54%" style="padding:7px 8px;">${barCells(applied > 0 ? Math.max(pct, 4) : 0)}</td>
        <td width="20%" align="right" style="padding:7px 0;color:${BRAND.ink};font-size:13px;font-weight:700;white-space:nowrap;">${applied}<span style="color:${BRAND.faint};font-weight:500;"> / ${added} added</span></td>
      </tr>`;
    })
    .join("");

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:10px 0 0;border-collapse:collapse;">${body}</table>`;
}

function companyTable(topCompanies) {
  const rows = (topCompanies || []).filter((c) => c && c.name);
  if (!rows.length) return "";
  const peak = rows.reduce((m, c) => Math.max(m, num(c.count)), 0) || 1;
  const body = rows
    .map(
      (c) => `<tr>
        <td width="46%" style="padding:7px 0;color:${BRAND.body};font-size:14px;">${escapeHtml(c.name)}</td>
        <td width="40%" style="padding:7px 8px;">${barCells(Math.max(Math.round((num(c.count) / peak) * 100), 6), BRAND.violet)}</td>
        <td width="14%" align="right" style="padding:7px 0;color:${BRAND.ink};font-size:14px;font-weight:700;">${num(c.count)}</td>
      </tr>`
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:10px 0 0;border-collapse:collapse;">${body}</table>`;
}

function calloutBlock({ title, text, accent = BRAND.flameTo, tint = "#fff7ed", border = "#fed7aa" }) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0 0;"><tr>
    <td style="background:${tint};border:1px solid ${border};border-radius:12px;padding:14px 16px;">
      ${title ? `<div style="color:${accent};font-size:11px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;margin-bottom:4px;">${escapeHtml(title)}</div>` : ""}
      <div style="color:${BRAND.body};font-size:15px;line-height:1.55;">${escapeHtml(text)}</div>
    </td>
  </tr></table>`;
}

/**
 * The one and only email chrome. Every kind funnels through here so the header,
 * the flame rule, the wordmark and the footer can only ever differ by copy.
 */
function shell({ preheader, eyebrow, headline, subline, windowText, blocks, footerNote }) {
  const content = (blocks || []).filter(Boolean).join("\n");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light">
  <title>${escapeHtml(headline)}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.page};font-family:${FONT_STACK};">
  <!-- preheader: the grey preview line next to the subject in most inboxes -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${escapeHtml(preheader || headline)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.page};padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;border-collapse:collapse;">

        <tr><td style="background:${BRAND.slate};border-radius:14px 14px 0 0;padding:20px 26px 18px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
            <td style="vertical-align:middle;">
              <div style="color:#ffffff;font-size:18px;font-weight:800;letter-spacing:0.14em;text-transform:uppercase;line-height:1.1;">FlashFire</div>
              <div style="color:${BRAND.faint};font-size:11px;letter-spacing:0.04em;padding-top:3px;">Your job search, run for you</div>
            </td>
            <td align="right" style="vertical-align:middle;">
              <span style="color:${BRAND.faint};font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;">${escapeHtml(eyebrow || "Report")}</span>
            </td>
          </tr></table>
        </td></tr>

        ${gradientRuleRow()}

        <tr><td style="background:#ffffff;padding:26px 26px 4px;">
          <h1 style="margin:0;color:${BRAND.ink};font-size:22px;line-height:1.28;font-weight:800;">${escapeHtml(headline)}</h1>
          ${subline ? `<p style="margin:8px 0 0;color:${BRAND.muted};font-size:15px;line-height:1.55;">${escapeHtml(subline)}</p>` : ""}
          ${windowChip(windowText)}
          ${content}
        </td></tr>

        <tr><td style="background:#ffffff;border-radius:0 0 14px 14px;padding:22px 26px 24px;">
          <div style="border-top:1px solid ${BRAND.line};padding-top:16px;color:${BRAND.faint};font-size:12px;line-height:1.6;">
            ${escapeHtml(footerNote || "")}<br>
            &copy; ${new Date().getFullYear()} FlashFire
          </div>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/* ------------------------------------------------------------------ *
 * plaintext helpers
 * ------------------------------------------------------------------ */

function textHeading(t) {
  return [t.toUpperCase(), "-".repeat(Math.min(t.length, 46))];
}

function textJobLines(jobs, max = MAX_EMAIL_JOB_ROWS) {
  const list = (jobs || []).filter(Boolean);
  const shown = list.slice(0, max);
  const lines = shown.map((j) => {
    const role = String(j?.jobTitle || "Role not recorded");
    const company = String(j?.companyName || "Company not recorded");
    const url = safeUrl(j?.joblink);
    return `  - ${role} at ${company}${url ? `\n    ${url}` : ""}`;
  });
  if (list.length > shown.length) lines.push(`  + ${list.length - shown.length} more in your dashboard`);
  return lines;
}

function buildText({ headline, subline, windowText, sections, footerNote }) {
  const out = [headline];
  if (subline) out.push("", subline);
  if (windowText) out.push("", `Reporting period: ${windowText}`);
  for (const sec of sections || []) {
    if (!sec) continue;
    const lines = (sec.lines || []).filter((l) => l !== null && l !== undefined && l !== "");
    if (!lines.length && !sec.keepEmpty) continue;
    out.push("", ...(sec.title ? textHeading(sec.title) : []), ...lines);
  }
  out.push("", "-".repeat(46), footerNote || "FlashFire");
  return out.join("\n");
}

/* ------------------------------------------------------------------ *
 * per-kind builders
 * each returns { subject, preheader, eyebrow, headline, subline, blocks, sections }
 * ------------------------------------------------------------------ */

function buildDailySummary({ name, stats, windowText }) {
  const applied = stats.appliedCount;
  const added = stats.addedCount;

  const headline =
    applied > 0
      ? `${applied} ${plural(applied, "application", "applications")} submitted for you`
      : `${added} new ${plural(added, "role", "roles")} lined up for you`;

  const subject =
    applied > 0
      ? `${name}, ${applied} ${plural(applied, "application", "applications")} submitted today (${windowText})`
      : `${name}, ${added} new ${plural(added, "role", "roles")} added today (${windowText})`;

  const blocks = [
    statTiles([
      { label: "Applications", value: applied, accent: BRAND.flameTo, hint: "submitted in this period" },
      { label: "Roles added", value: added, accent: BRAND.ink, hint: "queued for review" }
    ])
  ];

  if (stats.interviewCount > 0 || stats.offerCount > 0) {
    blocks.push(
      calloutBlock({
        title: "Pipeline movement",
        text: `${stats.interviewCount} ${plural(stats.interviewCount, "card", "cards")} at interview stage and ${stats.offerCount} at offer stage today.`,
        accent: BRAND.violet,
        tint: "#f5f3ff",
        border: "#ddd6fe"
      })
    );
  }

  if (stats.appliedJobs.length) {
    blocks.push(sectionTitle("Applied today", `${applied} total`), jobRows(stats.appliedJobs));
  }
  if (stats.addedJobs.length) {
    blocks.push(sectionTitle("Added today", `${added} total`), jobRows(stats.addedJobs));
  }
  blocks.push(
    paragraph(
      "Everything above is live on your dashboard. Reply to this email if a role looks wrong and we will pull it from the queue."
    )
  );

  return {
    subject,
    preheader: `${applied} applied, ${added} added on ${windowText}.`,
    eyebrow: "Daily summary",
    headline: `${name}, ${headline}`,
    subline: `Here is what your FlashFire team moved on ${windowText}.`,
    blocks,
    sections: [
      { title: "Totals", lines: [`  Applications submitted: ${applied}`, `  Roles added: ${added}`] },
      { title: "Applied today", lines: textJobLines(stats.appliedJobs) },
      { title: "Added today", lines: textJobLines(stats.addedJobs) }
    ]
  };
}

function buildWeeklyReport({ name, stats, windowText }) {
  const applied = stats.appliedCount;
  const added = stats.addedCount;

  const blocks = [
    statTiles([
      { label: "Applied", value: applied, accent: BRAND.flameTo },
      { label: "Added", value: added, accent: BRAND.ink },
      { label: "Interviews", value: stats.interviewCount, accent: BRAND.violet },
      { label: "Offers", value: stats.offerCount, accent: BRAND.green }
    ])
  ];

  if (stats.byDay.length > 1) {
    blocks.push(sectionTitle("Day by day", "applications / roles added"), byDayTable(stats.byDay));
  }
  if (stats.topCompanies.length) {
    blocks.push(sectionTitle("Most applied companies"), companyTable(stats.topCompanies));
  }
  if (stats.interviewJobs.length) {
    blocks.push(sectionTitle("Reached interview"), jobRows(stats.interviewJobs, { max: 6 }));
  }
  if (stats.offerJobs.length) {
    blocks.push(sectionTitle("Offers"), jobRows(stats.offerJobs, { max: 6 }));
  }
  if (stats.appliedJobs.length) {
    blocks.push(sectionTitle("Applications this week", `${applied} total`), jobRows(stats.appliedJobs));
  }
  blocks.push(
    paragraph(
      stats.interviewCount > 0
        ? "Interviews are the number that matters. Keep your calendar open and we will keep the top of the funnel full."
        : "Volume is what turns into interviews. We are keeping the applications flowing next week."
    )
  );

  return {
    subject: `${name}, your week: ${applied} ${plural(applied, "application", "applications")}${stats.interviewCount ? `, ${stats.interviewCount} ${plural(stats.interviewCount, "interview", "interviews")}` : ""} (${windowText})`,
    preheader: `${applied} applications, ${added} roles added, ${stats.interviewCount} interviews.`,
    eyebrow: "Weekly report",
    headline: `${name}, here is your week`,
    subline: `Seven days of activity on your FlashFire account.`,
    blocks,
    sections: [
      {
        title: "Totals",
        lines: [
          `  Applications submitted: ${applied}`,
          `  Roles added: ${added}`,
          `  Interviews: ${stats.interviewCount}`,
          `  Offers: ${stats.offerCount}`
        ]
      },
      {
        title: "Day by day",
        lines: stats.byDay.map((r) => `  ${fmtByDayLabel(r.date)}: ${num(r.applied)} applied, ${num(r.added)} added`)
      },
      {
        title: "Most applied companies",
        lines: stats.topCompanies.map((c) => `  ${c.name}: ${num(c.count)}`)
      },
      { title: "Reached interview", lines: textJobLines(stats.interviewJobs, 6) },
      { title: "Applications this week", lines: textJobLines(stats.appliedJobs) }
    ]
  };
}

function buildMonthlyReport({ name, stats, period, windowText }) {
  const monthName = fmtMonth(period?.from) || windowText;
  const applied = stats.appliedCount;
  const weeks = weekBuckets(stats.byDay);

  const blocks = [
    statTiles([
      { label: "Applied", value: applied, accent: BRAND.flameTo },
      { label: "Added", value: stats.addedCount, accent: BRAND.ink },
      { label: "Interviews", value: stats.interviewCount, accent: BRAND.violet },
      { label: "Offers", value: stats.offerCount, accent: BRAND.green }
    ])
  ];

  if (weeks.length > 1) {
    blocks.push(sectionTitle("Week by week"), weekTable(weeks));
  }
  if (stats.topCompanies.length) {
    blocks.push(sectionTitle("Most applied companies"), companyTable(stats.topCompanies));
  }
  if (stats.interviewJobs.length) {
    blocks.push(sectionTitle("Interview conversations"), jobRows(stats.interviewJobs, { max: 8 }));
  }
  if (stats.offerJobs.length) {
    blocks.push(sectionTitle("Offers"), jobRows(stats.offerJobs, { max: 6 }));
  }
  blocks.push(
    calloutBlock({
      title: "Momentum",
      text:
        applied > 0
          ? `That is an average of ${(applied / Math.max(daysInWindow(period), 1)).toFixed(1)} applications a day across ${monthName}. Consistency is what pulls interviews forward, and we are carrying the same pace into this month.`
          : `${monthName} was quiet on submissions. We are rebuilding the queue and you should see movement within days.`
    })
  );

  return {
    subject: `${name}, ${monthName} in review: ${applied} ${plural(applied, "application", "applications")}`,
    preheader: `${applied} applications, ${stats.interviewCount} interviews, ${stats.offerCount} offers in ${monthName}.`,
    eyebrow: "Monthly report",
    headline: `${monthName} in review`,
    subline: `${name}, here is the full month on your FlashFire account.`,
    blocks,
    sections: [
      {
        title: `${monthName} totals`,
        lines: [
          `  Applications submitted: ${applied}`,
          `  Roles added: ${stats.addedCount}`,
          `  Interviews: ${stats.interviewCount}`,
          `  Offers: ${stats.offerCount}`
        ]
      },
      { title: "Week by week", lines: weeks.map((w) => `  ${w.label}: ${w.applied} applied, ${w.added} added`) },
      { title: "Most applied companies", lines: stats.topCompanies.map((c) => `  ${c.name}: ${num(c.count)}`) },
      { title: "Interview conversations", lines: textJobLines(stats.interviewJobs, 8) },
      { title: "Offers", lines: textJobLines(stats.offerJobs, 6) }
    ]
  };
}

function buildInterviewDigest({ name, stats, windowText }) {
  const total = stats.interviewCount + stats.offerCount;
  const cards = [...stats.offerJobs, ...stats.interviewJobs];

  const blocks = [
    statTiles([
      { label: "Interviews", value: stats.interviewCount, accent: BRAND.violet },
      { label: "Offers", value: stats.offerCount, accent: BRAND.green }
    ])
  ];

  if (stats.offerJobs.length) {
    blocks.push(sectionTitle("Offers"), jobRows(stats.offerJobs, { max: 8 }));
  }
  if (stats.interviewJobs.length) {
    blocks.push(sectionTitle("Interviews and assignments"), jobRows(stats.interviewJobs, { max: 12 }));
  }
  if (!cards.length) {
    blocks.push(
      calloutBlock({
        title: "Pipeline",
        text: `No card moved to interview, assignment or offer in ${windowText}. Applications are still going out and we will flag the moment one converts.`
      })
    );
  }
  blocks.push(
    paragraph("Prep notes and recruiter threads live on your dashboard. Tell us which of these you want help preparing for.")
  );

  return {
    subject: `${name}, ${total} ${plural(total, "card", "cards")} in your interview pipeline (${windowText})`,
    preheader: `${stats.interviewCount} interviews and ${stats.offerCount} offers in the last seven days.`,
    eyebrow: "Interview pipeline",
    headline: `${name}, your interview pipeline`,
    subline: "Every card that reached interview, assignment or offer stage this week.",
    blocks,
    sections: [
      { title: "Totals", lines: [`  Interviews: ${stats.interviewCount}`, `  Offers: ${stats.offerCount}`] },
      { title: "Offers", lines: textJobLines(stats.offerJobs, 8) },
      { title: "Interviews and assignments", lines: textJobLines(stats.interviewJobs, 12) }
    ]
  };
}

function buildPlanUsage({ name, lifetime, windowText }) {
  const cap = lifetime.effectiveCap;
  const used = lifetime.totalApplied || lifetime.totalJobs;
  const remaining = lifetime.remaining;
  const percent =
    lifetime.percentUsed !== null
      ? Math.max(0, Math.min(100, Math.round(lifetime.percentUsed)))
      : cap && cap > 0
        ? Math.max(0, Math.min(100, Math.round((used / cap) * 100)))
        : null;
  const planName = lifetime.planType || "your plan";

  const blocks = [
    statTiles([
      { label: "Used", value: used, accent: BRAND.flameTo },
      { label: "Plan cap", value: cap === null ? "No cap" : cap, accent: BRAND.ink },
      { label: "Remaining", value: remaining === null ? "Unlimited" : remaining, accent: BRAND.green }
    ])
  ];

  if (percent !== null) {
    blocks.push(
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0 0;"><tr>
        <td style="padding:0 0 6px;color:${BRAND.muted};font-size:12px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;">${escapeHtml(planName)} usage &middot; ${percent}%</td>
      </tr><tr><td>${barCells(percent)}</td></tr></table>`
    );
  }

  blocks.push(
    paragraph(
      remaining !== null && remaining <= 0
        ? `You have used the full ${planName} allocation. Reply here and we will talk through topping it up so applications do not pause.`
        : remaining !== null
          ? `${remaining} ${plural(remaining, "application", "applications")} left on ${planName}. We pace these so the strongest roles are never the ones that get skipped.`
          : `${used} ${plural(used, "application", "applications")} submitted on ${planName} so far.`
    )
  );

  return {
    subject: `${name}, ${used}${cap === null ? "" : ` of ${cap}`} ${plural(used, "application", "applications")} used on ${planName}`,
    preheader: `${used} used${remaining === null ? "" : `, ${remaining} remaining`} on ${planName}.`,
    eyebrow: "Plan usage",
    headline: `${name}, where your plan stands`,
    subline: `Usage on ${planName} as of ${windowText}.`,
    blocks,
    sections: [
      {
        title: "Plan usage",
        lines: [
          `  Plan: ${planName}`,
          `  Applications used: ${used}`,
          `  Plan cap: ${cap === null ? "no cap" : cap}`,
          `  Remaining: ${remaining === null ? "unlimited" : remaining}`,
          percent === null ? "" : `  Used: ${percent}%`
        ]
      },
      {
        title: "Lifetime",
        lines: [
          `  Total roles tracked: ${lifetime.totalJobs}`,
          `  Interviews: ${lifetime.totalInterviews}`,
          `  Offers: ${lifetime.totalOffers}`
        ]
      }
    ]
  };
}

function buildMilestone({ name, lifetime, extra, windowText }) {
  const threshold = num(extra?.threshold) || nearestThresholdBelow(lifetime.totalApplied);
  const next = MILESTONE_THRESHOLDS.find((t) => t > threshold) || null;

  const blocks = [
    statTiles([
      { label: "Milestone", value: threshold, accent: BRAND.flameTo, hint: "applications crossed" },
      { label: "Lifetime applied", value: lifetime.totalApplied, accent: BRAND.ink },
      { label: "Interviews", value: lifetime.totalInterviews, accent: BRAND.violet }
    ]),
    calloutBlock({
      title: "What this means",
      text: `${threshold} applications is a real sample size. It is enough for us to see which titles and which company sizes answer you fastest, and to weight the next batch towards them.`
    })
  ];

  if (next) {
    blocks.push(
      paragraph(
        `Next stop is ${next}. At your current pace we will get there without you lifting a finger, and we will tell you when it lands.`
      )
    );
  }

  return {
    subject: `${name}, you just crossed ${threshold} applications`,
    preheader: `${lifetime.totalApplied} applications submitted for you so far.`,
    eyebrow: "Milestone",
    headline: `${threshold} applications submitted for you`,
    subline: `${name}, that is a milestone worth marking.`,
    blocks,
    sections: [
      {
        title: "Milestone",
        lines: [
          `  Crossed: ${threshold} applications`,
          `  Lifetime applications: ${lifetime.totalApplied}`,
          `  Interviews: ${lifetime.totalInterviews}`,
          `  Offers: ${lifetime.totalOffers}`,
          next ? `  Next milestone: ${next}` : ""
        ]
      },
      { title: "As of", lines: [`  ${windowText || fmtDay(new Date())}`] }
    ]
  };
}

function buildInactivityAlert({ name, client, stats, lifetime, extra, windowText }) {
  const days = num(extra?.days);
  const blocks = [
    statTiles([
      { label: "Days idle", value: days, accent: BRAND.amber, hint: "no adds, no applications" },
      { label: "Lifetime applied", value: lifetime.totalApplied, accent: BRAND.ink }
    ]),
    calloutBlock({
      title: "Internal alert",
      text: `No job was added and no application was submitted for ${client?.email || name} in the last ${days} ${plural(days, "day", "days")}. This is an operations notice, not a client-facing message.`,
      accent: BRAND.amber,
      tint: "#fffbeb",
      border: "#fde68a"
    }),
    paragraph("Check the assigned operator, the plan status and whether the resume queue is blocked.")
  ];

  return {
    subject: `[Internal] No activity for ${days} ${plural(days, "day", "days")}: ${client?.email || name}`,
    preheader: `${days} days with zero adds and zero applications.`,
    eyebrow: "Internal alert",
    headline: `No activity for ${days} ${plural(days, "day", "days")}`,
    subline: `${client?.email || name} has had nothing added and nothing applied.`,
    blocks,
    sections: [
      {
        title: "Alert",
        lines: [
          `  Client: ${client?.email || name}`,
          `  Days idle: ${days}`,
          `  Applications in window: ${stats.appliedCount}`,
          `  Roles added in window: ${stats.addedCount}`,
          `  Lifetime applications: ${lifetime.totalApplied}`
        ]
      },
      { title: "Checked at", lines: [`  ${windowText || fmtDay(new Date())}`] }
    ]
  };
}

/* ------------------------------------------------------------------ *
 * small shared computations
 * ------------------------------------------------------------------ */

function nearestThresholdBelow(total) {
  let hit = MILESTONE_THRESHOLDS[0];
  for (const t of MILESTONE_THRESHOLDS) if (num(total) >= t) hit = t;
  return hit;
}

function daysInWindow(period) {
  const from = toDate(period?.from);
  const to = toDate(period?.to);
  if (!from || !to) return 30;
  return Math.max(1, Math.round((to.getTime() - from.getTime()) / 86400000));
}

/** Group byDay rows into runs of seven for the monthly week-by-week table. */
function weekBuckets(byDay) {
  const rows = (byDay || []).filter((r) => r && r.date);
  const out = [];
  for (let i = 0; i < rows.length; i += 7) {
    const chunk = rows.slice(i, i + 7);
    out.push({
      label: `${fmtByDayLabel(chunk[0].date)} - ${fmtByDayLabel(chunk[chunk.length - 1].date)}`,
      applied: chunk.reduce((s, r) => s + num(r.applied), 0),
      added: chunk.reduce((s, r) => s + num(r.added), 0)
    });
  }
  return out;
}

function weekTable(weeks) {
  if (!weeks.length) return "";
  const peak = weeks.reduce((m, w) => Math.max(m, w.applied), 0) || 1;
  const body = weeks
    .map(
      (w) => `<tr>
        <td width="38%" style="padding:7px 0;color:${BRAND.body};font-size:13px;white-space:nowrap;">${escapeHtml(w.label)}</td>
        <td width="42%" style="padding:7px 8px;">${barCells(w.applied > 0 ? Math.max(Math.round((w.applied / peak) * 100), 4) : 0)}</td>
        <td width="20%" align="right" style="padding:7px 0;color:${BRAND.ink};font-size:13px;font-weight:700;white-space:nowrap;">${w.applied}<span style="color:${BRAND.faint};font-weight:500;"> / ${w.added}</span></td>
      </tr>`
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:10px 0 0;border-collapse:collapse;">${body}</table>`;
}

const EMAIL_BUILDERS = {
  daily_summary: buildDailySummary,
  weekly_report: buildWeeklyReport,
  monthly_report: buildMonthlyReport,
  interview_digest: buildInterviewDigest,
  plan_usage: buildPlanUsage,
  milestone: buildMilestone,
  inactivity_alert: buildInactivityAlert
};

/* ------------------------------------------------------------------ *
 * public: email
 * ------------------------------------------------------------------ */

/**
 * Render one reminder as a branded HTML email plus a hand-written text part.
 *
 * @param {object} a
 * @param {string} a.kind    a REMINDER_ITEM_KEYS value
 * @param {object} a.client  { name, email }
 * @param {object} a.stats   getClientActivityStats() shape
 * @param {object} a.lifetime getClientLifetimeStats() shape
 * @param {object} a.period  { label, from, to }
 * @param {object} [a.extra] milestone -> { threshold }, inactivity_alert -> { days }
 * @returns {{subject:string, html:string, text:string}|null} null for an unknown kind.
 */
export function renderReminderEmail({ kind, client = {}, stats, lifetime, period = {}, extra = {} } = {}) {
  const key = String(kind || "");
  if (!KNOWN_KINDS.has(key)) return null;
  const build = EMAIL_BUILDERS[key];
  if (!build) return null;

  const meta = reminderItemMeta(key);
  const s = normStats(stats);
  const lt = normLifetime(lifetime);
  const windowText = windowLabel(period);
  const name = firstName(client);

  const spec = build({ name, client, stats: s, lifetime: lt, period, windowText, extra });

  const footerNote =
    key === "inactivity_alert"
      ? `FlashFire operations alert (${meta.label}). Internal distribution only.`
      : `You are receiving the ${meta.label.toLowerCase()} for ${client?.email || "your FlashFire account"}. Reply to this email to change what we send.`;

  const html = shell({
    preheader: spec.preheader,
    eyebrow: spec.eyebrow,
    headline: spec.headline,
    subline: spec.subline,
    windowText,
    blocks: spec.blocks,
    footerNote
  });

  const text = buildText({
    headline: spec.headline,
    subline: spec.subline,
    windowText,
    sections: spec.sections,
    footerNote
  });

  return { subject: String(spec.subject).slice(0, 180), html, text };
}

/* ------------------------------------------------------------------ *
 * public: mattermost
 * ------------------------------------------------------------------ */

function mmTable(rows) {
  const clean = (rows || []).filter((r) => Array.isArray(r) && r.length === 2);
  if (!clean.length) return [];
  return [
    "| Metric | Value |",
    "|:--|--:|",
    ...clean.map(([k, v]) => `| ${mmEscape(k)} | ${mmEscape(String(v))} |`)
  ];
}

function mmJobLines(jobs, max = MAX_MM_JOB_LINES) {
  const list = (jobs || []).filter(Boolean);
  const shown = list.slice(0, max);
  const lines = shown.map((j) => {
    const role = mmEscape(j?.jobTitle || "Role not recorded");
    const company = mmEscape(j?.companyName || "Company not recorded");
    const url = safeUrl(j?.joblink);
    // Markdown link form on purpose: Mattermost mangles a bare
    // angle-bracket-wrapped URL, and a naked long URL wrecks the line.
    return `- *${role}* at **${company}**${url ? ` - [open](${url})` : ""}`;
  });
  if (list.length > shown.length) lines.push(`- _+${list.length - shown.length} more in the dashboard_`);
  return lines;
}

const MM_BUILDERS = {
  daily_summary: ({ name, stats, windowText }) => ({
    title: `Daily summary for ${name}`,
    sub: windowText,
    rows: [
      ["Applications submitted", stats.appliedCount],
      ["Roles added", stats.addedCount],
      ["Interviews", stats.interviewCount],
      ["Offers", stats.offerCount]
    ],
    groups: [
      { heading: "Applied", jobs: stats.appliedJobs },
      { heading: "Added", jobs: stats.addedJobs }
    ]
  }),

  weekly_report: ({ name, stats, windowText }) => ({
    title: `Weekly report for ${name}`,
    sub: windowText,
    rows: [
      ["Applications submitted", stats.appliedCount],
      ["Roles added", stats.addedCount],
      ["Interviews", stats.interviewCount],
      ["Offers", stats.offerCount],
      ["Top company", stats.topCompanies[0] ? `${stats.topCompanies[0].name} (${num(stats.topCompanies[0].count)})` : "n/a"]
    ],
    groups: [
      { heading: "Interviews", jobs: stats.interviewJobs },
      { heading: "Applications", jobs: stats.appliedJobs }
    ]
  }),

  monthly_report: ({ name, stats, period, windowText }) => ({
    title: `${fmtMonth(period?.from) || "Monthly"} report for ${name}`,
    sub: windowText,
    rows: [
      ["Applications submitted", stats.appliedCount],
      ["Roles added", stats.addedCount],
      ["Interviews", stats.interviewCount],
      ["Offers", stats.offerCount]
    ],
    groups: [
      { heading: "Offers", jobs: stats.offerJobs },
      { heading: "Interviews", jobs: stats.interviewJobs }
    ]
  }),

  interview_digest: ({ name, stats, windowText }) => ({
    title: `Interview pipeline for ${name}`,
    sub: windowText,
    rows: [
      ["Interviews", stats.interviewCount],
      ["Offers", stats.offerCount]
    ],
    groups: [
      { heading: "Offers", jobs: stats.offerJobs },
      { heading: "Interviews and assignments", jobs: stats.interviewJobs }
    ]
  }),

  plan_usage: ({ name, lifetime, windowText }) => ({
    title: `Plan usage for ${name}`,
    sub: windowText,
    rows: [
      ["Plan", lifetime.planType || "n/a"],
      ["Applications used", lifetime.totalApplied || lifetime.totalJobs],
      ["Plan cap", lifetime.effectiveCap === null ? "no cap" : lifetime.effectiveCap],
      ["Remaining", lifetime.remaining === null ? "unlimited" : lifetime.remaining],
      ["Used", lifetime.percentUsed === null ? "n/a" : `${Math.round(lifetime.percentUsed)}%`]
    ],
    groups: []
  }),

  milestone: ({ name, lifetime, extra }) => {
    const threshold = num(extra?.threshold) || nearestThresholdBelow(lifetime.totalApplied);
    const next = MILESTONE_THRESHOLDS.find((t) => t > threshold) || null;
    return {
      title: `Milestone: ${name} crossed ${threshold} applications`,
      sub: fmtDay(new Date()),
      rows: [
        ["Milestone", threshold],
        ["Lifetime applications", lifetime.totalApplied],
        ["Interviews", lifetime.totalInterviews],
        ["Offers", lifetime.totalOffers],
        ["Next milestone", next === null ? "top of the ladder" : next]
      ],
      groups: []
    };
  },

  inactivity_alert: ({ name, client, stats, lifetime, extra }) => {
    const days = num(extra?.days);
    return {
      title: `No activity alert: ${name}`,
      sub: `${days} ${plural(days, "day", "days")} with nothing added and nothing applied`,
      rows: [
        ["Client", client?.email || name],
        ["Days idle", days],
        ["Applied in window", stats.appliedCount],
        ["Added in window", stats.addedCount],
        ["Lifetime applications", lifetime.totalApplied]
      ],
      groups: [],
      tail: "_Internal notice. Check the assigned operator, plan status and the resume queue._"
    };
  }
};

/**
 * Render one reminder as a Mattermost markdown post.
 * Hard-capped under 4000 chars, since Mattermost silently truncates past that.
 *
 * @returns {{text: string}|null} null for an unknown kind.
 */
export function renderReminderMattermost({ kind, client = {}, stats, lifetime, period = {}, extra = {} } = {}) {
  const key = String(kind || "");
  if (!KNOWN_KINDS.has(key)) return null;
  const build = MM_BUILDERS[key];
  if (!build) return null;

  const s = normStats(stats);
  const lt = normLifetime(lifetime);
  const windowText = windowLabel(period);
  const name = firstName(client);

  const spec = build({ name, client, stats: s, lifetime: lt, period, windowText, extra });

  const lines = [`#### ${mmEscape(spec.title)}`];
  if (spec.sub) lines.push(`_${mmEscape(spec.sub)}_`);
  lines.push("", ...mmTable(spec.rows));

  for (const group of spec.groups || []) {
    const jobLines = mmJobLines(group.jobs);
    if (!jobLines.length) continue;
    lines.push("", `**${mmEscape(group.heading)}**`, ...jobLines);
  }
  if (spec.tail) lines.push("", spec.tail);

  let text = lines.join("\n");
  if (text.length > MM_MAX_CHARS) {
    // Trim on a line boundary so we never cut a markdown link in half.
    const budget = MM_MAX_CHARS - 30;
    const cut = text.slice(0, budget);
    text = `${cut.slice(0, cut.lastIndexOf("\n"))}\n_truncated_`;
  }
  return { text };
}

export default { renderReminderEmail, renderReminderMattermost };
