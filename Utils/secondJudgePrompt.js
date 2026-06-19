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

1) LOCATION — be LENIENT. Remove ONLY when the posting clearly states a
   CONCRETE location in a DIFFERENT COUNTRY or region from the candidate's home
   market (homeCountry / preferredLocations) AND the role is not remote for the
   candidate's region — e.g. candidate's market is the US and the job is on-site
   in India / the UK / Canada-only.
   KEEP (pick=true) in ALL of these cases — do NOT skip:
     • the posting does NOT state a clear location, or it's unclear whether it
       is remote or on-site → KEEP. NEVER skip for "no location provided" or
       "unclear whether remote".
     • the location is in the candidate's home country, even if it's a city
       they didn't explicitly list, or it's on-site while they prefer remote.
     • the role is remote, hybrid, or location-flexible.
   Only a clearly stated, clearly foreign / out-of-region location is a
   location-mismatch. When in doubt about location, KEEP.

2) STILL ACCEPTING APPLICATIONS? — do NOT judge the posting's age. Remove ONLY
   when the posting EXPLICITLY states it is closed / expired / filled / "no
   longer accepting applications" / "this position is no longer available" →
   pick=false, skipKind="threshold".
   CRITICAL: the posting's AGE or posted DATE is IRRELEVANT. NEVER remove a job
   for being "older than 24 hours", "posted N days ago", or because a posted
   date looks like yesterday/an earlier day (dates can be off by a day due to
   timezones). A job posted days or weeks ago is perfectly fine as long as it
   is still open. Do NOT compute or infer staleness from any date. If the
   open/closed status is missing or unclear, KEEP.

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

DECISION: default to pick=true (KEEP). Set pick=false ONLY for a clear LOCATION
mismatch (different country/region, not remote) or a posting that EXPLICITLY
says it is closed/no-longer-accepting. Never remove for posting age/date. When
unsure, KEEP.

Return STRICT JSON only — no prose, no markdown:
{"pick":<true|false>,"score":<0-100>,"reason":"<one short sentence naming the reason>","skipKind":"<location-mismatch|threshold|''>"}

skipKind is '' when pick=true.

SCORING (0-100): location fit + still-open status ONLY (NOT posting age). A
clean keep is 80-95; a clear location mismatch or an explicitly closed posting
scores low.

REASON QUALITY — ONE concrete sentence, e.g. "Skip — posting is Bengaluru,
India, outside the candidate's US locations and not remote-US." or "Skip —
listing says the position has been filled / closed." Never "good fit" / "see
JD" / mention sponsorship.`;

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

export function buildSecondJudgeUserPrompt({ profile, job, scrapedText, threshold }) {
    const rolesRaw = fmtList(profile?.preferredRoles);
    const { preferred: preferredRoles, excluded: excludedRoles } = splitRoles(rolesRaw);
    const preferredLocations = fmtList(profile?.preferredLocations);

    const hardSignals = {
        preferredRoles: preferredRoles.length ? preferredRoles : '(not specified — fall back to summary)',
        excludedRoles: excludedRoles.length ? excludedRoles : [],
        experienceLevel: profile?.experienceLevel || '(not specified)',
        preferredLocations: preferredLocations.length ? preferredLocations : '(not specified)',
        workAuth: profile?.usWorkEligibility || profile?.visaStatus || '(not specified)',
        homeCountry: deriveHomeCountry(profile),
        excludedCompanies: profile?.excludedCompanies || profile?.removedCompanies || [],
    };
    const hardSignalsBlock = `## Candidate hard signals (AUTHORITATIVE — quote these exact role strings in your reason)\n${JSON.stringify(hardSignals, null, 2)}\n`;

    const aiSummary = profile?.aiSummary && String(profile.aiSummary).trim();
    const intentBlock = aiSummary
        ? `## Candidate brief (use for nuance — but hard signals above win on conflict):\n${aiSummary}\n`
        : `## Candidate raw profile (no AI summary built yet):\n${JSON.stringify({
              targetCompanies: profile?.targetCompanies || '',
          }, null, 2)}\n`;

    // Real-site JD. Trim to keep token cost bounded — gpt-4o-mini priced at
    // ~$0.15/1M input, so a single 8000-char posting is well under a cent.
    const MAX_JD_CHARS = 8000;
    const jd = String(scrapedText || '').slice(0, MAX_JD_CHARS);
    const slim = {
        title: job?.jobTitle || '',
        company: job?.companyName || '',
        location: job?.jobLocation || '',
        jdSource: 'full',
        jd,
    };

    return `Threshold: ${threshold}

${hardSignalsBlock}
${intentBlock}
## Job to judge (real employer-site text — return ONE decision):
${JSON.stringify(slim, null, 2)}`;
}
