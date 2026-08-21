/**
 * Canonical key for a job application URL, used to detect the same posting
 * arriving twice for one client.
 *
 * WHY THIS EXISTS
 * ---------------
 * Four code paths create jobs and no two agreed on what "duplicate" meant:
 *
 *   /addjob, /api/jobs          CheckForDuplicateJobs — title + company only
 *   /operations/jobs            no check at all
 *   /storejobanduserdetails     exact string equality on joblink
 *   /extension/saveToDashboard  title + company only
 *
 * So one shared application form (a Tally link, a company careers portal, a
 * Greenhouse board used for several roles) lands once per distinct title, and
 * the operator sees the same URL five times. Exact string equality does not
 * help either: ?utm_source=linkedin, a trailing slash, or a www. prefix each
 * produce a "new" job.
 *
 * This normalises away everything that cannot change which posting a URL points
 * at, and nothing that can.
 *
 * WHAT IS DELIBERATELY KEPT
 * -------------------------
 * Query parameters are the dangerous part. Most ATS platforms put the job
 * identity IN the query string, so stripping the lot would collapse an entire
 * company's board into one key and silently block real jobs. gh_jid (Greenhouse
 * job id), jobId, requisitionId and friends are therefore preserved; only
 * parameters that describe where the click came FROM are removed.
 */

/**
 * Query parameters that record traffic attribution rather than job identity.
 * Removing these is always safe. Adding to this list is not: anything that
 * identifies WHICH job must stay, or two different postings collapse into one
 * key and the second is rejected as a duplicate.
 *
 * Note gh_src is here but gh_jid is NOT. Greenhouse uses gh_src for the source
 * token and gh_jid for the job id; they look alike and mean opposite things.
 */
const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id',
  'utm_name', 'utm_cid', 'utm_reader', 'utm_referrer',
  'gh_src', 'lever_source', 'lever-source', 'ashby_jid_source',
  'ref', 'referer', 'referrer', 'refid', 'source', 'src', 'trk', 'trackingid',
  'fbclid', 'gclid', 'msclkid', 'dclid', 'twclid', 'igshid', 'mc_cid', 'mc_eid',
  '_ga', '_gl', 'yclid', 'wbraid', 'gbraid', 'originalsubdomain',
  'recruiter', 'campaignid', 'adgroupid',
]);

/**
 * Links that carry no identity at all. These are schema defaults and operator
 * placeholders, not real postings, and they repeat across hundreds of rows.
 * They must never be treated as duplicates of one another.
 */
const PLACEHOLDER_RX = /^(?:https?:\/\/)?(?:www\.)?(?:google\.com|example\.com|n\/?a|none|null|undefined|-)\/?$/i;

/**
 * Reduce a job URL to a stable comparison key.
 *
 * Returns '' for anything that cannot identify a posting (empty, whitespace, or
 * a known placeholder). Callers MUST treat '' as "cannot compare" and skip the
 * duplicate check rather than matching all the blanks against each other.
 *
 * @param {unknown} raw
 * @returns {string} canonical key, or '' when the link carries no identity
 */
export function jobLinkKey(raw) {
  const input = String(raw ?? '').trim();
  if (!input) return '';
  if (PLACEHOLDER_RX.test(input)) return '';

  // Scheme detection has to happen BEFORE parsing, and cannot rely on "://".
  // "mailto:jobs@acme.com" has a scheme and no slashes; blindly prepending
  // https:// to it parses the address as userinfo and yields the host acme.com,
  // so a mailto link would have been keyed as though it were that company's
  // careers site. The negative lookahead for a digit keeps "acme.com:8080/jobs"
  // out of this branch, where the colon introduces a port and not a scheme.
  const schemeMatch = input.match(/^([a-z][a-z0-9+.-]*):(?!\d)/i);
  if (schemeMatch && !/^https?$/i.test(schemeMatch[1])) return '';

  let url;
  try {
    // Bare hosts ("careers.acme.com/jobs/1") are common in pasted input and
    // throw without a scheme, so add one before parsing.
    url = new URL(schemeMatch ? input : `https://${input}`);
  } catch {
    // Unparseable. Fall back to a squashed string so two identical pastes still
    // match each other, rather than giving up and allowing the duplicate.
    return input.toLowerCase().replace(/\s+/g, '').replace(/\/+$/, '');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';

  // `host` rather than `hostname` so a non-default port stays in the key. Two
  // services on one machine differing only by port are different sites, and
  // dropping the port would collapse them together.
  const host = url.host.toLowerCase().replace(/^www\./, '');
  if (!host || PLACEHOLDER_RX.test(host)) return '';

  // Trailing slashes are cosmetic. Case in the path is NOT: plenty of ATS
  // routes are case-sensitive, so the path is left exactly as given.
  const path = url.pathname.replace(/\/+$/, '');

  // Sorted so ?a=1&b=2 and ?b=2&a=1 produce one key.
  const params = [];
  for (const [k, v] of url.searchParams) {
    if (TRACKING_PARAMS.has(k.toLowerCase())) continue;
    params.push([k, v]);
  }
  params.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const query = params.map(([k, v]) => `${k}=${v}`).join('&');

  // The fragment is never sent to the server, so it cannot select a posting.
  return query ? `${host}${path}?${query}` : `${host}${path}`;
}

/**
 * Find an existing job for this client with the same canonical link.
 *
 * Scoped to one client on purpose: two clients applying to the same posting is
 * normal and must not be blocked.
 *
 * Returns null when the link carries no identity, so a blank or placeholder URL
 * can never be reported as a duplicate of another blank one.
 *
 * @param {import('mongoose').Model} JobModel
 * @param {string} userID
 * @param {unknown} rawLink
 * @returns {Promise<object|null>} the existing job, or null
 */
export async function findDuplicateByLink(JobModel, userID, rawLink) {
  const key = jobLinkKey(rawLink);
  if (!key) return null;
  const email = String(userID || '').trim().toLowerCase();
  if (!email) return null;

  return JobModel.findOne(
    {
      userID: { $regex: `^${email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' },
      joblinkKey: key,
    },
    { jobID: 1, jobTitle: 1, companyName: 1, joblink: 1, currentStatus: 1, dateAdded: 1 }
  ).lean();
}
