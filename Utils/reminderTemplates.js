// Client reminder templates - email + Mattermost renderings for every
// catalogue item in Utils/reminderItems.js.
//
// WHAT WE DELIBERATELY DO NOT SEND, and why. This is policy, not styling -
// read it before adding anything to a client-facing template:
//
//   - NO job links. A posting is often closed by the time the client clicks,
//     and "you applied me to dead jobs" is the exact complaint this product
//     cannot afford. The dashboard is always current; every mail carries one
//     link to it and nothing else.
//   - NO per-job lists in the recurring reports. Listing ten roles every day
//     invites line-item auditing of each application and turns a status mail
//     into a support thread. Daily and weekly carry NUMBERS; the one list we
//     do send is the interview digest, because good news is worth naming.
//   - NO internal language. Operator names, "removed by AI", queue states and
//     skip reasons never appear. The stats util strips removed cards before
//     the numbers get here.
//   - NO computed success rates. Offers divided by applications looks brutal
//     at perfectly normal volumes; we report counts and let them speak.
//   - NO hype. No emoji, no exclamation marks, no "crushing it". Plain
//     statements of what happened, in a layout closer to a bank statement
//     than a newsletter. If a number is ever disputed, calm copy survives
//     the conversation; breezy copy does not.
//   - Every mail states its exact reporting window ("18 Aug - 24 Aug 2026"),
//     so any question about the numbers is anchored to checkable dates.
//
// Rendering constraints: inline CSS only, table layout only, no images, no
// web fonts - the only things Gmail, Outlook and Apple Mail all honour. The
// wordmark is styled text. Every interpolated value goes through escapeHtml
// (email) or mmEscape (Mattermost); company and role names are scraped text
// and get no more trust than any other user input.

const BRAND = {
  slate: "#1f2937",
  ink: "#111827",
  body: "#374151",
  muted: "#6b7280",
  faint: "#9ca3af",
  line: "#e5e7eb",
  track: "#f3f4f6",
  page: "#f3f4f6",
  flame: "#f97316",
  flameDeep: "#ea580c",
  green: "#16a34a",
  violet: "#7c3aed"
};

const FONT_STACK =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

const DASHBOARD_URL = "https://portal.flashfirejobs.com";

// Interview digest is the one client mail that lists cards; cap it so a busy
// pipeline cannot produce a scroll of doom.
const MAX_DIGEST_ROWS = 12;

// Hard ceiling for a Mattermost message; the server rejects ~16k but long
// posts collapse badly on mobile, so we stay far under.
const MM_MAX_CHARS = 4000;

/* ------------------------------------------------------------------ *
 * escaping + small utilities
 * ------------------------------------------------------------------ */

