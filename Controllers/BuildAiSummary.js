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
import { callGemini, GEMINI_JUDGE_MODEL, HAS_GEMINI_CREDENTIALS } from "../Utils/vertexGeminiJudge.js";

const RESUME_API_URL = process.env.RESUME_API_URL || "http://localhost:5000";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
// Gemini-first switch for summary builds. Set FF_SUMMARY_PREFER_GEMINI=0 to
// force OpenAI path. Default on — cheaper + same JSON-free output works.
const PREFER_GEMINI = process.env.FF_SUMMARY_PREFER_GEMINI !== "0";
const GEMINI_SUMMARY_MODEL = process.env.GEMINI_SUMMARY_MODEL || GEMINI_JUDGE_MODEL;
const MAX_SUMMARY_CHARS = 8000;

const SYSTEM_PROMPT = `You are a senior recruiter writing a candidate brief.
You receive a candidate's onboarding profile + parsed resume. You produce a single
"candidate summary" used by an automated job-fit grader.

Goals:
1. Make later grading reliable by surfacing the SIGNALS that determine fit.
2. Stay under 500 words.
3. Be specific and grounded — quote real titles, years, technologies, locations from
   the inputs. Never invent.

Required structure (use these exact section headers):

# Candidate Summary
- 2-3 sentence overview (current title, total YOE, primary discipline).

# Target Roles
- FIRST line: list every POSITIVE entry from profile.preferredRoles VERBATIM,
  comma-separated, prefixed with "Preferred roles (verbatim from profile): ".
  Do not paraphrase or rename. The downstream grader cites these strings
  literally in pick reasons.
- SECOND line (only if profile.preferredRoles contains negative clauses like
  "Do not add Technician roles", "no QA", "exclude manager positions"): list
  the cleaned excluded role names VERBATIM, comma-separated, prefixed with
  "Excluded roles (verbatim from profile, do NOT pick these): ". Omit this
  line entirely when there are no negative clauses.
- Then bullet list of role titles the candidate wants, grouping same-family roles
  (e.g. "Software Engineer / Backend Engineer / Platform Engineer" — one bullet).
- Note seniority band (intern / entry / mid / senior / lead / exec).

# Hard Constraints
- Locations they will accept (cities + remote/hybrid policy).
- Work authorisation (citizen / GC / H1B / OPT / needs sponsorship).
- Salary floor if profile states one.
- Industries / company stages excluded if any.
- Employment types accepted: take VERBATIM from the "Employment type rules"
  block in the user prompt. That block enumerates each of Full-time / Part-time
  / Contract / Internship as either ACCEPT or REJECT and supplies the exact
  Hard Constraints + Hard Disqualifiers wording to use. Do NOT invent
  rejections or skip-bullets for any type marked ACCEPT, even if you would
  default to skipping it. Do NOT omit rejections for types marked REJECT.

# Strong Signals (auto-PICK if matched)
- Keywords / role titles / skills that indicate a strong fit when seen on a job.

# Hard Disqualifiers (auto-SKIP if matched)
- Specific factors that must reject a job (e.g. "anything requiring active
  US security clearance — candidate does not have it").
- INCLUDE every excluded role from the "Excluded roles" line above as its
  own disqualifier bullet, with the exact wording the candidate used
  (e.g. "Technician roles — candidate explicitly opted out").
- ALWAYS include this exact bullet verbatim, for every candidate, no
  exceptions: "Job posting age — skip any job posted more than 48 hours
  ago. Only postings from the last 48 hours are in scope."

# Notes for Grader
- 2-4 sentences of nuance: how to weight role family vs seniority vs location.
  E.g. "Candidate is open to PM and APM roles but not SVP or Director — too senior."

Rules:
- Total length: 380-500 words.
- No fluff, no marketing, no generic ("strong communicator").
- Every bullet must be derivable from the inputs. If profile is missing a fact,
  say "not specified".
- Plain text, no markdown beyond the # headers and - bullets.`;

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

function buildUserPrompt(profile, resume, existingSummary, profileDiff) {
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
- Render the Excluded list on the "Excluded roles (verbatim from profile, do NOT pick these)" line and add a matching bullet under Hard Disqualifiers.
- NEVER include any excluded role under Strong Signals or Target Roles bullets.

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
    return `## Existing summary (built from a profile snapshot that is now out of date)
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
output a diff or a list of changes.`;
  }
  return `## Onboarding profile
${profileBlob}
${rolesBlock}

## Parsed resume
${resumeBlob}`;
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

async function callOpenAI(profile, resume, existingSummary, profileDiff, apiKey) {
  const body = {
    model: OPENAI_MODEL,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(profile, resume, existingSummary, profileDiff) },
    ],
    temperature: 0.2,
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

  const existingSummary =
    profile?.summaryStale && typeof profile.aiSummary === "string"
      ? profile.aiSummary
      : "";
  const prevSnapshot = profile?.aiSummaryMeta?.profileSnapshot || null;
  const profileDiff = existingSummary && prevSnapshot
    ? computeProfileDiff(prevSnapshot, profile)
    : [];
  if (profileDiff.length) {
    console.log(
      "BuildAiSummary diff:",
      profileDiff.map((c) => `${c.field}[+${c.added.length}/-${c.removed.length}]`).join(" "),
    );
  }
  // Gemini-first: cheaper and fast for 500-word briefs. Falls back to OpenAI
  // on any Gemini failure (missing creds, Vertex error, empty content) so a
  // misconfigured GCP project never blocks summary builds.
  let ai = { ok: false };
  let usedModel = "";
  let usedSource = "";
  if (PREFER_GEMINI && HAS_GEMINI_CREDENTIALS) {
    const userPrompt = buildUserPrompt(profile, resume, existingSummary, profileDiff);
    const g = await callGemini({
      system: SYSTEM_PROMPT,
      user: userPrompt,
      temperature: 0.2,
      json: false,
      model: GEMINI_SUMMARY_MODEL,
    });
    if (g.ok) {
      ai = { ok: true, summary: g.content, usage: g.usage };
      usedModel = g.model || GEMINI_SUMMARY_MODEL;
      usedSource = `${source}+gemini`;
    } else {
      console.warn(`[BuildAiSummary] Gemini failed (${g.error}: ${g.message}) — falling back to OpenAI`);
    }
  }
  if (!ai.ok) {
    ai = await callOpenAI(profile, resume, existingSummary, profileDiff, apiKey);
    usedModel = OPENAI_MODEL;
    usedSource = `${source}+openai`;
  }
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
  const summary = (ai.summary || "").slice(0, MAX_SUMMARY_CHARS);
  if (!summary) {
    return { success: false, status: 502, error: "EMPTY_SUMMARY", message: "OpenAI returned empty content", step: "openai" };
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
