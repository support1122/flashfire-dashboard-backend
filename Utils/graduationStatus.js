// Is the candidate still studying, or have they graduated?
//
// WHY THIS EXISTS
//
// The AI recruiter outreach mail closes with a line about education. It was
// writing "I am currently pursuing a Master of Science ..." for clients who had
// already graduated, because the prompt handed the model a bare date
// ("Masters: MS CS, Northeastern (May 2025)") with no indication of whether
// that date is past or future, and the style-reference example in the prompt
// happened to use "currently pursuing". A model has no reliable sense of today,
// so it copied the example.
//
// That is a factual misstatement about the client, sent to a recruiter, under
// the client's own name and from their own mailbox. It is not a wording
// preference. So the decision is made HERE, in code, against the clock, and the
// model is told the answer rather than asked to work it out.
//
// The stored dates are free text. Profile intake (Controllers/Extensions/profileExt.js)
// accepts "YYYY-MM-DD", "MM/YYYY", "MM YYYY" and "Month YYYY", and real rows
// carry all of those plus a bare year. Anything this file cannot parse returns
// known:false, and every caller then says nothing about tense rather than
// guessing - an unparsed date must never become a confident claim.

const MONTHS = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12
};

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

const plausibleYear = (y) => Number.isInteger(y) && y >= 1950 && y <= 2100;

/**
 * Parse a stored graduation date into { year, month }.
 * month is 1-12, or null when only a year was given.
 *
 * @param {string} raw
 * @returns {{year:number, month:number|null}|null} null when unparseable
 */
export function parseGradDate(raw) {
  const s = String(raw ?? "").trim();
  if (!s || s.length > 32) return null;

  // ISO-ish: 2025-05-15, 2025-05, 2025/05
  let m = s.match(/^(\d{4})[-/](\d{1,2})(?:[-/](\d{1,2}))?$/);
  if (m) {
    const year = Number(m[1]);
    const month = Number(m[2]);
    if (plausibleYear(year) && month >= 1 && month <= 12) return { year, month };
    return null;
  }

  // Numeric month first: 05/2025, 5-2025, 05 2025
  m = s.match(/^(\d{1,2})[-/\s](\d{4})$/);
  if (m) {
    const month = Number(m[1]);
    const year = Number(m[2]);
    if (plausibleYear(year) && month >= 1 && month <= 12) return { year, month };
    return null;
  }

  // Named month: "May 2025", "Sept 2025", "May, 2025", "2025 May"
  m = s.match(/^([A-Za-z]{3,9})\.?,?\s+(\d{4})$/);
  if (m && MONTHS[m[1].toLowerCase()]) {
    const year = Number(m[2]);
    if (plausibleYear(year)) return { year, month: MONTHS[m[1].toLowerCase()] };
    return null;
  }
  m = s.match(/^(\d{4})\s+([A-Za-z]{3,9})\.?$/);
  if (m && MONTHS[m[2].toLowerCase()]) {
    const year = Number(m[1]);
    if (plausibleYear(year)) return { year, month: MONTHS[m[2].toLowerCase()] };
    return null;
  }

  // Bare year.
  m = s.match(/^(\d{4})$/);
  if (m && plausibleYear(Number(m[1]))) return { year: Number(m[1]), month: null };

  return null;
}

/**
 * Graduated, still studying, or unknown.
 *
 * The boundary is deliberately conservative: a degree counts as finished only
 * once its graduation month is fully PAST. Through May 2026 a May 2026 graduate
 * still reads as "completing". Saying "pursuing" a month late is awkward;
 * claiming a degree a month early is a false credential to a recruiter, and
 * that asymmetry is what sets the rule.
 *
 * A bare year resolves at the end of that year, for the same reason.
 *
 * @param {string} raw   the stored grad date
 * @param {Date}   [now] injectable clock, for tests
 * @returns {{known:boolean, graduated:boolean, label:string, year:number|null, month:number|null}}
 */
export function graduationStatus(raw, now = new Date()) {
  const parsed = parseGradDate(raw);
  if (!parsed) return { known: false, graduated: false, label: "", year: null, month: null };

  const { year, month } = parsed;
  // First instant AFTER the graduation period ends.
  const endsAfter = month ? new Date(Date.UTC(year, month, 1)) : new Date(Date.UTC(year + 1, 0, 1));
  const graduated = now.getTime() >= endsAfter.getTime();
  const label = month ? `${MONTH_NAMES[month - 1]} ${year}` : String(year);

  return { known: true, graduated, label, year, month };
}

/**
 * The education status for one profile, taking the HIGHEST degree on file:
 * a master's outranks a bachelor's, because that is what the outreach line
 * talks about.
 *
 * @param {object} profile
 * @param {Date}   [now]
 * @returns {{known:boolean, graduated:boolean, degree:string, label:string, level:string}}
 */
export function profileEducationStatus(profile, now = new Date()) {
  const none = { known: false, graduated: false, degree: "", label: "", level: "" };
  if (!profile) return none;

  const candidates = [
    { level: "masters", degree: profile.mastersUniDegree, date: profile.mastersGradMonthYear },
    { level: "bachelors", degree: profile.bachelorsUniDegree, date: profile.bachelorsGradMonthYear }
  ];

  for (const c of candidates) {
    if (!String(c.degree || "").trim()) continue;
    const st = graduationStatus(c.date, now);
    return {
      known: st.known,
      graduated: st.graduated,
      degree: String(c.degree).trim(),
      label: st.label,
      level: c.level
    };
  }
  return none;
}

