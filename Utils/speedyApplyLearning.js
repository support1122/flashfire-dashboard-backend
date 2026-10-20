// SpeedyApply shared learning — merge every client's learned label aliases into
// one map all extensions can use.
//
// Each extension learns "this form label means that profile field" from what its
// client types (SpeedyApply shared/learning.js), e.g. "what should we call you"
// -> preferredFirstName, and syncs that map to its own SpeedyApplyProfile.learned.
// Once a day the backend merges those maps. A label is shared only when enough
// DIFFERENT clients agree on the field, so one client's odd form (or a bad
// learn) cannot teach everyone else something wrong.
//
// Only label text and field names are shared. Never a value, never an email,
// never a saved answer.
//
// Pure functions: no DB, no network (the worker in src/services does the I/O).

// Same paths the extension can learn (shared/learning.js LEARNABLE_PROFILE_FIELDS).
// Anything else in a stored map is ignored.
export const SHARED_LEARNABLE_FIELDS = new Set([
  "firstName", "lastName", "middleName", "preferredFirstName", "fullName",
  "email", "phone", "linkedinUrl", "githubUrl", "portfolioUrl",
  "address.street", "address.city", "address.state", "address.zip", "address.country",
  "currentCompany", "currentTitle",
]);

export const SHARED_DEFAULTS = {
  minClients: 3,      // distinct clients who learned the label
  minAgreement: 0.75, // share of those clients that picked the winning field
  maxLabels: 2000,    // size cap on the shared map
};

// Long-form prompts are never short-field aliases (mirrors LEARN_CLEANUP_RE in the extension).
const LONG_FORM_RE = /cover.?letter|summary|describe|tell.?us|why (do |are |us|you)|what (makes|do you)|explain|elaborate|additional info|comments|message|essay|motivation|interest|introduce|background/i;

// Same normalisation as the extension's normalizeLabelKey.
export function normalizeLabelKey(label) {
  return String(label || "")
    .replace(/\*+/g, "")
    .replace(/[?:]+\s*$/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .slice(0, 200);
}

// A label worth sharing: a short prompt, not page-specific text. Labels with an
// email, a URL or a long digit run can carry personal or tenant data.
export function isShareableLabel(label) {
  if (!label || label.length < 3 || label.length > 80) return false;
  if (LONG_FORM_RE.test(label)) return false;
  if (/@|https?:|www\.|\d{4,}/.test(label)) return false;
  if (!/[a-z]/.test(label)) return false;
  return true;
}

// One client's stored learned map -> Map(label -> field). Pending flips and
// unknown fields are dropped.
export function clientAliases(learned) {
  const out = new Map();
  if (!learned || typeof learned !== "object") return out;
  for (const [rawLabel, entry] of Object.entries(learned)) {
    const field = entry?.profileField;
    if (!SHARED_LEARNABLE_FIELDS.has(field)) continue;
    const label = normalizeLabelKey(rawLabel);
    if (!isShareableLabel(label)) continue;
    out.set(label, field);
  }
  return out;
}

// Merge many clients' learned maps. `learnedMaps` is an iterable of the stored
// `learned` blobs, one per client. Returns { mappings, stats }, where mappings is
// { label: { profileField, clients, agreement } }.
export function mergeLearnedMaps(learnedMaps, opts = {}) {
  const { minClients, minAgreement, maxLabels } = { ...SHARED_DEFAULTS, ...opts };
  const votes = new Map(); // label -> Map(field -> distinct clients)
  let contributors = 0;

  for (const learned of learnedMaps) {
    const aliases = clientAliases(learned);
    if (!aliases.size) continue;
    contributors++;
    for (const [label, field] of aliases) {
      let byField = votes.get(label);
      if (!byField) votes.set(label, (byField = new Map()));
      byField.set(field, (byField.get(field) || 0) + 1);
    }
  }

  const accepted = [];
  let contested = 0;
  for (const [label, byField] of votes) {
    let total = 0, best = null, bestN = 0;
    for (const [field, n] of byField) {
      total += n;
      if (n > bestN) { best = field; bestN = n; }
    }
    if (bestN < minClients) continue;
    const agreement = bestN / total;
    if (agreement < minAgreement) { contested++; continue; }
    accepted.push({ label, profileField: best, clients: bestN, agreement: Math.round(agreement * 100) / 100 });
  }

  // Most-agreed labels first when the cap bites.
  accepted.sort((a, b) => b.clients - a.clients || a.label.localeCompare(b.label));
  const mappings = {};
  for (const a of accepted.slice(0, maxLabels)) {
    mappings[a.label] = { profileField: a.profileField, clients: a.clients, agreement: a.agreement };
  }

  return {
    mappings,
    stats: { contributors, labelsSeen: votes.size, shared: Object.keys(mappings).length, contested },
  };
}
