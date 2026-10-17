// The apply-URL policy: which links may be pushed onto a client's board.
//
// Two different reasons a link is refused, kept apart because they need
// different answers from the operator.
//
// 1. AGGREGATOR / UNRESOLVED: a job board, or a jobright.ai /jobs/info/<id>
//    link, which means the employer apply URL never resolved. The operator
//    CAN fix these by getting the real URL.
// 2. EXCLUDED EMPLOYER: the employer's own careers site, on the
//    do-not-apply list by operator policy. Nothing is wrong with the link and
//    there is no better one to fetch, so the refusal says so instead of
//    telling the operator to find a URL that does not exist.
//
// Both lists come from the environment. Adding or removing a portal is a
// config change and a restart, never a code edit:
//
//   BLOCKED_APPLY_HOSTS=linkedin.com,dice.com,indeed.com,jobright.ai
//   EXCLUDED_EMPLOYER_HOSTS=jobs.apple.com,lifeattiktok.com
//
// A hostname matches itself and its subdomains, so "dice.com" covers
// "www.dice.com". Matching is exact on the label boundary, so "notdice.com"
// is not blocked.
//
// This used to live inline in Controllers/AddJob.js. It moved here so the
// job-API imports (Adzuna, Indeed) answer to the same policy as an operator's
// push instead of writing straight past it.

export const DEFAULT_BLOCKED_APPLY_HOSTS = "jobright.ai,linkedin.com,dice.com,indeed.com";
export const DEFAULT_EXCLUDED_EMPLOYER_HOSTS =
  "lifeattiktok.com,dataannotation.tech,jobs.apple.com,humana.wd5.myworkdayjobs.com,dickssportinggoods.com";

function hostList(raw, fallback) {
  return String(raw ?? fallback)
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

function matchesHost(host, list) {
  return !!host && list.some((h) => host === h || host.endsWith(`.${h}`));
}

/**
 * Classify one apply link.
 *
 * @returns {{ verdict: "allowed" | "BLOCKED_SOURCE" | "EXCLUDED_EMPLOYER", host: string }}
 *   `host` is "" when the URL could not be parsed.
 *
 * The lists are read on every call rather than once at import, so a test, or
 * an operator who edits the environment and restarts, gets the current value.
 */
export function classifyApplyUrl(url, env = process.env) {
  const joblinkRaw = String(url || "");
  const aggregators = hostList(env.BLOCKED_APPLY_HOSTS, DEFAULT_BLOCKED_APPLY_HOSTS);
  const excluded = hostList(env.EXCLUDED_EMPLOYER_HOSTS, DEFAULT_EXCLUDED_EMPLOYER_HOSTS);

  let host = "";
  try { host = new URL(joblinkRaw).hostname.toLowerCase(); } catch { host = ""; }
  // Unparseable URL: fall back to a substring check so a malformed link
  // cannot smuggle a blocked host through.
  const loose = (list) => list.some((h) => joblinkRaw.toLowerCase().includes(h));
  const hit = (list) => (host ? matchesHost(host, list) : loose(list));

  if (hit(aggregators)) return { verdict: "BLOCKED_SOURCE", host };
  if (hit(excluded)) return { verdict: "EXCLUDED_EMPLOYER", host };
  return { verdict: "allowed", host };
}
