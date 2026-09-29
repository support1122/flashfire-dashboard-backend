// Adzuna job-search API client.
//
// Contract measured live 2026-09-29 against api.adzuna.com, not taken from
// memory. The spec is at /v1/api-docs/adzuna (Swagger 1.2); the notes below
// are the parts that actually bite.
//
//   GET https://api.adzuna.com/v1/api/jobs/{country}/search/{page}
//       ?app_id=...&app_key=...&what=nurse&max_days_old=1&results_per_page=50
//
//   * app_id AND app_key are both required. Sending only the key returns
//     HTTP 400; sending the key as both returns 401 AUTH_FAIL.
//   * results_per_page caps at 50. Asking for 100 fails; 50 returns 50.
//   * page is 1-based and in the PATH, not the query. Pages 1 and 2 returned
//     disjoint job ids.
//   * max_days_old=1 is "posted in the last 24 hours": "nurse" in AU returned
//     17,758 all-time, 3,996 at 7 days, 807 at 1 day.
//   * The API 503s under rapid-fire requests - the SAME query that just
//     succeeded will fail if you fire the next one immediately. That is rate
//     limiting, not a bad parameter, so requests are paced and retried here.
//   * A result's `description` is truncated to 500 characters and
//     `full_description` is usually absent. That is fine: the judge decides
//     on the title (see Utils/apiJudge.js), and the 500 chars are plenty for
//     the dashboard card.
//   * `redirect_url` is an adzuna.com.* link that bounces to the employer. It
//     cannot be resolved server-side - fetching it returns 403 to anything
//     that is not a real browser - so that is the link we push. adzuna.com is
//     not in BLOCKED_APPLY_HOSTS, so AddJob accepts it.

import "dotenv/config";

const API_BASE = "https://api.adzuna.com/v1/api/jobs";
const MAX_RESULTS_PER_PAGE = 50;
const REQUEST_TIMEOUT_MS = Number(process.env.ADZUNA_TIMEOUT_MS) || 30000;
// Adzuna 503s when requests come back to back. Measured: three rapid calls in
// a row failed where the same calls at ~3s spacing all returned 200.
const MIN_REQUEST_GAP_MS = Number(process.env.ADZUNA_MIN_GAP_MS) || 3000;
const MAX_RETRIES = 3;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// One shared pacer for the whole process: two clients scraping at once must
// not defeat the spacing by each waiting on their own clock.
let nextSlotAt = 0;
let gate = Promise.resolve();
function reserveSlot() {
  const mine = gate.then(async () => {
    const wait = nextSlotAt - Date.now();
    if (wait > 0) await sleep(wait);
    nextSlotAt = Date.now() + MIN_REQUEST_GAP_MS;
  });
  gate = mine.catch(() => {});
  return mine;
}

export function adzunaCredentials() {
  return {
    appId: String(process.env.ADZUNA_APP_ID || "").trim(),
    appKey: String(process.env.ADZUNA_APP_KEY || "").trim(),
  };
}

/**
 * Turn saved settings into Adzuna query parameters.
 *
 * Only fields the operator actually set are sent. An empty `what` is omitted
 * rather than sent blank, because Adzuna treats an empty keyword as a filter
 * that matches nothing instead of one that matches everything.
 */
export function buildQuery(settings = {}, { appId, appKey } = {}) {
  const q = new URLSearchParams();
  if (appId) q.set("app_id", appId);
  if (appKey) q.set("app_key", appKey);

  const str = (key, value) => {
    const v = String(value ?? "").trim();
    if (v) q.set(key, v);
  };
  const num = (key, value) => {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) q.set(key, String(n));
  };
  // Adzuna's booleans are the literal string "1", and must be ABSENT when
  // off - sending "0" filters to nothing rather than disabling the filter.
  const flag = (key, on) => {
    if (on) q.set(key, "1");
  };

  str("what", settings.what);
  str("what_phrase", settings.whatPhrase);
  str("what_exclude", settings.whatExclude);
  str("title_only", settings.titleOnly);
  str("where", settings.where);
  str("category", settings.category);
  str("sort_by", settings.sortBy);
  num("distance", settings.distance);
  num("salary_min", settings.salaryMin);
  num("salary_max", settings.salaryMax);
  num("max_days_old", settings.maxDaysOld);
  flag("full_time", settings.fullTime);
  flag("part_time", settings.partTime);
  flag("permanent", settings.permanent);
  flag("contract", settings.contract);

  const per = Math.min(
    Math.max(parseInt(settings.resultsPerPage, 10) || MAX_RESULTS_PER_PAGE, 1),
    MAX_RESULTS_PER_PAGE,
  );
  q.set("results_per_page", String(per));
  return q;
}

