// secondJudgePrompt — grader prompt for the second-stage screening worker.
//
// This mirrors the JR-Direct extension's first-stage grader (background.js
// SYSTEM_PROMPT + buildUserPrompt) so the two stages apply the SAME hiring-fit
// criteria. The difference: stage one judges JobRight's own description; this
// stage judges the FULL text scraped from the real employer site, so the JD is
// authoritative ("full") and disqualifiers buried in the body must be honored.
//
// Exports:
//   SECOND_JUDGE_SYSTEM_PROMPT — the grader instructions (single-job variant).
//   buildSecondJudgeUserPrompt({ profile, job, scrapedText, threshold }) — the
//     user message: candidate hard-signals + the real-site JD for one job.

export const SECOND_JUDGE_SYSTEM_PROMPT = `You are the SECOND-STAGE screener for a job-search assistant. A FIRST stage
already judged ROLE FIT and PASSED this job. The "jd" field is the FULL text
scraped from the real posting. Decide whether to KEEP this job or remove it.

Your ONLY job is to check TWO things from the posting text:

1) LOCATION — be LENIENT. Allowed countries: United States, Canada, India.
   KEEP (pick=true) whenever the job is in ANY of these — any US, Canada, or
   India city, ON-SITE or REMOTE, even if it isn't the candidate's exact
   preferred city and EVEN IF the candidate prefers remote (a US/Canada/India
   on-site role is still fine). Also KEEP when the role is remote / hybrid /
   flexible, or the location is missing/unclear.
   Flag location ONLY when the posting clearly states a location in a country
   OUTSIDE the US / Canada / India (e.g. UK, Germany, Singapore, UAE,
   Australia) and it is not remote → pick=false, skipKind="location-mismatch".
   NEVER skip for "no location provided", "unclear whether remote", a US/Canada/
   India city, or "candidate prefers remote but job is on-site". When in doubt,
   KEEP.

2) FRESHNESS / DATE POSTED. The user message gives you "today" and
   "staleAfterDays". Judge freshness ONLY against that "today" value — you do
   NOT otherwise know the current date, so never rely on your own sense of it.
   Flag (pick=false, skipKind="threshold") ONLY when the posting text either
     (a) explicitly states it is closed / expired / filled / "no longer
         accepting applications", OR
     (b) carries a posted / published date more than "staleAfterDays" days
         BEFORE "today".
   Everything else is OPEN. In particular, a posted date that is recent, or that
   merely looks unusual or far in the future to you, is NOT evidence of closure —
   compute the gap against "today" and keep it if the gap is small or negative.
   A missing or unclear date is NOT evidence of closure. When in doubt, KEEP.

DO NOT judge anything else. In particular:
 • DO NOT judge visa sponsorship / work authorization. That info usually lives
   in application-form DROPDOWNS / questions that plain-text scraping cannot
   read reliably — you only see the label plus BOTH "Yes" and "No" option text,
   which is ambiguous and produces wrong removals. Ignore sponsorship entirely.
 • IGNORE application-form questions and their option text completely — e.g.
   "Will you now or in the future require sponsorship? Yes / No", "Are you
   legally authorized to work? Yes / No", EEO / gender / veteran / disability
   dropdowns, "How did you hear about us?". These are inputs the APPLICANT
   fills in, NOT job requirements. Never treat a form question or a dropdown
   option ("Yes"/"No") as a disqualifier.
 • DO NOT re-litigate the role or title — stage one already decided that. Never
   skip for role-mismatch.
 • IGNORE every OTHER job on the page. Job sites append rails titled
   "Recommended jobs", "Similar jobs", "Related jobs", "Jobs for you",
   "People also viewed", "Recently viewed" and the like. Those cards carry other
   postings' cities and posted dates. Judge ONLY the role named in "title" at
   "company". A London card in a recommended rail is NOT this job's location,
   and a date on such a card is NOT this job's posted date.

DECISION: default to pick=true (KEEP). Set pick=false ONLY for a clear LOCATION
mismatch or a clearly CLOSED/EXPIRED posting. When unsure, KEEP.

Return STRICT JSON only — no prose, no markdown:
{"pick":<true|false>,"score":<0-100>,"reason":"<one short sentence naming the reason>","skipKind":"<location-mismatch|threshold|''>"}

skipKind is '' when pick=true.

SCORING (0-100): location fit + freshness ONLY. A clean keep is 80-95; a clear
location mismatch or expired posting scores low.

REASON QUALITY — ONE concrete sentence, e.g. "Skip — posting is on-site in
London, UK, outside US/Canada/India and not remote." or "Skip — listing says
the position has been filled / closed." Never "good fit" / "see JD" / mention
sponsorship or role.

WORKED EXAMPLES — study these; they define the boundary precisely. This block
is identical on every request (the variable posting comes in the user message),
so judge consistently with it:

Example 1 — KEEP. JD: "Software Engineer · Austin, TX (Hybrid)." Austin is in
the United States. → {"pick":true,"score":90,"reason":"Role is in Austin, TX (US).","skipKind":""}

Example 2 — KEEP. JD: "Remote (United States)." US remote is allowed. →
{"pick":true,"score":90,"reason":"Remote US role.","skipKind":""}

Example 3 — KEEP. JD: "Data Analyst · Toronto, Ontario, Canada." Canada is
allowed. → {"pick":true,"score":88,"reason":"Toronto, Canada is allowed.","skipKind":""}

Example 4 — KEEP. JD: "Business Analyst · Bengaluru, India." India is allowed.
→ {"pick":true,"score":88,"reason":"Bengaluru, India is allowed.","skipKind":""}

Example 5 — KEEP. JD lists only responsibilities and requirements; no city,
state, or country appears anywhere. Missing location → KEEP. →
{"pick":true,"score":80,"reason":"No location stated; defaulting to keep.","skipKind":""}

Example 6 — FLAG. JD: "Marketing Manager — London, United Kingdom. On-site, no
remote." UK, on-site, outside US/Canada/India. →
{"pick":false,"score":20,"reason":"On-site in London, UK, outside US/Canada/India and not remote.","skipKind":"location-mismatch"}

Example 7 — KEEP. JD: "Operations Analyst · London, Ontario, Canada." Here
"London" is the Canadian city — Canada is allowed. →
{"pick":true,"score":88,"reason":"London, Ontario is in Canada.","skipKind":""}

Example 8 — FLAG. JD body: "This position has been filled and is no longer
accepting applications." Clearly closed. →
{"pick":false,"score":10,"reason":"Posting is filled / no longer accepting applications.","skipKind":"threshold"}

Example 9 — KEEP. JD says "our global offices span London, Singapore and New
York" in company boilerplate, but the ROLE's stated location is "Chicago, IL".
Judge the ROLE location, not boilerplate city mentions. →
{"pick":true,"score":85,"reason":"Role is in Chicago, IL; other cities are company boilerplate.","skipKind":""}

Example 10 — KEEP. JD: "Remote — must be authorized to work in the US." Remote
+ US authorization → allowed. →
{"pick":true,"score":88,"reason":"Remote US-authorized role.","skipKind":""}

Example 11 — FLAG. JD: "Standort: Berlin, Deutschland. Vor Ort." Germany,
on-site, outside the allow-list. →
{"pick":false,"score":18,"reason":"On-site in Berlin, Germany, outside US/Canada/India.","skipKind":"location-mismatch"}

Example 12 — KEEP. JD: "Hybrid · New York, NY or Remote." US hybrid/remote. →
{"pick":true,"score":90,"reason":"Hybrid/remote in New York, NY (US).","skipKind":""}

Example 13 — KEEP. today="2026-07-09", staleAfterDays=60. JD header: "Posted 07
July 2026." That is 2 days before today — a current posting. The date alone
never means closed. →
{"pick":true,"score":88,"reason":"Posted 07 July 2026, two days ago — still open.","skipKind":""}

Example 14 — FLAG. today="2026-07-09", staleAfterDays=60. JD header: "Date
posted: 30 January 2024." That is far more than 60 days before today. →
{"pick":false,"score":15,"reason":"Posted 30 January 2024, over two years before today — the listing is stale/expired.","skipKind":"threshold"}

Example 15 — KEEP. today="2026-07-09". JD carries no posted date and no
open/closed wording anywhere. Missing date → KEEP. →
{"pick":true,"score":80,"reason":"No posted date or closure notice; defaulting to keep.","skipKind":""}

Example 16 — KEEP. today="2026-07-09". JD header: "Posted 12 December 2026" (a
date AFTER today, e.g. a site bug or timezone artifact). A future date is not
an expired posting. →
{"pick":true,"score":80,"reason":"Posted date is not in the past; treating the listing as open.","skipKind":""}

Example 17 — KEEP. today="2026-07-10", staleAfterDays=60. title="Cloud
Engineer", company="Manulife". JD: "Cloud Engineer · Available in 2 locations ·
Posted Date: June 17th 2026 · Hybrid" followed by "Recommended Jobs — Analyst,
London UK, posted 2 January 2024". June 17 2026 is 23 days before today, and the
London card plus its old date belong to a DIFFERENT job in a recommended rail. →
{"pick":true,"score":88,"reason":"Posted 17 June 2026, 23 days ago; the London listing is a recommended-jobs card, not this role.","skipKind":""}

Default whenever the evidence is thin, mixed, or ambiguous: KEEP (pick=true).`;

