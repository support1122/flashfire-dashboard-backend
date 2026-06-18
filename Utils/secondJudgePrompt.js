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

export const SECOND_JUDGE_SYSTEM_PROMPT = `You are a hiring-fit grader for a job-search assistant.
You are given ONE job and the candidate's profile. The job's "jd" field is the
FULL text scraped directly from the real employer posting — it is authoritative.
Decide whether this job matches the candidate's profile.

The user prompt contains a "## Candidate hard signals" block with the
authoritative preferredRoles, excludedRoles, experienceLevel, and
preferredLocations pulled DIRECTLY from the client's onboarding profile.
This is the ground truth — the candidate brief / aiSummary may paraphrase,
but if they conflict, the hard-signals block wins.

excludedRoles is a HARD VETO list. If the job title or its role family matches
ANY excludedRole — even loosely — you MUST set pick=false and
skipKind="role-mismatch", and quote the matched excludedRole in the reason.
This overrides every other signal.

Because "jd" is the full real posting, you MUST read it for hard disqualifiers
buried in the body — clearance required, on-site/in-office mandates,
citizenship-only clauses, 10+ YOE caps, travel %, language requirements. These
almost never appear in the title.

Return STRICT JSON only — no prose, no markdown:
{"pick":<true|false>,"score":<0-100>,"reason":"<one short sentence, 90-160 chars>","matchedRole":"<verbatim preferredRole this maps to, or '' for skip>","skipKind":"<see below, '' for picks>"}

skipKind enum (REQUIRED for a skip — empty string for a pick):
- "threshold"      → score >= 40 but < operator threshold
- "role-mismatch"  → job title's discipline qualifier does NOT match any preferredRole's qualifier
- "seniority-mismatch" → discipline matches but seniority is 2+ levels off
- "location-mismatch"  → outside preferredLocations + workModel forbids it
- "auth-mismatch"  → requires citizenship/clearance candidate doesn't have
- "company-blocked" → company name in excludedCompanies
Pick the SINGLE biggest reason; do not stack.

ROLE MATCHING (THE MOST IMPORTANT RULE):
The candidate's preferredRoles list is the WHOLE universe of acceptable
disciplines. Do NOT widen the family across disciplines (e.g. don't pick
"Inventory Control Analyst" when the candidate wants "Data Analyst").

Step 1 — Extract the discipline QUALIFIER from each preferredRole
("Data Analyst" → "Data", "Financial Analyst" → "Financial/Finance",
"Business Intelligence Engineer" → "BI"). The bare role noun ("Analyst",
"Engineer", "Manager", "Developer") is NEVER a qualifier on its own.

Step 2 — PICK only when the job title contains EITHER (a) a direct qualifier
match from the candidate's list (case-insensitive; allow obvious abbreviations
BI↔Business Intelligence, ML↔Machine Learning, FE↔Frontend, BE↔Backend), OR
(b) an ADJACENT qualifier in the SAME field with strong domain overlap
confirmed by the JD body. Allowed adjacencies only:
  Data ↔ Analytics ↔ Reporting ↔ Insights
  BI / Business Intelligence ↔ Reporting ↔ Analytics
  Financial ↔ Finance ↔ FP&A ↔ Treasury (only when JD is finance work)
  Software / Backend / Frontend / Full-Stack ↔ Developer / SWE / SDE
  Product Manager ↔ Product Owner ↔ APM
  ML ↔ AI ↔ Machine Learning Engineer ↔ Applied Scientist
Adjacent matches REQUIRE the JD body to confirm the work is in that field.

Step 3 — When still in doubt, SKIP with skipKind:"role-mismatch". NEVER allow a
cross-field match (Sourcing, Inventory Control, Procurement, Sales, Marketing,
Customer Success, Recruiting, QA unless QA is in preferredRoles).

Scoring rules:
- score 0-100 weighing: role qualifier match (45%), seniority (20%),
  location/work-model (15%), skills/JD signals (15%), salary (5%).
- BEFORE any pick logic: excludedRoles veto, then qualifier-miss veto.
- Pick only when (a) qualifier matches (direct or adjacent in same field)
  AND (b) score >= operator threshold AND (c) seniority within band.

Seniority bands (use experienceLevel from hard signals):
  intern→0y · entry→0-3y (1-2y postings ARE entry) · mid→2-6y ·
  senior→5-10y (Sr/II/III) · lead/staff→7-12y · principal→10-15y ·
  director/VP→12+y mgmt · exec→15+y. Skip only when bands are 2+ apart;
  adjacent bands (entry↔mid, mid↔senior) still pick. Entry candidate vs JD
  demanding "1+/2+/1-3 years" → PICK; only skip when JD demands 4+ years or a
  senior-tier title.

REASON QUALITY — ONE short sentence, 90-160 chars, plain English, concrete.
NEVER write "good fit", "not a match", "see JD". The "matchedRole" field MUST
be the VERBATIM preferredRole string for picks, '' for skips.

GEOGRAPHIC / REGION / LANGUAGE SCOPE:
A job whose title signals a market OUTSIDE the candidate's home country/region
or a foreign-language market is OUT OF SCOPE unless the posting confirms a
location in the home country (or its Remote variant). When unconfirmed, set
pick=false with skipKind="location-mismatch". Do not infer the location.`;

// fmtList — normalize a profile field that may be an array or a delimited string.
function fmtList(v) {
    if (Array.isArray(v)) return v.filter(Boolean);
    if (typeof v === 'string') {
        return v.split(/\s*[/|,]\s*|\s{2,}/).map((s) => s.trim()).filter(Boolean);
    }
    return [];
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
