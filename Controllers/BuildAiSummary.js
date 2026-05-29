// BuildAiSummary: server-side candidate brief builder.
//
// Input  : POST /build-ai-summary  { email }
// Output : { success, aiSummary, wordCount, source, model, builtAt }
//
// Flow:
//   1. Validate env (OPENAI_API_KEY, RESUME_API_URL).
//   2. Load client profile from Mongo.
//   3. Fetch parsed resume from gemini-resume backend (best-effort —
//      profile-only fallback if missing).
//   4. Call OpenAI chat.completions (gpt-4o-mini) with the structured
//      "candidate brief" prompt below.
//   5. Persist aiSummary + aiSummaryMeta on the profile document.
//   6. Return the new summary.
//
// All network IO uses axios. Failures return the precise step + status
// + body snippet so the JR-direct extension can show meaningful errors
// instead of a generic "no detail".

import axios from "axios";
import { ProfileModel } from "../Schema_Models/ProfileModel.js";
import { getAppSettings } from "../Schema_Models/AppSettings.js";
import { mergeOverlay, mergeWithLocks, countOverlayBullets, parseSections, extractProvenance } from "../Utils/summaryOverlay.js";

const RESUME_API_URL = process.env.RESUME_API_URL || "http://localhost:5000";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
// Summary builds use gpt-4o-mini exclusively. Gemini path removed after it
// repeatedly miscategorised operator-notes directives. To restore Gemini,
// revert this commit — do not add an env switch back; the routing rules
// in the prompt are tuned for gpt-4o-mini's instruction-following.
const MAX_SUMMARY_CHARS = 8000;

const SYSTEM_PROMPT = `You write a single candidate brief that an automated job-fit grader reads
on every job. The grader trusts this brief verbatim — every claim you make
will be cited back as a pick or skip reason.

# Core rules (apply to every section)
1. Ground every line in the onboarding profile or parsed resume. If a fact
   is missing from BOTH, write "not specified" — never guess, never infer.
2. Quote profile strings VERBATIM where the section instructs. The grader
   pattern-matches on these literals; paraphrasing breaks pick reasons.
3. No marketing language. No filler adjectives ("strong communicator",
   "fast learner", "passionate"). Every sentence carries a fact.
4. Total length: 380–500 words. Plain text. Markdown limited to # headers
   and - bullets. No bold, italics, tables, or code fences.
5. Use these EXACT section headers in this EXACT order. Do not rename, do
   not skip, do not add new sections.
6. PROVENANCE MARKERS — at the END of every bullet line AND every prose
   sentence under # Candidate Summary, append exactly ONE of these tags:
     [R]  — fact comes from the parsed resume
     [P]  — fact comes from the onboarding profile
     [RP] — both sources confirm
     [I]  — inferred from the inputs (no single source cites it directly)
   Example: "- Python — 5 years building data pipelines [R]"
   Example: "- Locations accepted: NYC, Remote [P]"
   Example: "- Seniority band: senior [RP]"
   The 48-hour age bullet under Hard Disqualifiers + every Employment-type
   bullet from the rules block get [P] (those come from operator config).
   If a resume was NOT provided (the input section is "(no resume found...)"),
   every line must be [P] or [I] — never [R] or [RP].
   These markers are stripped by the server before the brief is persisted.
   Their only job is to drive the UI's per-bullet color coding so the
   operator can see at a glance which facts came from where.
7. TERMINOLOGY: the verb "scrap" in operator notes or profile fields means
   SCRAPE = APPLY TO = TARGET a job. It is POSITIVE. It does NOT mean discard
   or exclude. Only a negation ("do not scrap", "don't scrap", "never scrap")
   turns it into an exclusion. A role the operator says to "scrap" is WANTED
   and must never be placed in Hard Disqualifiers as excluded.

# Candidate Summary
2–3 sentences. State: current title, total years of experience, primary
discipline (e.g. "back-end distributed-systems engineer", "pediatric
oncology nurse", "commercial real-estate paralegal"). Cite specifics from
the resume (last role + company + duration if available).

# Target Roles
Line 1 (always present): "Preferred roles (verbatim from profile): " followed
by every POSITIVE entry from profile.preferredRoles, comma-separated, copied
character-for-character. Do not rename "BE" to "Backend Engineer". Do not
collapse duplicates. Do not reorder.

Line 2 (only if profile.preferredRoles contains negative clauses like
"Do not add Technician roles", "no QA", "exclude manager positions"):
"Excluded roles (verbatim from profile, do NOT pick these): " followed by
the cleaned excluded role names verbatim, comma-separated. Omit this line
entirely when no negative clauses exist.

Then a bullet list grouping same-family roles on one line
(e.g. "Software Engineer / Backend Engineer / Platform Engineer"). One
bullet per family.

Final bullet: seniority band — one of intern | entry | mid | senior | lead | exec.
Derive from experienceLevel + resume YOE.

# Hard Constraints
- Locations: list cities + remote/hybrid policy. If profile says remote-only,
  say so. If onsite-only in specific cities, list them.
- Work authorisation: one short clause (e.g. "US Citizen", "H1B — on F1
  OPT until 2027", "Green Card holder", "Needs sponsorship now").
- Salary floor: USD figure if the profile states one. Else "not specified".
- Excluded industries / company stages: only if profile names them.
- Employment types: copy the EXACT wording supplied in the "Employment type
  rules" block in the user prompt. That block enumerates Full-time /
  Part-time / Contract / Internship as ACCEPT or REJECT and gives the exact
  sentence to use for each. Do NOT add a skip bullet for any type marked
  ACCEPT. Do NOT omit the skip bullet for any type marked REJECT.

# Strong Signals (auto-PICK if matched)
Bullets of keywords, role titles, technologies, certifications, or
industries that, when seen on a job posting, indicate a strong fit. Pull
from the resume (skills, recent titles, projects) and from profile
preferences. Each bullet is one short phrase, not a sentence.

# Hard Disqualifiers (auto-SKIP if matched)
ABSOLUTE RULE: every bullet here MUST trace to an EXPLICIT signal in the
inputs (Excluded roles line, profile field that names an industry to skip,
profile-stated lack of clearance, employment-type marked REJECT, etc.).
Never infer a disqualifier. Never add "candidate explicitly opted out" for
any role that appears in the Preferred (positive) line — that would
contradict the candidate.

Permitted bullet sources (in priority order):
1. The "Excluded (negative)" line in the role classifier — emit ONE bullet
   per excluded role using the exact candidate wording. Example:
   "Technician roles — candidate explicitly opted out". If the Excluded
   line is "(none)", emit ZERO role-level disqualifier bullets. Do not
   invent any.
2. Employment-type REJECT bullets from the Employment type rules block —
   use the supplied wording verbatim.
3. Work-authorisation gaps the profile names (e.g. profile says "needs
   sponsorship" → "US citizen only — candidate needs sponsorship";
   profile says "no clearance" → "Active US security clearance required").
4. Industries or companies the profile explicitly tells us to exclude.
5. Operator-notes directives routed here per the OPERATOR NOTES block:
   explicit "do not scrap"/exclusion bullets, AND the whitelist catch-all
   bullet ("All roles other than X — skip ...") when the operator said to
   "scrap only X". Never place a whitelisted/targeted role X itself here.
6. ALWAYS include this exact bullet verbatim, for every candidate, no
   exceptions: "Job posting age — skip any job posted more than 48 hours
   ago. Only postings from the last 48 hours are in scope."

Do NOT add: seniority-mismatch bullets, role variants the profile didn't
exclude, industries the profile didn't call out, or any speculative skip
reason. If there is no signal, there is no bullet.

# Notes for Grader
2–4 sentences of nuance on how to weight conflicts. Examples: "Role family
trumps title cosmetics — pick 'Software Developer' even when preferred says
'Software Engineer'." / "Location flexibility: candidate prefers NYC but
will take remote anywhere in US." / "Seniority cap: open to APM and PM but
not Director — too senior." Be specific to THIS candidate — no generic
guidance.`;

