// Reads a job's optimized resume JSON back from wherever it was saved.
//
// saveChangedSession and the auto-optimization worker upload the resume JSON
// to R2 and keep only a pointer on the job (optimizedResume.resumeDataKey, or
// resumeDataR2Key / resumeDataUrl on older rows). Rows from before the R2
// move still hold the JSON inline as optimizedResume.resumeData.
//
// This follows the same lookup order as getOptimizedResume in
// Controllers/Optimizer/jobController.js (public URL, direct key, extracted
// key, then the legacy key prefixes), so a resume the job card can open is a
// resume SpeedyApply can attach. Pass the job's optimizedResume as a plain
// object (a lean() read), so pointer fields missing from the schema survive.

import { getJSONFromR2, extractR2Key, isR2Url } from "./r2Storage.js";

const LEGACY_PREFIXES = (key) => [
  key.replace(/^Legacy\//, "test/Legacy/"),
  key.replace(/^Legacy\//, "flashfire-storage/Legacy/"),
  `Legacy/${key.split("/").slice(-2).join("/")}`,
];

// Resolves to { ok: true, data } or { ok: false, reason }. `reason` is
// "missing" (nothing saved) or "storage" (a pointer exists but R2 did not
// return the JSON).
export async function loadOptimizedResumeData(optimizedResume, deps = {}) {
  const getJSON = deps.getJSON || getJSONFromR2;
  const fetchImpl = deps.fetch || fetch;
  const o = optimizedResume || {};
  const storageType = o.storageType || "legacy";

  if (storageType !== "r2") {
    return o.resumeData && typeof o.resumeData === "object"
      ? { ok: true, data: o.resumeData }
      : { ok: false, reason: "missing" };
  }

  const url = [o.resumeDataKey, o.resumeDataUrl].find((u) => u && isR2Url(u));
  if (url) {
    try {
      const resp = await fetchImpl(url);
      if (resp.ok) return { ok: true, data: await resp.json() };
      console.warn(`[optimized-resume] R2 URL returned HTTP ${resp.status}, trying the key`);
    } catch (err) {
      console.warn("[optimized-resume] R2 URL fetch failed, trying the key:", err?.message || err);
    }
  }

  const key = o.resumeDataR2Key
    ? o.resumeDataR2Key.replace(/^\/+/, "").replace(/^test\//, "")
    : extractR2Key(o.resumeDataKey) || extractR2Key(o.resumeDataUrl);
  if (!key) return { ok: false, reason: "missing" };

  for (const candidate of new Set([key, ...LEGACY_PREFIXES(key)])) {
    const r = await getJSON(candidate);
    if (r?.success && r.data && typeof r.data === "object") return { ok: true, data: r.data };
  }
  return { ok: false, reason: "storage" };
}