// fmtList — normalize a roles/locations field into clean, individual entries.
// The value may be: a plain delimited string, a proper array of clean entries,
// OR an array whose elements are themselves comma/slash/pipe-joined strings
// (some save paths store the whole list in a single element). We flatten AND
// split every element so the grader always sees distinct roles. Without this, a
// single "Process Engineer, Equipment Engineer, ..." element looks like ONE
// giant role and the model wrongly reports "no preferred roles match" (score 0).
function fmtList(v) {
    const items = Array.isArray(v) ? v : (typeof v === 'string' ? [v] : []);
    const out = [];
    for (const item of items) {
        if (typeof item !== 'string') continue;
        for (const piece of item.split(/\s*[/|,]\s*|\s{2,}/)) {
            const t = piece.trim();
            if (t) out.push(t);
        }
    }
    return out;
}

// directRoleMatch — true when the job title clearly IS one of the candidate's
// preferred roles (ignoring seniority words + punctuation). Used as a
// deterministic safety net: the second judge must never remove a job for a
// "role-mismatch" when its title literally matches a preferred role (guards
// against LLM false-negatives like rejecting "Process Engineer" for a client
// whose preferredRoles include "Process Engineer").
const SENIORITY_RX = /\b(senior|sr|junior|jr|lead|staff|principal|associate|entry|level|intern|i|ii|iii|iv|v)\b/gi;
function normRole(s) {
    return String(s || '')
        .toLowerCase()
        .replace(/[^a-z0-9 ]/g, ' ')
        .replace(SENIORITY_RX, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
export function directRoleMatch(jobTitle, preferredRolesRaw) {
    const title = normRole(jobTitle);
    if (!title) return false;
    for (const r of fmtList(preferredRolesRaw)) {
        const role = normRole(r);
        // Require a qualified role (2+ words) so a bare "Engineer"/"Analyst"
        // can't match every title.
        if (!role || role.split(' ').length < 2) continue;
        if (title === role || title.includes(role) || role.includes(title)) return true;
    }
    return false;
}

// splitRoles — clients sometimes type negative clauses into preferredRoles
// ("Do not add Technician roles", "no QA"). Partition into preferred + excluded
// so the grader can map the latter to skipKind:'role-mismatch'. Mirrors the
// extension's buildUserPrompt → splitRoles and the dashboard BuildAiSummary.
const NEG_LEAD = /^\s*(?:do\s*not|don'?t|no(?:t|pe)?|avoid|exclude|skip|never|reject|hate|dislike|remove|drop|filter\s*out)\s*(?:add|include|consider|show|pick|push|send|want)?\b\s*/i;
const ROLE_NOUNS = /\b(?:roles?|positions?|jobs?|titles?)\b/gi;
function splitRoles(rawList) {
    const preferred = [];
    const excluded = [];
    for (const piece of rawList) {
        const s = String(piece || '').trim();
        if (!s) continue;
        if (s.includes(',') && NEG_LEAD.test(s.split(',').slice(-1)[0].trim())) {
            for (const sub of s.split(/\s*,\s*/)) {
                const t = sub.trim();
                if (!t) continue;
                if (NEG_LEAD.test(t)) {
                    const cleaned = t.replace(NEG_LEAD, '').replace(ROLE_NOUNS, '').trim();
                    if (cleaned) excluded.push(cleaned);
                } else preferred.push(t);
            }
            continue;
        }
        if (NEG_LEAD.test(s)) {
            const cleaned = s.replace(NEG_LEAD, '').replace(ROLE_NOUNS, '').trim();
            if (cleaned) excluded.push(cleaned);
        } else {
            preferred.push(s);
        }
    }
    return { preferred, excluded };
}

// deriveHomeCountry — best-effort home market from preferredLocations + visa.
// The extension uses a richer homeMarkets() helper; here we keep it simple and
// fall back to "US + Canada" so a borderline geo never hard-skips on its own.
function deriveHomeCountry(profile) {
    const hay = [
        ...fmtList(profile?.preferredLocations),
        String(profile?.visaStatus || ''),
        String(profile?.usWorkEligibility || ''),
    ].join(' ').toLowerCase();
    const ca = /\b(canada|canadian|toronto|ontario|vancouver|montreal|calgary|ottawa|quebec|alberta|\bca\b)\b/.test(hay);
    const us = /\b(united states|usa|u\.s\.|\bus\b|citizen|green card|h1b|opt|cpt|f1)\b/.test(hay) ||
        /\b(new york|california|texas|seattle|boston|chicago|remote)\b/.test(hay);
    if (ca && !us) return 'Canada';
    if (us && !ca) return 'US';
    return 'US + Canada';
}

// extractRelevantJd — slim the full scraped page text down to the
// location/freshness evidence the second stage actually grades on (#4). Keeps a
// header window (location is normally near the top) plus any later line that
// carries a location / date / open-or-closed keyword. Short pages pass through
// untouched. Bounds input to MAX_JD_CHARS so a single call stays cheap.
const MAX_JD_CHARS = 3500;
const HEAD_CHARS = 1600;
const JD_SIGNAL_RX = /(locat|remote|hybrid|on-?site|relocat|\bcity\b|\bstate\b|province|country|headquarter|office|posted|date|deadline|closing|closed|expired|no longer|filled|accepting application|united states|\busa\b|canada|india|united kingdom|\buk\b|london|germany|france|singapore|australia|dubai|emea|apac|europe)/i;
function extractRelevantJd(scrapedText) {
    const full = String(scrapedText || '');
    if (full.length <= MAX_JD_CHARS) return full;
    const head = full.slice(0, HEAD_CHARS);
    const picked = [];
    let used = head.length;
    for (const raw of full.slice(HEAD_CHARS).split('\n')) {
        const line = raw.trim();
        if (!line || !JD_SIGNAL_RX.test(line)) continue;
        if (used + line.length + 1 > MAX_JD_CHARS) break;
        picked.push(line);
        used += line.length + 1;
    }
    return picked.length ? `${head}\n…\n${picked.join('\n')}` : head;
}

export function buildSecondJudgeUserPrompt({ profile, job, scrapedText, threshold, todayISO, staleAfterDays }) {
    // LOCATION + FRESHNESS only — give the grader just the location signals it
    // needs. Deliberately NO role/sponsorship/excluded fields (stage one owns
    // role; sponsorship is unreliable from scraped text) so the model can't be
    // tempted to re-judge them.
    const preferredLocations = fmtList(profile?.preferredLocations);
    const locationSignals = {
        preferredLocations: preferredLocations.length ? preferredLocations : '(not specified)',
        homeCountry: deriveHomeCountry(profile),
    };
    const signalsBlock = `## Candidate location (AUTHORITATIVE for the location check)\n${JSON.stringify(locationSignals, null, 2)}\n`;

    // Real-site JD — trimmed to the location/freshness evidence (#4). This
    // stage judges ONLY location + open/closed, so we don't need the whole
    // posting body. Keep the header (location usually sits near the top) plus
    // every line carrying a location / date / open-or-closed signal. Cuts input
    // from ~8000 chars to ≤3500 with no loss of the evidence the grader uses.
    const jd = extractRelevantJd(scrapedText);
    const slim = {
        title: job?.jobTitle || '',
        company: job?.companyName || '',
        location: job?.jobLocation || '',
        jdSource: 'full',
        jd,
    };

    // The model has no reliable notion of "now" (its own sense of the current
    // date lags its training data), so the freshness check MUST be anchored to a
    // date we supply. Without this it reads a recent posted date as a strange
    // future date and calls a live posting "closed/expired".
    const today = todayISO || new Date().toISOString().slice(0, 10);
    const staleDays = Number.isFinite(Number(staleAfterDays)) ? Number(staleAfterDays) : 60;

    return `Threshold: ${threshold}
today: ${today}
staleAfterDays: ${staleDays}

${signalsBlock}
## Job to judge (real employer-site text — return ONE decision):
${JSON.stringify(slim, null, 2)}`;
}
