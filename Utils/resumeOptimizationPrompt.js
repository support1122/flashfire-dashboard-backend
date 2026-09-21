/**
 * Resume optimize-with-gemini instruction prefix + India-related JD detection.
 * Keep logic in sync with flashfire-dashboard-frontend-main/src/utils/resumeOptimizationPrompt.ts
 */

export const RESUME_OPTIMIZATION_BASE_PROMPT =
  "if you recieve any HTML tages please ignore it and optimize the resume according to the given JD. " +
  "Make sure not to cut down or shorten any points in the Work Experience section. " +
  "IN all fields please do not cut down or shorten any points or content. " +
  "For example, if a role in the base resume has 6 points, the optimized version should also retain all 6 points. " +
  "The content should be aligned with the JD but the number of points per role must remain the same. " +
  "Do not touch or optimize publications if given to you.";

/** Shown only when the JD mentions India / Indian geography or labels (see jobDescriptionMentionsIndia). */
const INDIA_CONTEXT_INSTRUCTION =
  " The job description references India, Indian locations, or the Indian market (including Bharat / भारत). " +
  "Align truthful wording with that geography: emphasize transferable impact and any real India/APAC or " +
  "India-facing experience when present. Do not invent addresses, work authorization, or local credentials. " +
  "If the JD specifies India-only constraints (compensation in INR, local compliance, domestic hiring), reflect " +
  "them only where they match the candidate's real profile; otherwise keep achievements globally relevant.";

/**
 * Strip tags/scripts for scanning so India is not missed when the JD is HTML.
 * @param {string} html
 * @returns {string}
 */
export function plainTextForIndiaScan(html) {
  if (!html || typeof html !== "string") return "";
  return html
    .normalize("NFKC")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Indic literals before ASCII \\b branches — avoids engine quirks when alternation mixes scripts with \\b.
 * Word boundaries limit false positives (e.g. "Indiana" does not match \\bindia\\b).
 */
const INDIA_REGEX =
  /भारत|ভারত|इंडिया|ભારત|भारतीय|\bindia(?:n|ns)?\b|\bbharat\b|\bhindustan\b/iu;

/**
 * @param {string | null | undefined} raw — HTML or plain JD
 * @returns {boolean}
 */
export function jobDescriptionMentionsIndia(raw) {
  const plain = plainTextForIndiaScan(raw || "");
  if (!plain) return false;
  return INDIA_REGEX.test(plain);
}

/**
 * Instruction block sent before the raw job description body to optimize-with-gemini.
 * @param {string | null | undefined} jobDescriptionHtml
 * @returns {string}
 */
export function buildResumeOptimizationInstructionPrompt(jobDescriptionHtml) {
  if (!jobDescriptionMentionsIndia(jobDescriptionHtml)) {
    return RESUME_OPTIMIZATION_BASE_PROMPT;
  }
  return `${RESUME_OPTIMIZATION_BASE_PROMPT}${INDIA_CONTEXT_INSTRUCTION}`;
}
