/**
 * Renamed resume section headings, as stored on a job's optimizedResume.
 *
 * An operator can rename a section in the resume maker (the leadership section
 * becoming "ADDITIONAL INFORMATION" is the common one). The base resume keeps
 * that as `sectionTitles: { leadership: "ADDITIONAL INFORMATION" }`, and every
 * renderer (ResumePreview, ResumePreviewMedical, the PDF server) falls back to
 * its hard-coded default for any section missing from the map.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every path that copied a resume onto a job (saveChangedSession and the
 * auto-optimization worker) copied the show-flags and section order but not the
 * titles, and the job schema had no field to hold them. So the admin editor
 * showed "ADDITIONAL INFORMATION" while the client's job card, and the PDF they
 * downloaded from it, said "LEADERSHIP & VOLUNTEERING".
 *
 * The map arrives from the browser, so it is reduced to what a renderer can
 * use: string keys, non-empty trimmed string values, bounded in size. Anything
 * else is dropped rather than rejected, because a bad title must never block a
 * resume from saving.
 */

const MAX_SECTIONS = 20;
const MAX_KEY_LENGTH = 40;
const MAX_TITLE_LENGTH = 120;

/**
 * @param {unknown} raw
 * @returns {Record<string, string>}
 */
export function sanitizeSectionTitles(raw) {
     if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};

     const out = {};
     for (const [key, value] of Object.entries(raw)) {
          if (Object.keys(out).length >= MAX_SECTIONS) break;
          if (typeof key !== "string" || !/^[A-Za-z][A-Za-z0-9_]*$/.test(key)) continue;
          if (key.length > MAX_KEY_LENGTH) continue;
          if (typeof value !== "string") continue;
          const title = value.trim().slice(0, MAX_TITLE_LENGTH);
          if (title) out[key] = title;
     }
     return out;
}

/**
 * The titles a saved resume carries, wherever the caller put them. The editor
 * sends them beside resumeData; the resume service also embeds a copy inside
 * resumeData itself, so both are checked and the explicit one wins.
 *
 * @param {{ sectionTitles?: unknown, resumeData?: { sectionTitles?: unknown } } | null | undefined} optimizedResume
 * @returns {Record<string, string>}
 */
export function sectionTitlesFrom(optimizedResume) {
     const explicit = sanitizeSectionTitles(optimizedResume?.sectionTitles);
     if (Object.keys(explicit).length) return explicit;
     return sanitizeSectionTitles(optimizedResume?.resumeData?.sectionTitles);
}