function escapeHtml(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Escape Mattermost markdown. Brackets and parens are included on purpose: a
 * scraped job title of `Engineer](https://phish.example/login` would otherwise
 * close a link we opened around it and render as a working link somewhere
 * else. Angle brackets stop autolinking and HTML-ish injection in clients
 * that render a preview.
 */
function mmEscape(v) {
  return String(v ?? "").replace(/([\\`*_{}[\]()<>#+\-.!|~])/g, "\\$1");
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
}

/** "1,200" - thousands separator for anything that can plausibly exceed 999. */
function fmtNum(v) {
  return num(v).toLocaleString("en-US");
}

function plural(n, one, many) {
  return n === 1 ? one : many;
}

function toDate(v) {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (v == null || v === "") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/* ------------------------------------------------------------------ *
 * IST date formatting
 * ------------------------------------------------------------------ */

const TZ = "Asia/Kolkata";
const FMT_DAY = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "short", day: "numeric", month: "short", year: "numeric" });
const FMT_DAY_SHORT = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, day: "numeric", month: "short" });
const FMT_DOW_SHORT = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" });
const FMT_YEAR = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, year: "numeric" });
const FMT_MONTH = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, month: "long", year: "numeric" });

function fmtDay(d) {
  return d ? FMT_DAY.format(d) : "";
}

function fmtRange(from, to) {
  if (!from || !to) return "";
  const fy = FMT_YEAR.format(from);
  const ty = FMT_YEAR.format(to);
  return fy === ty
    ? `${FMT_DAY_SHORT.format(from)} - ${FMT_DAY_SHORT.format(to)} ${ty}`
    : `${FMT_DAY_SHORT.format(from)} ${fy} - ${FMT_DAY_SHORT.format(to)} ${ty}`;
}

/**
 * The reporting-window line for one kind. Prefers the worker-supplied label
 * (the same string the scheduling code computed) and falls back to formatting
 * period.from/to, so preview and delivery can never disagree about the window.
 */
function windowLabel(kind, period) {
  const label = String(period?.label || "").trim();
  if (label) return label;
  const from = toDate(period?.from);
  const to = toDate(period?.to);
  if (!from || !to) return "";
  if (kind === "daily_summary") return fmtDay(from);
  if (kind === "monthly_report") return FMT_MONTH.format(from);
  return fmtRange(from, to);
}

/** "Mon 18 Aug" for a byDay row key like "2026-08-18" (an IST calendar day). */
function fmtByDayLabel(dayKey) {
  const m = String(dayKey || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return String(dayKey || "");
  // Noon UTC is unambiguously inside that IST calendar day.
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0));
  return FMT_DOW_SHORT.format(d);
}

/* ------------------------------------------------------------------ *
 * input normalisers - builders never touch raw caller input
 * ------------------------------------------------------------------ */

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
 * html building blocks - the receipt vocabulary
 * ------------------------------------------------------------------ */

/**
 * The lede: one large number and what it counts. This is the whole message;
 * everything after it is supporting detail.
 */
function lede(value, unit, note) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0 4px;">
    <tr><td>
      <div style="color:${BRAND.ink};font-size:46px;line-height:1;font-weight:800;letter-spacing:-0.02em;">${escapeHtml(value)}</div>
      <div style="color:${BRAND.body};font-size:15px;line-height:1.5;padding-top:6px;">${escapeHtml(unit)}</div>
      ${note ? `<div style="color:${BRAND.muted};font-size:13px;line-height:1.5;padding-top:2px;">${escapeHtml(note)}</div>` : ""}
    </td></tr>
  </table>`;
}

/**
 * Ruled label/value rows - the statement look. `rows` is [{label, value,
 * strong?}]; falsy rows are skipped so callers can push conditionals inline.
 */
function ruledRows(rows) {
  const body = (rows || [])
    .filter(Boolean)
    .map(
      (r) => `<tr>
        <td style="padding:11px 0;border-top:1px solid ${BRAND.line};color:${BRAND.body};font-size:14px;">${escapeHtml(r.label)}</td>
        <td align="right" style="padding:11px 0;border-top:1px solid ${BRAND.line};color:${r.strong ? BRAND.ink : BRAND.body};font-size:14px;font-weight:${r.strong ? 700 : 500};white-space:nowrap;">${escapeHtml(r.value)}</td>
      </tr>`
    )
    .join("");
  if (!body) return "";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0 0;border-collapse:collapse;border-bottom:1px solid ${BRAND.line};">${body}</table>`;
}

/** Small grey all-caps label above a table. Used sparingly. */
function tableLabel(text) {
  return `<div style="margin:24px 0 2px;color:${BRAND.faint};font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;">${escapeHtml(text)}</div>`;
}

/**
 * A single-colour horizontal bar, as nested table cells. Email-safe: no divs
 * with percentage widths, no border-radius dependence for meaning.
 */
function bar(pct) {
  const p = Math.max(0, Math.min(100, Math.round(pct)));
  const fill = p > 0 ? Math.max(p, 3) : 0;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
    ${fill > 0 ? `<td width="${fill}%" style="height:8px;background:${BRAND.flame};border-radius:4px;font-size:0;line-height:0;">&nbsp;</td>` : ""}
    <td style="height:8px;background:${BRAND.track};border-radius:4px;font-size:0;line-height:0;">&nbsp;</td>
  </tr></table>`;
}

/**
 * Day-by-day (or week-by-week) activity table: label, bar scaled to the
 * period's peak, count right. One colour; the shape carries the information.
 */
function activityTable(rows) {
  const peak = rows.reduce((m, r) => Math.max(m, r.applied), 0) || 1;
  const body = rows
    .map(
      (r) => `<tr>
        <td width="30%" style="padding:8px 0;border-top:1px solid ${BRAND.line};color:${BRAND.body};font-size:13px;white-space:nowrap;">${escapeHtml(r.label)}</td>
        <td width="50%" style="padding:8px 10px;border-top:1px solid ${BRAND.line};">${bar((r.applied / peak) * 100)}</td>
        <td width="20%" align="right" style="padding:8px 0;border-top:1px solid ${BRAND.line};color:${BRAND.ink};font-size:13px;font-weight:700;white-space:nowrap;">${fmtNum(r.applied)}</td>
      </tr>`
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 0;border-collapse:collapse;border-bottom:1px solid ${BRAND.line};">${body}</table>`;
}

/**
 * One closing sentence carrying the single dashboard link - the only link we
 * send. The link text is "your dashboard" so it reads as the noun of the
 * caller's sentence ("The full list for the week is on your dashboard."),
 * not as a button pasted mid-sentence.
 */
function dashboardLine(text) {
  return `<p style="margin:20px 0 0;color:${BRAND.body};font-size:14px;line-height:1.6;">${escapeHtml(text)}
    <a href="${DASHBOARD_URL}" style="color:${BRAND.flameDeep};font-weight:600;text-decoration:underline;">your dashboard</a>.</p>`;
}

function shell({ preheader, dateText, headline, subline, blocks, footerNote }) {
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
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${escapeHtml(preheader || headline)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.page};padding:28px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;border-collapse:collapse;">

        <tr><td style="background:${BRAND.slate};border-radius:12px 12px 0 0;padding:18px 28px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
            <td style="vertical-align:baseline;">
              <span style="color:#ffffff;font-size:15px;font-weight:800;letter-spacing:0.16em;">FLASHFIRE</span>
            </td>
            <td align="right" style="vertical-align:baseline;">
              <span style="color:${BRAND.faint};font-size:12px;">${escapeHtml(dateText || "")}</span>
            </td>
          </tr></table>
        </td></tr>
        <tr><td style="height:3px;font-size:0;line-height:0;background:${BRAND.flame};">&nbsp;</td></tr>

        <tr><td style="background:#ffffff;padding:26px 28px 6px;">
          <h1 style="margin:0;color:${BRAND.ink};font-size:19px;line-height:1.35;font-weight:700;">${escapeHtml(headline)}</h1>
          ${subline ? `<p style="margin:6px 0 0;color:${BRAND.muted};font-size:14px;line-height:1.55;">${escapeHtml(subline)}</p>` : ""}
          ${content}
        </td></tr>

        <tr><td style="background:#ffffff;border-radius:0 0 12px 12px;padding:24px 28px;">
          <div style="border-top:1px solid ${BRAND.line};padding-top:14px;color:${BRAND.faint};font-size:12px;line-height:1.6;">
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
 * plaintext part
 * ------------------------------------------------------------------ */

function buildText({ headline, windowText, rows, extraLines, footerNote }) {
  const out = ["FLASHFIRE", "", headline];
  if (windowText) out.push(windowText);
  out.push("");
  for (const r of (rows || []).filter(Boolean)) {
    out.push(`  ${r.label}: ${r.value}`);
  }
  if (extraLines && extraLines.length) {
    out.push("", ...extraLines);
  }
  out.push("", `Full detail: ${DASHBOARD_URL}`, "", footerNote || "");
  return out.join("\n").trim() + "\n";
}

/* ------------------------------------------------------------------ *
 * per-kind email builders
 * ------------------------------------------------------------------ */

function buildDailySummary({ client, stats, windowText }) {
  const applied = stats.appliedCount;
  const added = stats.addedCount;

  // Numbers only, by design. The roles themselves live on the dashboard; a
  // daily list in the inbox is the fastest way to turn a status mail into a
  // line-item audit. See the policy block at the top of this file.
  const rows = [
    { label: "Applications submitted", value: fmtNum(applied), strong: true },
    { label: "New roles added", value: fmtNum(added) },
    stats.interviewCount > 0 && { label: "Moved to interview", value: fmtNum(stats.interviewCount) },
    stats.offerCount > 0 && { label: "Offers", value: fmtNum(stats.offerCount) }
  ];

  const subject =
    applied > 0
      ? `Daily update: ${applied} ${plural(applied, "application", "applications")} submitted (${windowText})`
      : `Daily update: ${added} new ${plural(added, "role", "roles")} added (${windowText})`;

  const ledeBlock =
    applied > 0
      ? lede(fmtNum(applied), `${plural(applied, "application", "applications")} submitted today`)
      : lede(fmtNum(added), `new ${plural(added, "role", "roles")} added to your tracker today`);

  return {
    subject,
    preheader: `${applied} applied, ${added} added.`,
    dateText: windowText,
    headline: "Today on your account",
    subline: "",
    blocks: [ledeBlock, ruledRows(rows), dashboardLine("Every role, with its status, is on")],
    text: buildText({
      headline: "Today on your account",
      windowText,
      rows,
      footerNote: `Daily summary for ${client.email}. Reply to this email to change what we send.`
    }),
    footerNote: `Daily summary for ${client.email}. Reply to this email to change what we send.`
  };
}

function buildWeeklyReport({ client, stats, windowText }) {
  const applied = stats.appliedCount;

  const rows = [
    { label: "Applications submitted", value: fmtNum(applied), strong: true },
    { label: "New roles added", value: fmtNum(stats.addedCount) },
    stats.interviewCount > 0 && { label: "Moved to interview", value: fmtNum(stats.interviewCount) },
    stats.offerCount > 0 && { label: "Offers", value: fmtNum(stats.offerCount) }
  ];

  const blocks = [
    lede(fmtNum(applied), `${plural(applied, "application", "applications")} submitted this week`),
    ruledRows(rows)
  ];

  if (stats.byDay.length > 1) {
    blocks.push(
      tableLabel("Day by day"),
      activityTable(stats.byDay.map((d) => ({ label: fmtByDayLabel(d.date), applied: num(d.applied) })))
    );
  }

  // Companies are an aggregate, not a per-application list - a different and
  // much safer level of detail. Names only, no links.
  const companies = stats.topCompanies.slice(0, 5).filter((c) => c && c.name);
  if (companies.length) {
    blocks.push(
      tableLabel("Most applied"),
      ruledRows(companies.map((c) => ({ label: String(c.name), value: `${fmtNum(c.count)} ${plural(num(c.count), "application", "applications")}` })))
    );
  }

  blocks.push(dashboardLine("The full list for the week is on"));

  const interviewClause = stats.interviewCount > 0 ? `, ${stats.interviewCount} ${plural(stats.interviewCount, "interview", "interviews")}` : "";

  return {
    subject: `Weekly report: ${applied} ${plural(applied, "application", "applications")}${interviewClause} (${windowText})`,
    preheader: `${applied} applications across the week.`,
    dateText: windowText,
    headline: "Your week in review",
    subline: "",
    blocks,
    text: buildText({
      headline: "Your week in review",
      windowText,
      rows,
      extraLines: [
        ...(stats.byDay.length > 1
          ? ["Day by day:", ...stats.byDay.map((d) => `  ${fmtByDayLabel(d.date)}: ${num(d.applied)} applied, ${num(d.added)} added`)]
          : []),
        ...(companies.length ? ["", "Most applied:", ...companies.map((c) => `  ${c.name}: ${num(c.count)}`)] : [])
      ],
      footerNote: `Weekly report for ${client.email}. Reply to this email to change what we send.`
    }),
    footerNote: `Weekly report for ${client.email}. Reply to this email to change what we send.`
  };
}

/** Bucket a month's byDay rows into calendar weeks for the monthly table. */
function weekBuckets(byDay) {
  const weeks = [];
  for (let i = 0; i < byDay.length; i += 7) {
    const chunk = byDay.slice(i, i + 7);
    if (!chunk.length) continue;
    weeks.push({
      label: `Week of ${fmtByDayLabel(chunk[0].date).replace(/^\w+\s/, "")}`,
      applied: chunk.reduce((a, d) => a + num(d.applied), 0),
      added: chunk.reduce((a, d) => a + num(d.added), 0)
    });
  }
  return weeks;
}

function buildMonthlyReport({ client, stats, windowText }) {
  const applied = stats.appliedCount;

  const rows = [
    { label: "Applications submitted", value: fmtNum(applied), strong: true },
    { label: "New roles added", value: fmtNum(stats.addedCount) },
    stats.interviewCount > 0 && { label: "Moved to interview", value: fmtNum(stats.interviewCount) },
    stats.offerCount > 0 && { label: "Offers", value: fmtNum(stats.offerCount) }
  ];

  const blocks = [
    lede(fmtNum(applied), `${plural(applied, "application", "applications")} submitted in ${windowText}`),
    ruledRows(rows)
  ];

  const weeks = weekBuckets(stats.byDay);
  if (weeks.length > 1) {
    blocks.push(tableLabel("Week by week"), activityTable(weeks));
  }

  const companies = stats.topCompanies.slice(0, 5).filter((c) => c && c.name);
  if (companies.length) {
    blocks.push(
      tableLabel("Most applied"),
      ruledRows(companies.map((c) => ({ label: String(c.name), value: `${fmtNum(c.count)} ${plural(num(c.count), "application", "applications")}` })))
    );
  }

  blocks.push(dashboardLine("The month's full history is on"));

  const interviewClause = stats.interviewCount > 0 ? `, ${stats.interviewCount} ${plural(stats.interviewCount, "interview", "interviews")}` : "";

  return {
    subject: `${windowText} report: ${applied} ${plural(applied, "application", "applications")}${interviewClause}`,
    preheader: `${applied} applications in ${windowText}.`,
    dateText: windowText,
    headline: `${windowText} in review`,
    subline: "",
    blocks,
    text: buildText({
      headline: `${windowText} in review`,
      windowText: "",
      rows,
      extraLines: [
        ...(weeks.length > 1 ? ["Week by week:", ...weeks.map((w) => `  ${w.label}: ${w.applied} applied, ${w.added} added`)] : []),
        ...(companies.length ? ["", "Most applied:", ...companies.map((c) => `  ${c.name}: ${num(c.count)}`)] : [])
      ],
      footerNote: `Monthly report for ${client.email}. Reply to this email to change what we send.`
    }),
    footerNote: `Monthly report for ${client.email}. Reply to this email to change what we send.`
  };
}

function buildInterviewDigest({ client, stats, windowText }) {
  // The one report that names cards, because it is the good news. Role and
  // company only - still no links (the posting may already be down; the
  // conversation is what matters now, not the ad).
  const cards = [
    ...stats.offerJobs.map((j) => ({ ...j, stage: "Offer", color: BRAND.green })),
    ...stats.interviewJobs.map((j) => ({ ...j, stage: "Interview", color: BRAND.violet }))
  ];
  const total = cards.length;
  const shown = cards.slice(0, MAX_DIGEST_ROWS);

  const listRows = shown
    .map(
      (j) => `<tr>
        <td style="padding:12px 0;border-top:1px solid ${BRAND.line};">
          <div style="color:${BRAND.ink};font-size:14px;font-weight:600;line-height:1.4;">${escapeHtml(j.jobTitle || "Role")}</div>
          <div style="color:${BRAND.muted};font-size:13px;line-height:1.4;padding-top:1px;">${escapeHtml(j.companyName || "")}</div>
        </td>
        <td align="right" style="padding:12px 0;border-top:1px solid ${BRAND.line};vertical-align:middle;">
          <span style="color:${j.color};font-size:12px;font-weight:700;">${escapeHtml(j.stage)}</span>
        </td>
      </tr>`
    )
    .join("");

  const listTable = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:14px 0 0;border-collapse:collapse;border-bottom:1px solid ${BRAND.line};">${listRows}</table>
  ${total > shown.length ? `<p style="margin:8px 0 0;color:${BRAND.muted};font-size:13px;">And ${total - shown.length} more on your dashboard.</p>` : ""}`;

  return {
    subject: `Interview pipeline: ${total} active ${plural(total, "conversation", "conversations")}`,
    preheader: `${total} ${plural(total, "card", "cards")} at interview or offer stage.`,
    dateText: windowText,
    headline: "Where things stand",
    subline: `${plural(total, "This conversation", "These conversations")} reached interview or offer stage in the last week.`,
    blocks: [listTable, dashboardLine("Notes and next steps for each are on")],
    text: buildText({
      headline: "Where things stand",
      windowText,
      rows: [],
      extraLines: shown.map((j) => `  ${j.stage}: ${j.jobTitle || "Role"} - ${j.companyName || ""}`),
      footerNote: `Interview digest for ${client.email}. Reply to this email to change what we send.`
    }),
    footerNote: `Interview digest for ${client.email}. Reply to this email to change what we send.`
  };
}

function buildPlanUsage({ client, lifetime, windowText }) {
  const used = lifetime.totalJobs;
  const cap = lifetime.effectiveCap;
  const capped = cap != null && cap > 0;
  const pct = capped ? Math.min(100, Math.round((used / cap) * 100)) : null;

  const rows = [
    lifetime.planType && { label: "Plan", value: lifetime.planType },
    { label: "Applications used", value: fmtNum(used), strong: true },
    capped && { label: "Included in plan", value: fmtNum(cap) },
    capped && { label: "Remaining", value: fmtNum(Math.max(0, cap - used)) }
  ];

  const blocks = [
    capped
      ? lede(`${fmtNum(used)}`, `of ${fmtNum(cap)} applications used`, `${pct}% of your plan`)
      : lede(fmtNum(used), "applications submitted so far"),
    capped ? `<div style="margin:14px 0 2px;">${bar(pct)}</div>` : "",
    ruledRows(rows),
    dashboardLine("Add-ons and referral credit are visible on")
  ];

  return {
    subject: capped
      ? `Plan usage: ${fmtNum(used)} of ${fmtNum(cap)} applications`
      : `Plan usage: ${fmtNum(used)} applications submitted`,
    preheader: capped ? `${pct}% of your plan used.` : `${fmtNum(used)} applications so far.`,
    dateText: windowText,
    headline: "Your plan usage",
    subline: "",
    blocks,
    text: buildText({
      headline: "Your plan usage",
      windowText,
      rows,
      footerNote: `Plan usage summary for ${client.email}. Reply to this email to change what we send.`
    }),
    footerNote: `Plan usage summary for ${client.email}. Reply to this email to change what we send.`
  };
}

function buildMilestone({ client, lifetime, windowText, extra }) {
  const threshold = num(extra?.threshold) || lifetime.totalJobs;

  const rows = [
    { label: "Applications submitted", value: fmtNum(lifetime.totalJobs), strong: true },
    lifetime.totalInterviews > 0 && { label: "Interviews so far", value: fmtNum(lifetime.totalInterviews) },
    lifetime.totalOffers > 0 && { label: "Offers so far", value: fmtNum(lifetime.totalOffers) }
  ];

  return {
    subject: `Milestone: ${fmtNum(threshold)} applications submitted`,
    preheader: `Your search just passed ${fmtNum(threshold)} applications.`,
    dateText: windowText,
    headline: `${fmtNum(threshold)} applications`,
    subline: "Your search just passed this mark. Each one was tailored and submitted on your behalf.",
    blocks: [ruledRows(rows), dashboardLine("The full history is on")],
    text: buildText({
      headline: `Milestone: ${fmtNum(threshold)} applications`,
      windowText,
      rows,
      footerNote: `Milestone note for ${client.email}. Reply to this email to change what we send.`
    }),
    footerNote: `Milestone note for ${client.email}. Reply to this email to change what we send.`
  };
}

function buildInactivityAlert({ client, stats, windowText, extra }) {
  // Internal only - the catalogue defaults this item to Mattermost, and the
  // copy assumes an operations reader. It must never soften into client mail.
  const days = num(extra?.days);

  const rows = [
    { label: "Days without activity", value: String(days), strong: true },
    { label: "Client", value: client.email },
    { label: "Added in the window", value: fmtNum(stats.addedCount) },
    { label: "Applied in the window", value: fmtNum(stats.appliedCount) }
  ];

  return {
    subject: `[Internal] No activity for ${days} ${plural(days, "day", "days")}: ${client.email}`,
    preheader: `Internal alert - ${client.email} has been idle ${days} ${plural(days, "day", "days")}.`,
    dateText: windowText,
    headline: "Internal: client account idle",
    subline: "Operations alert. This is not sent to the client.",
    blocks: [ruledRows(rows)],
    text: buildText({
      headline: "Internal: client account idle",
      windowText,
      rows,
      footerNote: "Internal operations alert."
    }),
    footerNote: "Internal operations alert."
  };
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
 * @param {string} a.kind     a REMINDER_ITEM_KEYS value
 * @param {object} a.client   { name, email }
 * @param {object} a.stats    getClientActivityStats() shape
 * @param {object} a.lifetime getClientLifetimeStats() shape
 * @param {object} a.period   { label, from, to }
 * @param {object} [a.extra]  milestone -> { threshold }, inactivity_alert -> { days }
 * @returns {{subject:string, html:string, text:string}|null} null for an unknown kind.
 */
export function renderReminderEmail({ kind, client = {}, stats, lifetime, period = {}, extra = {} } = {}) {
  const key = String(kind || "");
  const build = EMAIL_BUILDERS[key];
  if (!build) return null;

  const c = { name: String(client.name || ""), email: String(client.email || "") };
  const built = build({
    client: c,
    stats: normStats(stats),
    lifetime: normLifetime(lifetime),
    windowText: windowLabel(key, period),
    extra: extra || {}
  });

  return {
    subject: built.subject,
    html: shell(built),
    text: built.text
  };
}

/* ------------------------------------------------------------------ *
 * public: mattermost
 * ------------------------------------------------------------------ */

/** "| Metric | Value |" table from [{label, value}] rows, falsy rows skipped. */
function mmTable(rows) {
  const body = (rows || [])
    .filter(Boolean)
    .map((r) => `| ${mmEscape(r.label)} | ${mmEscape(String(r.value))} |`)
    .join("\n");
  return `| Metric | Value |\n|:--|--:|\n${body}`;
}

const MM_BUILDERS = {
  daily_summary({ stats, windowText }) {
    return [
      `#### Daily update - ${windowText}`,
      "",
      mmTable([
        { label: "Applications submitted", value: stats.appliedCount },
        { label: "New roles added", value: stats.addedCount },
        stats.interviewCount > 0 && { label: "Moved to interview", value: stats.interviewCount },
        stats.offerCount > 0 && { label: "Offers", value: stats.offerCount }
      ])
    ].join("\n");
  },

  weekly_report({ stats, windowText }) {
    const days = stats.byDay
      .map((d) => `- ${mmEscape(fmtByDayLabel(d.date))}: **${num(d.applied)}** applied, ${num(d.added)} added`)
      .join("\n");
    const companies = stats.topCompanies
      .slice(0, 5)
      .filter((c) => c && c.name)
      .map((c) => `- ${mmEscape(c.name)}: ${num(c.count)}`)
      .join("\n");
    return [
      `#### Weekly report - ${windowText}`,
      "",
      mmTable([
        { label: "Applications submitted", value: stats.appliedCount },
        { label: "New roles added", value: stats.addedCount },
        stats.interviewCount > 0 && { label: "Moved to interview", value: stats.interviewCount },
        stats.offerCount > 0 && { label: "Offers", value: stats.offerCount }
      ]),
      ...(days ? ["", "**Day by day**", days] : []),
      ...(companies ? ["", "**Most applied**", companies] : [])
    ].join("\n");
  },

  monthly_report({ stats, windowText }) {
    const weeks = weekBuckets(stats.byDay)
      .map((w) => `- ${mmEscape(w.label)}: **${w.applied}** applied, ${w.added} added`)
      .join("\n");
    return [
      `#### ${windowText} report`,
      "",
      mmTable([
        { label: "Applications submitted", value: stats.appliedCount },
        { label: "New roles added", value: stats.addedCount },
        stats.interviewCount > 0 && { label: "Moved to interview", value: stats.interviewCount },
        stats.offerCount > 0 && { label: "Offers", value: stats.offerCount }
      ]),
      ...(weeks ? ["", "**Week by week**", weeks] : [])
    ].join("\n");
  },

  interview_digest({ stats, windowText }) {
    const cards = [
      ...stats.offerJobs.map((j) => ({ ...j, stage: "Offer" })),
      ...stats.interviewJobs.map((j) => ({ ...j, stage: "Interview" }))
    ];
    const shown = cards.slice(0, MAX_DIGEST_ROWS);
    const lines = shown.map(
      (j) => `- **${mmEscape(j.jobTitle || "Role")}** at ${mmEscape(j.companyName || "")} - ${j.stage}`
    );
    if (cards.length > shown.length) lines.push(`- and ${cards.length - shown.length} more on the dashboard`);
    return [
      `#### Interview pipeline - ${windowText}`,
      "",
      `${cards.length} active ${cards.length === 1 ? "conversation" : "conversations"}:`,
      "",
      ...lines
    ].join("\n");
  },

  plan_usage({ lifetime }) {
    const capped = lifetime.effectiveCap != null && lifetime.effectiveCap > 0;
    return [
      "#### Plan usage",
      "",
      mmTable([
        lifetime.planType && { label: "Plan", value: lifetime.planType },
        { label: "Applications used", value: fmtNum(lifetime.totalJobs) },
        capped && { label: "Included in plan", value: fmtNum(lifetime.effectiveCap) },
        capped && { label: "Remaining", value: fmtNum(Math.max(0, lifetime.effectiveCap - lifetime.totalJobs)) }
      ])
    ].join("\n");
  },

  milestone({ lifetime, extra }) {
    const threshold = num(extra?.threshold) || lifetime.totalJobs;
    return [
      `#### Milestone: ${fmtNum(threshold)} applications`,
      "",
      `This search just passed **${fmtNum(threshold)}** submitted applications.`,
      lifetime.totalInterviews > 0 ? `Interviews so far: ${fmtNum(lifetime.totalInterviews)}.` : "",
      lifetime.totalOffers > 0 ? `Offers so far: ${fmtNum(lifetime.totalOffers)}.` : ""
    ]
      .filter(Boolean)
      .join("\n");
  },

  inactivity_alert({ client, stats, extra }) {
    const days = num(extra?.days);
    return [
      `#### Internal: no activity for ${days} ${days === 1 ? "day" : "days"}`,
      "",
      mmTable([
        { label: "Client", value: client.email },
        { label: "Days idle", value: days },
        { label: "Added in window", value: stats.addedCount },
        { label: "Applied in window", value: stats.appliedCount }
      ])
    ].join("\n");
  }
};

/**
 * Render one reminder as a Mattermost markdown message.
 * Same input contract as renderReminderEmail; null for an unknown kind.
 * @returns {{text:string}|null}
 */
export function renderReminderMattermost({ kind, client = {}, stats, lifetime, period = {}, extra = {} } = {}) {
  const key = String(kind || "");
  const build = MM_BUILDERS[key];
  if (!build) return null;

  let text = build({
    client: { name: String(client.name || ""), email: String(client.email || "") },
    stats: normStats(stats),
    lifetime: normLifetime(lifetime),
    windowText: windowLabel(key, period),
    extra: extra || {}
  });

  if (text.length > MM_MAX_CHARS) {
    text = text.slice(0, MM_MAX_CHARS - 22).trimEnd() + "\n\n_(truncated)_";
  }
  return { text };
}