/** One page of results. Never throws: returns { ok:false, error } instead. */
export async function fetchPage(settings, page, creds = adzunaCredentials()) {
  const { appId, appKey } = creds;
  if (!appId || !appKey) {
    return { ok: false, error: "NO_ADZUNA_CREDENTIALS",
             message: "Set ADZUNA_APP_ID and ADZUNA_APP_KEY on the backend." };
  }
  const country = String(settings.country || "au").toLowerCase().trim() || "au";
  const url = `${API_BASE}/${encodeURIComponent(country)}/search/${page}?${buildQuery(settings, creds)}`;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    await reserveSlot();
    let res;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch (e) {
      if (attempt === MAX_RETRIES) return { ok: false, error: "NETWORK", message: String(e.message || e) };
      await sleep(2000 * (attempt + 1));
      continue;
    }
    // 503 and 429 are the rate limiter, not a bad request - back off and retry
    // rather than reporting a search as empty when it was only too fast.
    if (res.status === 503 || res.status === 429) {
      if (attempt === MAX_RETRIES) return { ok: false, error: `HTTP_${res.status}`,
                                            message: "Adzuna is rate-limiting; try again shortly." };
      await sleep(4000 * (attempt + 1));
      continue;
    }
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: "AUTH_FAIL", message: "Adzuna rejected the app id or key." };
    }
    if (!res.ok) return { ok: false, error: `HTTP_${res.status}` };

    let body;
    try {
      body = await res.json();
    } catch {
      return { ok: false, error: "BAD_JSON" };
    }
    const results = Array.isArray(body?.results) ? body.results : [];
    return { ok: true, count: Number(body?.count) || 0, results };
  }
  return { ok: false, error: "UNREACHABLE" };
}

/** Adzuna's location is an array of widening areas; the display name is best. */
function locationOf(job) {
  const display = String(job?.location?.display_name || "").trim();
  if (display) return display;
  const area = Array.isArray(job?.location?.area) ? job.location.area : [];
  return area.slice(-2).reverse().join(", ");
}

/**
 * One Adzuna result -> the shape the judge and AddJob already understand.
 *
 * Deliberately the same field names the extension sends (see background.js
 * buildPushPayload), so a job from the API and a job from a scrape are
 * indistinguishable downstream - same judge, same cap, same dashboard card.
 *
 * jobId is namespaced "adz-<id>" exactly as the extension's Adzuna scraper
 * does, so the same job found both ways dedupes instead of double-pushing.
 */
export function mapJob(job) {
  const id = String(job?.id || "").trim();
  if (!id) return null;
  const title = String(job?.title || "").replace(/\s+/g, " ").trim();
  if (!title) return null;

  const salary = [job?.salary_min, job?.salary_max]
    .map((n) => (Number.isFinite(Number(n)) ? Math.round(Number(n)) : null));
  const salaryText = salary[0] && salary[1]
    ? (salary[0] === salary[1] ? `${salary[0]}` : `${salary[0]} - ${salary[1]}`)
    : "";

  return {
    jobId: `adz-${id}`,
    source: "adzuna",
    title,
    company: String(job?.company?.display_name || "").trim(),
    location: locationOf(job),
    // 500 chars from the API. The judge works on the title, and this is what
    // the dashboard card shows.
    description: String(job?.description || "").replace(/\s+/g, " ").trim(),
    applyUrl: String(job?.redirect_url || "").trim(),
    publishedAt: String(job?.created || "").trim(),
    salary: salaryText && job?.salary_is_predicted === "1" ? `${salaryText} (estimated)` : salaryText,
    workModel: String(job?.contract_time || "").replace("_", " ").trim(),
    contractType: String(job?.contract_type || "").trim(),
    category: String(job?.category?.label || "").trim(),
  };
}

export const ADZUNA_LIMITS = { MAX_RESULTS_PER_PAGE, MIN_REQUEST_GAP_MS };