// Fields that materially affect the summary's grader-facing content. We
// snapshot only these (not the entire mongo doc) so the diff is small,
// readable, and stable across schema additions.
const SNAPSHOT_FIELDS = [
  "preferredRoles",
  "preferredLocations",
  "experienceLevel",
  "visaStatus",
  "usWorkEligibility",
  "employmentTypes",
  "targetCompanies",
  "excludedCompanies",
  "removedCompanies",
  "salaryExpectation",
  "currentTitle",
  "yearsOfExperience",
  "industriesOfInterest",
  "willingToRelocate",
  "workAuthorization",
];

// splitPreferredRoles: clients sometimes type negative clauses INTO the
// preferredRoles field ("Do not add Technician roles", "no QA", "exclude
// manager positions"). Treat them as exclusions, not preferences. Splits
// each entry on common comma boundaries first so a single mixed string
// like "Backend Engineer, no QA" still partitions cleanly.
const NEG_LEAD_RE = /^\s*(?:do\s*not|don'?t|no(?:t|pe)?|avoid|exclude|skip|never|reject|hate|dislike|remove|drop|filter\s*out)\s*(?:add|include|consider|show|pick|push|send|want)?\b\s*/i;
const ROLE_NOUN_RE = /\b(?:roles?|positions?|jobs?|titles?)\b/gi;
function splitPreferredRoles(input) {
  const preferred = [];
  const excluded = [];
  const raw = Array.isArray(input)
    ? input
    : typeof input === "string"
      ? input.split(/\s*[/|,]\s*|\s{2,}/)
      : [];
  // Second pass: each array entry can itself contain a comma (e.g.
  // "Backend Engineer, no QA"). Re-split when a negative marker shows
  // up after a comma so we don't lose the positive prefix.
  const exploded = [];
  for (const r of raw) {
    const s = String(r || "").trim();
    if (!s) continue;
    if (s.includes(",") && NEG_LEAD_RE.test(s.split(",").slice(-1)[0].trim())) {
      for (const piece of s.split(/\s*,\s*/)) exploded.push(piece);
    } else {
      exploded.push(s);
    }
  }
  for (const piece of exploded) {
    const s = String(piece || "").trim();
    if (!s) continue;
    const m = s.match(NEG_LEAD_RE);
    if (m) {
      const cleaned = s.replace(NEG_LEAD_RE, "").replace(ROLE_NOUN_RE, "").trim();
      if (cleaned) excluded.push(cleaned);
    } else {
      preferred.push(s);
    }
  }
  return { preferred, excluded };
}

function snapshotProfile(profile) {
  if (!profile) return {};
  const snap = {};
  for (const k of SNAPSHOT_FIELDS) {
    if (profile[k] !== undefined) snap[k] = profile[k];
  }
  return snap;
}

// normaliseFieldValue: turns scalars + slash/comma/pipe-separated strings +
// arrays into a sorted unique list of strings. Lets the diff compare
// "Backend Engineer / Platform Engineer" (string from older profile) with
// ["Backend Engineer","Platform Engineer"] (array from newer UI) and report
// no change instead of false-positive churn.
function normaliseFieldValue(v) {
  if (v == null || v === "") return [];
  if (Array.isArray(v)) return [...new Set(v.map(String).map((s) => s.trim()).filter(Boolean))].sort();
  if (typeof v === "object") return [JSON.stringify(v)];
  const s = String(v);
  if (/[/|,]/.test(s) || /\s{2,}/.test(s)) {
    return [...new Set(s.split(/\s*[/|,]\s*|\s{2,}/).map((p) => p.trim()).filter(Boolean))].sort();
  }
  return [s.trim()];
}

// computeProfileDiff: returns a structured human-readable diff between the
// snapshot stored at last summary build and the current profile state. Empty
// arrays for unchanged fields. The downstream prompt block converts this
// into explicit ADD/REMOVE bullets so the model can't gloss over edits.
function computeProfileDiff(prevSnapshot, current) {
  const prev = prevSnapshot || {};
  const cur = current || {};
  const changes = [];
  for (const field of SNAPSHOT_FIELDS) {
    const before = normaliseFieldValue(prev[field]);
    const after = normaliseFieldValue(cur[field]);
    if (before.length === 0 && after.length === 0) continue;
    const added = after.filter((v) => !before.includes(v));
    const removed = before.filter((v) => !after.includes(v));
    if (added.length === 0 && removed.length === 0) continue;
    changes.push({ field, before, after, added, removed });
  }
  return changes;
}

function renderDiffBlock(changes) {
  if (!changes.length) return "(no field-level changes detected — refresh wording only if the existing summary is internally inconsistent)";
  return changes
    .map((c) => {
      const lines = [`### ${c.field}`];
      if (c.removed.length) lines.push(`  REMOVED: ${c.removed.map((v) => `"${v}"`).join(", ")}`);
      if (c.added.length)   lines.push(`  ADDED:   ${c.added.map((v) => `"${v}"`).join(", ")}`);
      lines.push(`  Before: ${c.before.length ? c.before.map((v) => `"${v}"`).join(", ") : "(empty)"}`);
      lines.push(`  After:  ${c.after.length ? c.after.map((v) => `"${v}"`).join(", ") : "(empty)"}`);
      return lines.join("\n");
    })
    .join("\n\n");
}

// renderLockedSectionsBlock: extract the operator-locked sections from the
// saved overlay text + emit a "DO NOT REGENERATE" block. The merge layer
// will overwrite these sections post-output regardless, but telling the
// model up-front keeps surrounding sections consistent (avoids the model
// claiming "Senior" elsewhere when the locked Target Roles says "Mid").
function renderLockedSectionsBlock(overlay) {
    if (!overlay?.enabled || !overlay.savedText || !Array.isArray(overlay.lockedSections) || !overlay.lockedSections.length) {
        return "";
    }
    const parsed = parseSections(overlay.savedText);
    const blocks = [];
    for (const header of overlay.lockedSections) {
        const sec = parsed.sections[header];
        if (!sec) continue;
        const lines = [];
        if (sec.prose.length) lines.push(sec.prose.join("\n").replace(/\n{3,}/g, "\n\n").trim());
        for (const b of sec.bullets) lines.push(`- ${b}`);
        const body = lines.join("\n").trim();
        if (body) blocks.push(`### ${header}\n${body}`);
    }
    if (!blocks.length) return "";
    return `\n\n## LOCKED SECTIONS (operator marked these "do not touch" — output the body VERBATIM, character-for-character; do not paraphrase, do not reorder bullets, do not add or remove lines; treat the locked text as authoritative and make sure surrounding sections do not contradict it)
${blocks.join("\n\n")}`;
}

// renderAiNotesBlock: top-priority operator guidance. Sits ABOVE every other
// block in the user prompt so the model treats it as authoritative when
// composing the brief. Empty / missing notes → empty string (no block).
function renderAiNotesBlock(profile) {
    const text = (profile?.aiNotes?.text || "").trim();
    if (!text) return "";
    const when = profile?.aiNotes?.updatedAt
        ? new Date(profile.aiNotes.updatedAt).toISOString().slice(0, 10)
        : "";
    const who = profile?.aiNotes?.updatedBy || "ops";
    return `## OPERATOR NOTES (DIRECTIVES — HIGHEST PRIORITY · ZERO TOLERANCE FOR MISSED ITEMS)
The text below is from the operator (${when}${who ? ` · ${who}` : ""}). These are DIRECTIVES, NOT data to be summarised.

╔═══════════════════════════════════════════════════════════════════════╗
║ TERMINOLOGY — READ FIRST. THIS OVERRIDES YOUR DICTIONARY INTUITION.    ║
║                                                                       ║
║ In this company's jargon, "scrap" means SCRAPE = APPLY TO = TARGET a  ║
║ job. It is a POSITIVE action. It does NOT mean discard, junk, drop,   ║
║ or exclude — ignore the everyday English meaning of the word.         ║
║                                                                       ║
║   "scrap X"               = APPLY TO X   → X is a TARGET / wanted role ║
║   "scrap only X"          = apply to X and NOTHING ELSE (WHITELIST)    ║
║   "strictly scrap only X" = WHITELIST X, skip every other role        ║
║   "also scrap Y"          = add Y to the targets                      ║
║   "prioritise / prefer X" = X is a strong-fit signal                  ║
║                                                                       ║
║   "do NOT scrap X" / "don't scrap X" / "never scrap X" = EXCLUDE X     ║
║   ONLY a NEGATION word (not/don't/never/no/skip/exclude) next to      ║
║   "scrap" flips it to an exclusion. Bare "scrap X" is ALWAYS a target.║
║                                                                       ║
║ FATAL MISTAKE TO AVOID: putting a role the operator told you to       ║
║ "scrap" (i.e. apply to) into Hard Disqualifiers as "excluded". That   ║
║ is the exact OPPOSITE of the instruction. Never do it.                ║
╚═══════════════════════════════════════════════════════════════════════╝

CRITICAL CONTRACT — read before writing anything:
A. Split the notes text into a numbered list of distinct directives in your head. A directive = one sentence or one bullet expressing ONE intent.
B. For each directive, FIRST decide its polarity: is there a negation word (not/don't/never/no/skip/exclude) attached to "scrap"? If NO negation → it is a TARGET/INCLUDE directive. If negation present → it is an EXCLUDE directive. Get polarity right before routing.
C. Every directive MUST produce at least one corresponding bullet in the brief, in the section dictated by the ROUTING RULES below.
D. After writing the brief, walk the directive list a second time and verify each is reflected with the CORRECT polarity. If even one is missing, in the wrong section, or has flipped polarity, REWRITE before output. A flipped or missed directive is a CRITICAL FAILURE.
E. The "— operator priority" suffix is RESERVED for items that come FROM operator notes. Items derived from the resume or profile MUST NOT carry this suffix. Do not blanket-tag every Strong Signal bullet.

ROUTING RULES (apply mechanically — do NOT improvise):

R0. WHITELIST — "scrap only X" / "only scrap X" / "strictly scrap only X" / "scrap X only" / "scrap X exclusively" (X = one or more role titles, NO negation word):
    → This RESTRICTS scope to X. X is WANTED.
    → Target Roles: the bullet list becomes EXACTLY X (the whitelisted roles), replacing/narrowing the family list. Keep the verbatim "Preferred roles (verbatim from profile)" line as-is.
    → Strong Signals: ONE bullet per whitelisted role, "X — operator priority".
    → Hard Disqualifiers: add ONE bullet, exactly: "All roles other than <list of X> — skip (operator restricted scope to <list of X> only per operator note)".
    → ABSOLUTE: NEVER put any whitelisted role X itself into Hard Disqualifiers. The candidate WANTS X. Only the catch-all "all roles other than X" bullet goes there.

R1. NEGATED scrap / explicit exclusion — "Do NOT scrap X" / "don't scrap X" / "never scrap X" / "do not pick X" / "exclude X" / "skip X" / "no X" (negation word REQUIRED):
    → Hard Disqualifiers: ONE bullet per X, exactly "X — excluded per operator note".
    → NEVER include X in Strong Signals or Target Roles.
    → NEVER summarise multiple X's into one bullet; emit one bullet per item.

R2. Priority — "Prioritise X" / "focus on X" / "scrap more X" / "we want X" / "prefer X" (NO negation):
    → Strong Signals: ONE bullet per X, exactly "X — operator priority".
    → NEVER include X in Hard Disqualifiers.

R3. Additive target — "Also scrap Y" / "include Y" / "Y is fine too" / "can scrap Y as well" (NO negation):
    → Target Roles bullet list grows to include Y (when Y is a role title).
    → Strong Signals adds: "Y — operator allows" (when Y is a role/tech/skill).
    → NEVER include Y in Hard Disqualifiers, even if Y looks like an "off-discipline" role.

R4. Company-name exclusions — "do NOT scrap from Acme" / "don't scrap Foo Inc" / "skip Foo Inc" (negation REQUIRED):
    → Hard Disqualifiers: one bullet per company, exactly "<Company> jobs — excluded per operator note".
    → NEVER list these under Hard Constraints "Excluded industries" — companies are not industries.
    → NEVER list these in Strong Signals.
    NOTE: "scrap from Acme" WITHOUT a negation = apply to Acme (priority), NOT an exclusion → Strong Signals "<Company> — operator priority".

R5. Company / industry category exclusions — "do NOT scrap staffing" / "no staffing" / "skip consulting firms" (negation REQUIRED):
    → Hard Disqualifiers: "<Category> companies — excluded per operator note".
    → NEVER as Strong Signals. NEVER as Hard Constraints "Excluded industries" — keep them as their own bullets in Hard Disqualifiers.

R6. Company / industry category priorities — "prioritise H1B sponsors" / "prefer fintech" / "scrap H1B sponsors" (NO negation):
    → Strong Signals: "<Category> — operator priority".
    → NEVER as Hard Disqualifiers.

R7. Operational instructions that are NOT about job content ("scrap 35-40 daily", "build twice a week"):
    → IGNORE — these are workflow instructions, not candidate signals. Do NOT echo them anywhere in the brief. (A bare number/quota next to "scrap" = workflow, not a role.)

R8. The "Notes for Grader" section gets ONLY meta-guidance on how to WEIGH conflicts. NEVER restates the routed directives.

WORKED EXAMPLES (use these for the current candidate too):

Operator note: "strictly scrap only Data Engineer or data analyst positions"
  → POLARITY: no negation → TARGET/WHITELIST (R0). Candidate WANTS these two roles only.
  ✓ Target Roles bullet list MUST be exactly: "Data Engineer", "Data Analyst"
  ✓ Strong Signals MUST contain: "Data Engineer — operator priority", "Data Analyst — operator priority"
  ✓ Hard Disqualifiers MUST contain: "All roles other than Data Engineer / Data Analyst — skip (operator restricted scope to Data Engineer / Data Analyst only per operator note)"
  ✗ Hard Disqualifiers must NOT contain "Data Engineer roles — excluded" or "Data Analyst roles — excluded" — that flips the directive and is a CRITICAL FAILURE

Operator note: "DO NOT scrap at all staffing/consulting companies."
  → POLARITY: "DO NOT" → EXCLUDE (R5).
  ✓ Hard Disqualifiers MUST contain: "Staffing or consulting companies — excluded per operator note"
  ✗ Strong Signals must NOT contain "Staffing/Consulting companies"

Operator note: "Prioritize and scrap companies that provide H1B sponsorship."
  → POLARITY: no negation → PRIORITY (R6).
  ✓ Strong Signals MUST contain: "Companies that sponsor H1B — operator priority"
  ✗ Hard Disqualifiers must NOT contain "Companies that provide H1B sponsorship"

Operator note: "Do not scrap roles from Humana or JP Morgan Chase."
  → POLARITY: "Do not" → EXCLUDE (R4).
  ✓ Hard Disqualifiers MUST contain TWO bullets:
       "Humana jobs — excluded per operator note"
       "JP Morgan Chase jobs — excluded per operator note"
  ✗ A single combined bullet like "Humana and JP Morgan Chase" is NOT acceptable — emit two

Operator note: "Can scrap Data Engineer roles as well."
  → POLARITY: no negation → ADDITIVE TARGET (R3).
  ✓ Target Roles bullet list MUST grow to include "Data Engineer"
  ✓ Strong Signals MUST add: "Data Engineer — operator allows"
  ✗ Hard Disqualifiers must NOT contain "Data Engineer"

Operator note: "Scrap 35-40 Daily"
  → IGNORE — workflow instruction (bare quota), not candidate signal. Do not echo anywhere.

SELF-CHECK BEFORE FINAL OUTPUT (mandatory):
1. List every directive in the notes and tag each with its polarity (TARGET vs EXCLUDE) using the negation-word test from contract step B.
2. For each, locate the section it should land in per the ROUTING RULES.
3. Open your draft and confirm the bullet exists in that section, with the correct suffix ("excluded per operator note" / "operator priority" / "operator allows" / whitelist catch-all).
4. POLARITY AUDIT: for every role/company the operator said to "scrap" (no negation), confirm it appears as a TARGET/priority and does NOT appear as "excluded" anywhere. For every "do not scrap" item, confirm it appears ONLY as excluded. A single flipped item = REWRITE.
5. Confirm no Preferred role appears as a disqualifier. Confirm "— operator priority" / "— operator allows" / "— excluded per operator note" suffixes appear ONLY on notes-derived items.
If any check fails: REWRITE the affected section(s) before outputting.

OPERATOR NOTES TEXT (treat this entire block as the directive source — every sentence is a directive):
${text}

(End of operator notes. Continue with the normal inputs below.)

`;
}

function buildUserPrompt(profile, resume, existingSummary, profileDiff, overlay = null) {
  const profileBlob = JSON.stringify(profile || {}, null, 2).slice(0, 12_000);
  // Split positive vs negative role clauses up-front so the model sees an
  // explicit "EXCLUDED ROLES" block rather than having to detect "Do not
  // add ..." phrasing buried inside the preferredRoles array. Reduces the
  // chance the model lists an excluded role under Target Roles.
  const { preferred: preferredRoles, excluded: excludedRoles } = splitPreferredRoles(profile?.preferredRoles);
  // Employment types — multi-select array from the /profile UI. Default
  // to ["Full-time"] when profile field is missing/empty so legacy clients
  // still surface as full-time-only in the prompt.
  const rawEmp = Array.isArray(profile?.employmentTypes) ? profile.employmentTypes : [];
  const cleanedEmp = rawEmp
    .map((v) => String(v || "").trim())
    .filter((v) => ["Full-time", "Part-time", "Contract", "Internship"].includes(v));
  const employmentTypes = cleanedEmp.length ? cleanedEmp : ["Full-time"];
  const allEmp = ["Full-time", "Part-time", "Contract", "Internship"];
  const excludedEmp = allEmp.filter((t) => !employmentTypes.includes(t));
  // Per-type bullet wording. Each entry is { accept, reject } — the exact
  // line the model must (accept) or must NOT (reject) put in the summary.
  // Generated server-side so the model never has to "decide" what to write
  // for a given type — it just copies the supplied line.
  const EMP_WORDING = {
    "Full-time":  { accept: "Open to full-time roles.",                          reject: "Skip full-time roles." },
    "Part-time":  { accept: "Open to part-time roles.",                          reject: "Skip part-time roles." },
    "Contract":   { accept: "Open to contract / contract-to-hire roles.",        reject: "Skip contract / contract-to-hire roles." },
    "Internship": { accept: "Open to internships.",                              reject: "Skip internships." },
  };
  const empPerType = allEmp.map((t) => {
    const isAccepted = employmentTypes.includes(t);
    const wording = isAccepted ? EMP_WORDING[t].accept : EMP_WORDING[t].reject;
    const section = isAccepted ? "Hard Constraints" : "Hard Disqualifiers";
    return `  - ${t}: ${isAccepted ? "ACCEPT" : "REJECT"} → put "${wording}" under ${section}. Do NOT add any contradictory bullet for ${t} in any other section.`;
  }).join("\n");
  const rolesBlock = `\n\n## Role classifier (AUTHORITATIVE — applies on top of profile.preferredRoles)
Preferred (positive):  ${preferredRoles.length ? preferredRoles.map((r) => `"${r}"`).join(", ") : "(none)"}
Excluded (negative):   ${excludedRoles.length ? excludedRoles.map((r) => `"${r}"`).join(", ") : "(none)"}
Accepted employment types: ${employmentTypes.join(", ")}
Rejected employment types: ${excludedEmp.length ? excludedEmp.join(", ") : "(none — accepts all)"}
Rules:
- Use ONLY the Preferred list on the "Preferred roles (verbatim from profile)" line.
- If the Excluded list is "(none)": OMIT the "Excluded roles" line entirely AND emit ZERO role-level bullets under Hard Disqualifiers. Do not generate any "<Role> — candidate explicitly opted out" bullet. Do not infer exclusions from seniority, role family, or anything else.
- If the Excluded list has entries: render them on the "Excluded roles (verbatim from profile, do NOT pick these)" line and add ONE matching disqualifier bullet per entry, using the candidate's exact wording.
- NEVER include any role from the Preferred list under Hard Disqualifiers, Strong Signals exclusions, or any negative section. Preferred = wanted; emitting a Preferred role as a disqualifier directly contradicts the candidate.

## Employment type rules (AUTHORITATIVE — overrides every other instruction)
For each employment type below, use EXACTLY the wording given. Do not invent
synonyms, do not add "skip" bullets for any ACCEPT type, do not omit "skip"
bullets for any REJECT type:
${empPerType}`;
  const resumeBlob = resume
    ? JSON.stringify(
        {
          personalInfo: resume.personalInfo,
          summary: resume.summary,
          workExperience: resume.workExperience,
          projects: resume.projects,
          skills: resume.skills,
          education: resume.education,
          leadership: resume.leadership,
          publications: resume.publications,
        },
        null,
        2,
      ).slice(0, 16_000)
    : "(no resume found for this candidate — work from profile only)";
  // Diff-aware path: when a previous summary exists and the profile was
  // edited (summaryStale=true), preserve the existing summary's voice +
  // structure and only revise the parts that no longer match the inputs.
  // This avoids OpenAI rewriting tone/wording on every minor profile edit.
  if (existingSummary && existingSummary.trim().length > 100) {
    const diffBlock = renderDiffBlock(profileDiff || []);
    const removedAll = (profileDiff || []).flatMap((c) => c.removed);
    const removalGuard = removedAll.length
      ? `\n\nMANDATORY REMOVALS — these strings MUST NOT appear anywhere in the
updated summary (the candidate explicitly removed them from their profile,
do not infer they still apply, do not list them in any section):
${removedAll.map((v) => `  • "${v}"`).join("\n")}`
      : "";

    // Employment-type flip guard: if a type changed ACCEPT↔REJECT, the
    // existing summary likely still carries the old bullet. The per-type
    // rules block above already states the new wording, but the existing
    // summary is also fed in and can be sticky — call out the flip
    // explicitly so the model strips the contradictory line.
    const empDiff = (profileDiff || []).find((c) => c.field === "employmentTypes");
    let empFlipGuard = "";
    if (empDiff) {
      const flips = [];
      for (const t of empDiff.added) {
        // type became ACCEPTED → any "Skip <t>" bullet must be removed
        flips.push(`  • ${t} is now ACCEPTED — REMOVE any "Skip ${t.toLowerCase()}" / "no ${t.toLowerCase()}" bullet from the existing summary and use ONLY the wording supplied in the Employment type rules block above.`);
      }
      for (const t of empDiff.removed) {
        // type became REJECTED → must add the skip bullet
        flips.push(`  • ${t} is now REJECTED — ENSURE the existing summary contains the Hard Disqualifier wording supplied in the Employment type rules block above for ${t}, and remove any "Open to ${t.toLowerCase()}" / accepting language.`);
      }
      if (flips.length) {
        empFlipGuard = `\n\nEMPLOYMENT TYPE FLIPS (CRITICAL — overrides the existing summary):\n${flips.join("\n")}`;
      }
    }
    const diffPathBody = `## Existing summary (built from a profile snapshot that is now out of date)
${existingSummary.trim().slice(0, 6_000)}

## Field-level diff since last build (AUTHORITATIVE — applies on top of existing summary)
${diffBlock}
${rolesBlock}

## Updated onboarding profile (full current state)
${profileBlob}

## Parsed resume
${resumeBlob}

## Task
Rewrite the existing summary so every section is consistent with the
updated profile. Hard rules:

1. Treat the diff above as authoritative. Every REMOVED value must be
   STRIPPED from the summary even if the existing summary still mentions
   it; every ADDED value must be INCORPORATED into the appropriate
   section (Target Roles, Hard Constraints, Strong Signals, etc.).
2. Preserve voice, tone, and phrasing for sentences that are NOT
   contradicted by the diff. Do not rewrite from scratch.
3. The "Preferred roles (verbatim from profile)" line at the top of
   the Target Roles section must be regenerated from the CURRENT
   preferredRoles list — never reuse the old line.
4. The Hard Constraints "Locations" bullet must list ONLY the current
   preferredLocations. If the diff shows a removed city, that city
   must vanish from the summary entirely.
5. If a field in the diff went from a value to empty, replace the
   relevant bullet with "not specified" rather than leaving the old
   text in place.
6. The Employment type rules block above is AUTHORITATIVE. The existing
   summary may contradict it (e.g. carry a "Skip internships" bullet from
   a previous build). When that happens, the per-type wording in the rules
   block WINS — delete every contradictory line and substitute the
   supplied wording verbatim.${removalGuard}${empFlipGuard}

Output the FULL updated summary in the same format as before — do not
output a diff or a list of changes.${renderLockedSectionsBlock(overlay)}`;
    return `${renderAiNotesBlock(profile)}${diffPathBody}`;
  }
  // Priority order in the prompt body: Notes (rendered above by
  // renderAiNotesBlock) > Resume > Profile. When the resume conflicts with
  // the profile, the resume wins (resume = ground truth of what the
  // candidate actually did; profile = self-reported preferences).
  const freshBody = `## INPUT PRIORITY (for any conflict, higher beats lower)
1. Operator notes (above) — DIRECTIVES, always win
2. Parsed resume (below) — ground truth of actual experience
3. Onboarding profile (below) — self-reported preferences / exclusions / work auth

## Parsed resume (PRIORITY 2 — ground truth of experience; cite YOE, titles, companies, skills from here)
${resumeBlob}

## Onboarding profile (PRIORITY 3 — preference signals; use for preferredRoles, preferredLocations, work auth, target/excluded companies)
${profileBlob}
${rolesBlock}${renderLockedSectionsBlock(overlay)}`;
  return `${renderAiNotesBlock(profile)}${freshBody}`;
}

async function fetchResume(email) {
  try {
    const res = await axios.post(
      `${RESUME_API_URL}/api/resume-by-email`,
      { email },
      { timeout: 15_000, headers: { "content-type": "application/json" } },
    );
    return { ok: true, resume: res.data };
  } catch (err) {
    const status = err.response?.status;
    if (status === 404) {
      return { ok: false, error: "NO_RESUME", message: err.response?.data?.error || "no resume assigned" };
    }
    return {
      ok: false,
      error: status ? `HTTP_${status}` : "NETWORK",
      message: err.response?.data?.error || err.message,
    };
  }
}

// SUMMARY_TEMPERATURE — tuned for the structured-brief task. 0.05 (near
// greedy decoding) is required to make the operator-notes routing rules
// stick: at 0.15 the model occasionally dropped a "do not scrap from <co>"
// directive or mis-suffixed Strong Signals. Lower temp = stricter prompt
// adherence at the cost of slightly more repetitive phrasing — acceptable
// because the brief is read by a grader, not a human reader.
const SUMMARY_TEMPERATURE = Number.isFinite(Number(process.env.FF_SUMMARY_TEMPERATURE))
  ? Number(process.env.FF_SUMMARY_TEMPERATURE)
  : 0.05;

async function callOpenAI(profile, resume, existingSummary, profileDiff, apiKey, overlay = null) {
  const body = {
    model: OPENAI_MODEL,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(profile, resume, existingSummary, profileDiff, overlay) },
    ],
    temperature: SUMMARY_TEMPERATURE,
  };
  try {
    const res = await axios.post("https://api.openai.com/v1/chat/completions", body, {
      timeout: 60_000,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey || OPENAI_API_KEY}`,
      },
    });
    const summary = (res.data?.choices?.[0]?.message?.content || "").trim();
    return { ok: true, summary, usage: res.data?.usage || null };
  } catch (err) {
    const status = err.response?.status;
    const detail =
      err.response?.data?.error?.message ||
      (typeof err.response?.data === "string" ? err.response.data : "") ||
      err.message;
    return {
      ok: false,
      error: status ? `OPENAI_${status}` : "OPENAI_NETWORK",
      message: detail.slice(0, 500),
    };
  }
}

// Core build pipeline — no req/res. Returns a { success, ... } object so it
// can be called both from the HTTP handler AND fire-and-forget from profile
// create/update controllers to auto-rebuild summaries.
export async function buildSummaryForEmail(email, reasonTag = "manual") {
  try {
    let effectiveKey = OPENAI_API_KEY;
    if (!effectiveKey) {
      try {
        const settings = await getAppSettings();
        effectiveKey = (settings?.globalOpenaiKey || "").trim();
      } catch (e) {
        console.warn("buildSummaryForEmail global-key load failed:", e.message);
      }
    }
    if (!effectiveKey) {
      return { success: false, status: 503, error: "NO_OPENAI_KEY", message: "OPENAI key not configured", step: "config" };
    }
    if (!email || typeof email !== "string" || !email.includes("@")) {
      return { success: false, status: 400, error: "BAD_INPUT", message: "email is required", step: "validate" };
    }
    const lower = String(email).toLowerCase();
    let profile = await ProfileModel.findOne({ email: lower }).lean();
    if (!profile) {
      profile = await ProfileModel.findOne({
        email: { $regex: new RegExp(`^${escapeRegex(email)}$`, "i") },
      }).lean();
    }
    if (!profile) {
      return { success: false, status: 404, error: "PROFILE_NOT_FOUND", message: `No profile in DB for ${email}`, step: "loading-profile" };
    }
    return await runForProfileCore(profile, effectiveKey, reasonTag);
  } catch (err) {
    console.error("buildSummaryForEmail fatal:", err);
    return { success: false, status: 500, error: "INTERNAL", message: err.message, step: "internal" };
  }
}

export default async function BuildAiSummary(req, res) {
  const { email } = req.body || {};
  const result = await buildSummaryForEmail(email);
  const { status = result.success ? 200 : 500, ...payload } = result;
  return res.status(status).json(payload);
}

function escapeRegex(s) {
  return String(s).replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
}

async function runForProfileCore(profile, apiKey, reasonTag = "manual") {
  const email = profile.email;
  const resumeRes = await fetchResume(email);
  const resume = resumeRes.ok ? resumeRes.resume : null;
  const source = resume ? "profile+resume" : "profile-only";

  // FRESH BUILD EVERY TIME — never feed the previous summary back into the
  // prompt. Old behaviour was diff-aware ("preserve voice, only edit
  // changed fields") which made every rebuild carry stale wording forward.
  // Now every Rebuild starts from scratch using: operator notes (highest)
  // > resume > profile. This is what the operator wants — every change
  // anywhere in those three inputs reflects across the WHOLE summary, not
  // just the diffed bullets.
  const existingSummary = "";
  const profileDiff = [];
  // Track which inputs actually fed this build so the UI can show "Built
  // from: 💬 Notes + 📄 Resume + 👤 Profile" pills + model + temperature.
  const builtInputs = {
    notes: !!(profile?.aiNotes?.text && profile.aiNotes.text.trim()),
    resume: !!resume,
    profile: true,
  };
  // OpenAI gpt-4o-mini is the sole summary builder. Gemini path removed —
  // it repeatedly miscategorised operator-notes directives (excluded
  // companies → Strong Signals, "prioritise H1B" → Hard Disqualifiers).
  // No fallback; if OpenAI fails the build fails loudly so the operator
  // knows to fix the key / retry, instead of silently degrading.
  const overlayForPrompt = profile?.aiSummaryOverlay || null;
  const ai = await callOpenAI(profile, resume, existingSummary, profileDiff, apiKey, overlayForPrompt);
  const usedModel = OPENAI_MODEL;
  let usedSource = `${source}+openai`;
  // Append the trigger origin so the AI Summaries dashboard / logs show whether
  // this build was manual or auto-fired by profile-update / resume-attach /
  // cron-sweep / new-client-create.
  if (reasonTag && reasonTag !== "manual") {
    usedSource = `${usedSource} [auto:${reasonTag}]`;
  } else if (reasonTag === "manual") {
    usedSource = `${usedSource} [manual]`;
  }
  if (!ai.ok) {
    return { success: false, status: 502, error: ai.error, message: ai.message, step: "openai" };
  }
  let summary = (ai.summary || "").slice(0, MAX_SUMMARY_CHARS);
  if (!summary) {
    return { success: false, status: 502, error: "EMPTY_SUMMARY", message: "OpenAI returned empty content", step: "openai" };
  }
  // Strip [R]/[P]/[RP]/[I] markers off every bullet + prose line and build the
  // provenance map BEFORE overlay merging (overlay snapshot has no markers, so
  // we must extract while the AI output is still annotated). cleanText becomes
  // what we persist + merge + ship to the grader. provenance lands on
  // aiSummaryMeta so the UI can colour-tint each line by source.
  const provExtract = extractProvenance(summary, { noResume: !resume });
  summary = provExtract.cleanText;
  let aiProvenance = provExtract.provenance;
  // Apply operator's saved format overlay: if enabled, re-inject any bullets
  // the operator added on top of the previous build + replace any
  // locked-section bodies verbatim. Pure AI output if no overlay or overlay
  // disabled. Trims to MAX_SUMMARY_CHARS after merge so a long overlay can't
  // bust the doc size cap.
  const overlay = profile?.aiSummaryOverlay || {};
  let overlayStats = null;
  let lockCount = 0;
  if (overlay.enabled && overlay.savedText) {
    const locks = Array.isArray(overlay.lockedSections) ? overlay.lockedSections : [];
    lockCount = locks.length;
    const merged = locks.length
      ? mergeWithLocks(summary, overlay.savedText, locks)
      : mergeOverlay(summary, overlay.savedText);
    if (typeof merged === "string" && merged.trim().length) {
      summary = merged.slice(0, MAX_SUMMARY_CHARS);
      overlayStats = countOverlayBullets(overlay.savedText, summary);
      const tagParts = [];
      if (overlayStats.total) tagParts.push(`+overlay:${overlayStats.total}`);
      if (lockCount) tagParts.push(`+locks:${lockCount}`);
      if (tagParts.length) {
        usedSource = `${usedSource} ${tagParts.join(" ")}`;
        console.log(`[BuildAiSummary] overlay applied email=${profile.email} extras=${overlayStats?.total || 0} locks=${lockCount}`);
      }
    }
  }
  const wordCount = summary.trim().split(/\s+/).filter(Boolean).length;

  const builtAt = new Date();
  const updated = await ProfileModel.findOneAndUpdate(
    { _id: profile._id },
    {
      $set: {
        aiSummary: summary,
        aiSummaryMeta: {
          builtAt,
          model: usedModel,
          source: usedSource || source,
          wordCount,
          profileSnapshot: snapshotProfile(profile),
          provenance: aiProvenance || null,
          builtInputs,
          temperature: SUMMARY_TEMPERATURE,
        },
        summaryStale: false,
      },
    },
    { new: true, lean: true },
  );

  return {
    success: true,
    status: 200,
    aiSummary: summary,
    wordCount,
    source: usedSource || source,
    model: usedModel,
    builtAt: builtAt.toISOString(),
    resumeFound: !!resume,
    profile: updated
      ? {
          email: updated.email,
          aiSummary: updated.aiSummary,
          aiSummaryMeta: updated.aiSummaryMeta,
        }
      : null,
  };
}
