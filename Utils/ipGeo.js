// Best-effort IP → "City, Region, Country" resolution for activity logs.
//
// Uses ip-api.com (free, no key, ~45 req/min — logins are far below that).
// Results are cached in-process so repeat IPs cost nothing. Never throws;
// returns "" when it can't resolve (private IP, timeout, rate limit, error).

const CACHE = new Map(); // ip -> { location, at }
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // a day; IP→city rarely changes
const MAX_CACHE = 5000;
const TIMEOUT_MS = 4000;

// Private / local / non-routable ranges we never bother geolocating.
function isPrivateIp(ip) {
  if (!ip) return true;
  const s = String(ip).trim();
  if (s === "::1" || s.startsWith("::ffff:127.") || s.startsWith("127.") || s === "localhost") return true;
  if (s.startsWith("10.") || s.startsWith("192.168.") || s.startsWith("169.254.") || s.startsWith("fc") || s.startsWith("fd")) return true;
  // 172.16.0.0 – 172.31.255.255
  const m = s.match(/^172\.(\d+)\./);
  if (m) {
    const second = parseInt(m[1], 10);
    if (second >= 16 && second <= 31) return true;
  }
  return false;
}

// Normalize a possibly IPv6-mapped IPv4 ("::ffff:1.2.3.4" → "1.2.3.4").
function normalizeIp(ip) {
  const s = String(ip || "").trim();
  const m = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  return m ? m[1] : s;
}

/**
 * Resolve an IP to a human location string. Never throws.
 * @param {string} rawIp
 * @returns {Promise<string>} e.g. "Mumbai, Maharashtra, India" or ""
 */
export async function resolveLocation(rawIp) {
  const ip = normalizeIp(rawIp);
  if (!ip || isPrivateIp(ip)) return "";

  const hit = CACHE.get(ip);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.location;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(
      `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country,regionName,city`,
      { signal: ctrl.signal }
    );
    if (!res.ok) return "";
    const d = await res.json().catch(() => null);
    if (!d || d.status !== "success") return "";
    const location = [d.city, d.regionName, d.country].map((x) => String(x || "").trim()).filter(Boolean).join(", ");
    // Bound the cache.
    if (CACHE.size >= MAX_CACHE) CACHE.clear();
    CACHE.set(ip, { location, at: Date.now() });
    return location;
  } catch {
    return "";
  } finally {
    clearTimeout(timer);
  }
}