/** One line for the AI prompt, stating the answer instead of implying it. */
export function educationPromptLine(status) {
  if (!status?.degree) return "";
  const where = status.degree;
  if (!status.known) {
    return `Education: ${where} (graduation date not on file) [STATUS UNKNOWN - do not say "pursuing" and do not claim the degree is finished; mention the field of study without a tense claim, or leave education out]`;
  }
  return status.graduated
    ? `Education: ${where}, graduated ${status.label} [COMPLETED - write in the PAST tense, e.g. "I hold a ..." or "I completed my ...". Never write "pursuing", "completing", "working towards" or "expected".]`
    : `Education: ${where}, expected ${status.label} [IN PROGRESS - "I am currently pursuing ..." is correct. Never claim the degree is already held.]`;
}

// ── The deterministic guard ──────────────────────────────────────────
//
// A prompt rule is advice. This is the guarantee. The model still writes the
// sentence, but a claim that contradicts the profile is corrected before the
// mail can leave, because this one goes out under the client's name to a
// recruiter who may act on it.
//
// SCOPED TO THE EDUCATION SENTENCE ON PURPOSE. "completing" and "pursuing"
// appear in achievement bullets too ("completing the migration ahead of
// schedule"), and a body-wide search-and-replace would rewrite the client's
// work history. Only sentences that actually mention a degree, a university or
// graduating are touched.
const EDUCATION_CONTEXT =
  /\b(?:master'?s?|bachelor'?s?|m\.?s\.?|b\.?s\.?|b\.?tech|m\.?tech|mba|ph\.?d|doctorate|degree|university|college|graduat)/i;

// Applied in order; the more specific pattern has to win first.
const TO_PAST = [
  [/\bI am currently pursuing\s+(?:a|an|my|the)\s+/gi, "I completed my "],
  [/\bI am (?:currently\s+)?(?:pursuing|completing|undertaking|finishing|working towards|studying towards)\s+(?:a|an|my|the)\s+/gi, "I completed my "],
  [/\bam (?:currently\s+)?(?:pursuing|completing|undertaking|finishing|working towards|studying towards)\s+(?:a|an|my|the)\s+/gi, "completed my "],
  [/\bI (?:will be graduating|am graduating|graduate)\s+in\b/gi, "I graduated in"],
  [/\bexpected\s+to\s+graduate\s+in\b/gi, "graduated in"],
  // "expected graduation" sits inside a noun phrase ("my expected graduation
  // from X is May 2025"), so only the forward-looking word is dropped.
  // Replacing the whole phrase with a verb produces "My graduated from X".
  [/\bexpected\s+graduation\b/gi, "graduation"],
  [/\bgraduation\s+is\s+expected\b/gi, "graduation was"],
  [/\bcurrently\s+pursuing\b/gi, "completed"]
];

const TO_PRESENT = [
  [/\bI hold\s+(?:a|an|my|the)\s+/gi, "I am currently pursuing a "],
  [/\bI completed my\s+/gi, "I am currently pursuing my "],
  [/\bI (?:have\s+)?earned\s+(?:a|an|my|the)\s+/gi, "I am currently pursuing a "],
  [/\bI graduated\s+(in|from)\b/gi, "I expect to graduate $1"]
];

/**
 * Correct the education tense of a generated outreach body.
 *
 * Does nothing when the status is unknown: an unparsed graduation date must
 * never become a confident claim in either direction.
 *
 * @param {string} body
 * @param {{known:boolean, graduated:boolean}} status - from profileEducationStatus()
 * @returns {{text:string, changed:boolean, corrections:string[]}}
 */
export function enforceEducationTense(body, status) {
  const text = String(body ?? "");
  if (!text || !status?.known) return { text, changed: false, corrections: [] };

  const rules = status.graduated ? TO_PAST : TO_PRESENT;
  const corrections = [];

  // Sentence-ish units: keep the delimiters so the body rebuilds byte-identical
  // where nothing changed.
  const parts = text.split(/(?<=[.!?])(\s+)/);
  const fixed = parts.map((part) => {
    if (!EDUCATION_CONTEXT.test(part)) return part;
    let out = part;
    for (const [re, replacement] of rules) {
      if (!re.test(out)) continue;
      re.lastIndex = 0;
      const before = out;
      out = out.replace(re, replacement);
      if (out !== before) corrections.push(`${re.source} -> ${replacement.trim()}`);
      re.lastIndex = 0;
    }
    return out;
  });

  const joined = fixed.join("");
  return { text: joined, changed: joined !== text, corrections };
}

/**
 * Does this stored body still make a claim the profile contradicts?
 * Used by the daily sweep to find templates written before the client's
 * graduation date passed. Same scoping rule as the rewriter.
 *
 * @returns {boolean}
 */
export function educationClaimIsStale(body, status) {
  if (!status?.known) return false;
  return enforceEducationTense(body, status).changed;
}
