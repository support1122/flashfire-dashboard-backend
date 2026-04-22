export const MAX_JOB_TITLE_LENGTH = 50;

export function normalizeWhitespace(value = "") {
  return String(value).trim().replace(/\s+/g, " ");
}

function truncateAtWordBoundary(value, maxLength) {
  if (value.length <= maxLength) return value;

  const sliced = value.slice(0, maxLength);
  const lastSpace = sliced.lastIndexOf(" ");

  if (lastSpace > 0) {
    return sliced.slice(0, lastSpace).trimEnd();
  }

  return sliced.trimEnd();
}

export function sanitizeJobTitle(input, maxLength = MAX_JOB_TITLE_LENGTH) {
  const normalized = normalizeWhitespace(input);
  if (!normalized) return "";
  return truncateAtWordBoundary(normalized, maxLength);
}
