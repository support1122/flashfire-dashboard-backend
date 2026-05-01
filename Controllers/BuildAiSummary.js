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

const RESUME_API_URL = process.env.RESUME_API_URL || "http://localhost:5000";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
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
- Bullet list of role titles the candidate wants. Group same-family roles
  (e.g. "Software Engineer / Backend Engineer / Platform Engineer" — one bullet).
- Note seniority band (intern / entry / mid / senior / lead / exec).

# Hard Constraints
- Locations they will accept (cities + remote/hybrid policy).
- Work authorisation (citizen / GC / H1B / OPT / needs sponsorship).
- Salary floor if profile states one.
- Industries / company stages excluded if any.

# Strong Signals (auto-PICK if matched)
- Keywords / role titles / skills that indicate a strong fit when seen on a job.

# Hard Disqualifiers (auto-SKIP if matched)
- Specific factors that must reject a job (e.g. "anything requiring active
  US security clearance — candidate does not have it").

# Notes for Grader
- 2-4 sentences of nuance: how to weight role family vs seniority vs location.
  E.g. "Candidate is open to PM and APM roles but not SVP or Director — too senior."

Rules:
- Total length: 380-500 words.
- No fluff, no marketing, no generic ("strong communicator").
- Every bullet must be derivable from the inputs. If profile is missing a fact,
  say "not specified".
- Plain text, no markdown beyond the # headers and - bullets.`;

function buildUserPrompt(profile, resume, existingSummary) {
  const profileBlob = JSON.stringify(profile || {}, null, 2).slice(0, 12_000);
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
    return `## Existing summary (the candidate's profile has changed since this was built)
${existingSummary.trim().slice(0, 6_000)}

## Updated onboarding profile
${profileBlob}

## Parsed resume
${resumeBlob}

## Task
Update the existing summary above to reflect the updated profile. Keep the
same section structure, tone, and any specific phrasing that still applies.
Only change the sentences/bullets that contradict the new profile data
(removed locations, changed seniority, new visa status, added/removed
preferred roles, etc.). Mark added/removed locations or constraints
explicitly. Do NOT rewrite from scratch.`;
  }
  return `## Onboarding profile
${profileBlob}

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

async function callOpenAI(profile, resume, existingSummary) {
  const body = {
    model: OPENAI_MODEL,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(profile, resume, existingSummary) },
    ],
    temperature: 0.2,
  };
  try {
    const res = await axios.post("https://api.openai.com/v1/chat/completions", body, {
      timeout: 60_000,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${OPENAI_API_KEY}`,
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

export default async function BuildAiSummary(req, res) {
  try {
    if (!OPENAI_API_KEY) {
      return res.status(503).json({
        success: false,
        error: "NO_OPENAI_KEY",
        message: "OPENAI_API_KEY is not set in dashboard backend env",
        step: "config",
      });
    }
    const { email } = req.body || {};
    if (!email || typeof email !== "string" || !email.includes("@")) {
      return res.status(400).json({
        success: false,
        error: "BAD_INPUT",
        message: "email is required",
        step: "validate",
      });
    }
    const lower = String(email).toLowerCase();

    // 1. Profile
    const profile = await ProfileModel.findOne({ email: lower }).lean();
    if (!profile) {
      // Some legacy profiles use mixed-case email. Try a case-insensitive match.
      const fallback = await ProfileModel.findOne({
        email: { $regex: new RegExp(`^${escapeRegex(email)}$`, "i") },
      }).lean();
      if (!fallback) {
        return res.status(404).json({
          success: false,
          error: "PROFILE_NOT_FOUND",
          message: `No profile in DB for ${email}`,
          step: "loading-profile",
        });
      }
      return await runForProfile(fallback, res);
    }
    return await runForProfile(profile, res);
  } catch (err) {
    console.error("BuildAiSummary fatal:", err);
    return res.status(500).json({
      success: false,
      error: "INTERNAL",
      message: err.message,
      step: "internal",
    });
  }
}

function escapeRegex(s) {
  return String(s).replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
}

async function runForProfile(profile, res) {
  const email = profile.email;

  // 2. Resume (optional)
  const resumeRes = await fetchResume(email);
  const resume = resumeRes.ok ? resumeRes.resume : null;
  const source = resume ? "profile+resume" : "profile-only";

  // 3. OpenAI — pass existing summary when profile was edited so the
  //    rebuild is incremental (preserves voice, only changes diffs).
  const existingSummary =
    profile?.summaryStale && typeof profile.aiSummary === "string"
      ? profile.aiSummary
      : "";
  const ai = await callOpenAI(profile, resume, existingSummary);
  if (!ai.ok) {
    return res.status(502).json({
      success: false,
      error: ai.error,
      message: ai.message,
      step: "openai",
    });
  }
  const summary = (ai.summary || "").slice(0, MAX_SUMMARY_CHARS);
  if (!summary) {
    return res.status(502).json({
      success: false,
      error: "EMPTY_SUMMARY",
      message: "OpenAI returned empty content",
      step: "openai",
    });
  }
  const wordCount = summary.trim().split(/\s+/).filter(Boolean).length;

  // 4. Persist
  const builtAt = new Date();
  const updated = await ProfileModel.findOneAndUpdate(
    { _id: profile._id },
    {
      $set: {
        aiSummary: summary,
        aiSummaryMeta: {
          builtAt,
          model: OPENAI_MODEL,
          source,
          wordCount,
        },
        // Summary just rebuilt — clear stale flag.
        summaryStale: false,
      },
    },
    { new: true, lean: true },
  );

  return res.json({
    success: true,
    aiSummary: summary,
    wordCount,
    source,
    model: OPENAI_MODEL,
    builtAt: builtAt.toISOString(),
    resumeFound: !!resume,
    profile: updated
      ? {
          email: updated.email,
          aiSummary: updated.aiSummary,
          aiSummaryMeta: updated.aiSummaryMeta,
        }
      : null,
  });
}
