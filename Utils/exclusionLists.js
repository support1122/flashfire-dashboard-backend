/**
 * Per-client job exclusion lists: normalize once, check in O(1) for companies
 * and O(k) for location tokens (k = tokens in job location string).
 */

export function normalizeForExclusion(s) {
  if (s === undefined || s === null) return "";
  if (typeof s !== "string") return "";
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

const MAX_EXCLUSION_ENTRY_LEN = 280;

/** Strip control chars; decode minimal HTML entities that often appear from copy-paste mistakes */
export function stripAndDecodeExclusionInput(raw) {
  if (raw === undefined || raw === null) return "";
  let s = String(raw);
  s = s
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
  return s;
}

/**
 * Split incoming list into kept (normalized) vs quarantined entries (invalid / escaped junk).
 * @returns {{ clean: string[], quarantine: { text: string, reason: string }[] }}
 */
export function partitionExclusionList(input, kind) {
  if (!Array.isArray(input)) return { clean: [], quarantine: [] };
  const clean = [];
  const quarantine = [];
  const seen = new Set();
  for (const raw of input) {
    const decoded = stripAndDecodeExclusionInput(raw);
    const n = normalizeForExclusion(decoded);
    if (!n) {
      if (String(raw).trim()) {
        quarantine.push({
          text: String(raw).slice(0, 200),
          reason: "empty_after_sanitize",
          kind,
        });
      }
      continue;
    }
    if (n.length > MAX_EXCLUSION_ENTRY_LEN) {
      quarantine.push({
        text: n.slice(0, 200),
        reason: "exceeds_max_length",
        kind,
      });
      continue;
    }
    if (seen.has(n)) continue;
    seen.add(n);
    clean.push(n);
  }
  return { clean, quarantine };
}

/**
 * Deduplicate by normalized form; store canonical normalized strings (no quarantine audit).
 */
export function sanitizeExclusionList(input) {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of input) {
    const decoded = stripAndDecodeExclusionInput(raw);
    const n = normalizeForExclusion(decoded);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

function tokenizeLocation(normalized) {
  if (!normalized) return [];
  return normalized
    .split(/[\s,;/|]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/**
 * @param {string[]} excludedCompanies
 * @param {string[]} excludedLocations
 */
export function buildExclusionCheckSets(excludedCompanies, excludedLocations) {
  const companySet = new Set(sanitizeExclusionList(excludedCompanies));
  const locList = sanitizeExclusionList(excludedLocations);
  const locationExactSet = new Set();
  const locationTokenSet = new Set();
  for (const loc of locList) {
    locationExactSet.add(loc);
    for (const tok of tokenizeLocation(loc)) {
      if (tok.length >= 2) locationTokenSet.add(tok);
    }
  }
  return { companySet, locationExactSet, locationTokenSet };
}

const UNKNOWN_COMPANY = new Set(["unknown", "unknown company", "n/a", "na"]);

/**
 * Skip blocking when company is missing or placeholder.
 */
export function isCompanyBlocked(company, companySet) {
  const n = normalizeForExclusion(company);
  if (!n || UNKNOWN_COMPANY.has(n)) return false;
  return companySet.has(n);
}

export function isLocationBlocked(location, locationExactSet, locationTokenSet) {
  const n = normalizeForExclusion(location);
  if (!n) return false;
  if (locationExactSet.has(n)) return true;
  for (const t of tokenizeLocation(n)) {
    if (t.length >= 2 && locationTokenSet.has(t)) return true;
  }
  return false;
}
