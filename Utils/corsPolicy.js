/**
 * CORS policy for the dashboard API.
 *
 * WHY THIS REPLACED `app.use(cors())`
 * -----------------------------------
 * A bare cors() emits `Access-Control-Allow-Origin: *`, which means any page on
 * the internet may call this API and READ the response. That is survivable for
 * a public read-only service. It is not what this one is: it serves client
 * records, resumes, Gmail contents and operator tooling behind a Bearer token.
 *
 * `*` also silently forbids credentialed requests — the spec refuses to pair a
 * wildcard with `Access-Control-Allow-Credentials`. So the open policy was
 * simultaneously too permissive for reads and unable to support cookie auth if
 * it were ever wanted. Reflecting a checked origin fixes both.
 *
 * WHAT IS DELIBERATELY ALLOWED
 * ----------------------------
 * Requests with NO Origin header pass. That is not a hole: browsers always send
 * Origin on cross-origin requests, so the header's absence means the caller is
 * not a browser — curl, a health check, a Render cron, server-to-server. CORS
 * cannot defend those and was never the mechanism that did; the Bearer token is.
 * Blocking them would break the platform and protect nothing.
 *
 * chrome-extension:// origins pass. The JR-Direct extension declares
 * `https://*` in host_permissions, so its service worker and side panel already
 * bypass CORS; allowing the scheme costs nothing and covers any future call
 * made from a context that does get checked.
 */

/** Origins that are always allowed, whatever the environment. */
const STATIC_ORIGINS = [
  // Operator + client dashboard
  "https://portal.flashfirejobs.com",
  "https://www.portal.flashfirejobs.com",
  // Marketing site
  "https://flashfirejobs.com",
  "https://www.flashfirejobs.com",
  // Client tracking / applications monitor front end
  "https://clients-tracking.onrender.com",
  // Vercel production aliases
  "https://flashfire-dashboard-frontend.vercel.app",
  "https://flashfire-dashboard.vercel.app",
];

/** Local development. Vite, CRA and the two backends' own ports. */
const DEV_PORTS = [3000, 3001, 4173, 5001, 5173, 5174, 8086];
const DEV_ORIGINS = DEV_PORTS.flatMap((p) => [
  `http://localhost:${p}`,
  `http://127.0.0.1:${p}`,
]);

/**
 * Vercel preview deploys get a generated subdomain per commit, so they cannot be
 * listed one by one. Only previews of THESE projects are accepted — a bare
 * `*.vercel.app` would hand access to every Vercel account on the platform.
 */
const VERCEL_PREVIEW_RX = /^https:\/\/flashfire-[a-z0-9-]+\.vercel\.app$/i;

const normalise = (o) => String(o || "").trim().replace(/\/+$/, "").toLowerCase();

/**
 * Build the allowlist. Reads ALLOWED_ORIGINS (comma-separated) so a new front
 * end can be added on Render without a code change or redeploy.
 */
export function buildAllowedOrigins(env = process.env) {
  const extra = String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map(normalise)
    .filter(Boolean);
  const isProd = (env.NODE_ENV || "development") === "production";
  return new Set([
    ...STATIC_ORIGINS.map(normalise),
    ...(isProd ? [] : DEV_ORIGINS.map(normalise)),
    ...extra,
  ]);
}

/**
 * Decide one origin.
 *
 * @param {string|undefined} origin  the request's Origin header
 * @param {Set<string>} allowed
 * @param {object} env
 * @returns {{ allow: boolean, reason: string }}
 */
export function checkOrigin(origin, allowed, env = process.env) {
  // Escape hatch. If tightening CORS breaks a caller nobody remembered, this
  // restores the old behaviour from the Render dashboard in seconds rather than
  // needing a revert and redeploy while the platform is down.
  if (String(env.CORS_ALLOW_ALL || "") === "1") return { allow: true, reason: "kill-switch" };

  // Not a browser. See the header comment.
  if (!origin) return { allow: true, reason: "no-origin" };

  const o = normalise(origin);
  if (allowed.has(o)) return { allow: true, reason: "allowlist" };
  if (o.startsWith("chrome-extension://")) return { allow: true, reason: "extension" };
  if (VERCEL_PREVIEW_RX.test(o)) return { allow: true, reason: "vercel-preview" };
  return { allow: false, reason: "not-allowed" };
}

/**
 * cors() options. Reflects the request origin when it passes, which is what
 * makes `credentials: true` legal — a wildcard would not be.
 */
export function corsOptions(env = process.env) {
  const allowed = buildAllowedOrigins(env);
  const seenBlocked = new Set();

  console.log(`🔒 CORS allowlist (${allowed.size}): ${[...allowed].join(", ")}`);
  if (String(env.CORS_ALLOW_ALL || "") === "1") {
    console.warn("⚠️  CORS_ALLOW_ALL=1 — every origin is accepted. Unset this once the cause is found.");
  }

  return {
    origin(origin, callback) {
      const { allow, reason } = checkOrigin(origin, allowed, env);
      if (allow) return callback(null, true);
      // Log each unknown origin once. Repeating it per request buries the log
      // during a scripted probe and tells you nothing new.
      if (!seenBlocked.has(origin)) {
        seenBlocked.add(origin);
        console.warn(
          `🚫 CORS blocked "${origin}" (${reason}). If this is ours, add it to ALLOWED_ORIGINS.`
        );
      }
      // `false`, not an Error. Passing an Error turns a routine cross-origin
      // rejection into a 500 in the express error handler; false just omits the
      // header and lets the browser enforce, which is the correct outcome.
      return callback(null, false);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Requested-With",
      "Origin",
      "Accept",
      // Set by the resume + analysis front ends to pick admin-only responses.
      "user-role",
      "User-Role",
    ],
    exposedHeaders: ["Content-Length", "Content-Disposition"],
    optionsSuccessStatus: 204,
    maxAge: 86400,
  };
}
