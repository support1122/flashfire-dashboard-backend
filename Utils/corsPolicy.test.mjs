// node Utils/corsPolicy.test.mjs
//
// The risk here is asymmetric. A missed origin takes a production front end
// offline; an extra one is a policy weakness. So the "must ALLOW" block is the
// one that matters, and it lists every caller found in the repos.
import { buildAllowedOrigins, checkOrigin, corsOptions } from "./corsPolicy.js";

let pass = 0, fail = 0;
const t = (name, got, want) => {
  const ok = got === want;
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) console.log(`        got ${got}  want ${want}`);
};

const PROD = { NODE_ENV: "production" };
const DEV = { NODE_ENV: "development" };
const allow = (origin, env = PROD) => checkOrigin(origin, buildAllowedOrigins(env), env).allow;

console.log("--- must ALLOW: real callers found in the repos ---");
for (const o of [
  "https://portal.flashfirejobs.com",          // dashboard frontend
  "https://www.portal.flashfirejobs.com",
  "https://flashfirejobs.com",
  "https://www.flashfirejobs.com",             // marketing site
  "https://clients-tracking.onrender.com",     // applications monitor frontend
  "https://flashfire-dashboard-frontend.vercel.app",
  "https://flashfire-dashboard.vercel.app",
]) t(o, allow(o), true);

console.log("\n--- must ALLOW: non-browser callers ---");
// Browsers ALWAYS send Origin cross-origin, so its absence means not-a-browser.
t("no Origin (curl / cron / server-to-server)", allow(undefined), true);
t("empty Origin", allow(""), true);
t("chrome extension (JR-Direct)", allow("chrome-extension://feekbkgobkhnfchgngipimimiiglgpnj"), true);
t("any chrome extension", allow("chrome-extension://abcdefghijklmnop"), true);
t("vercel preview of our project", allow("https://flashfire-dashboard-git-abc123.vercel.app"), true);

console.log("\n--- must ALLOW in dev, NOT in prod ---");
t("localhost:5173 in dev", allow("http://localhost:5173", DEV), true);
t("localhost:3000 in dev", allow("http://localhost:3000", DEV), true);
t("127.0.0.1:8086 in dev", allow("http://127.0.0.1:8086", DEV), true);
t("localhost:5173 in PROD", allow("http://localhost:5173", PROD), false);

console.log("\n--- must BLOCK ---");
for (const o of [
  "https://evil.com",
  "http://portal.flashfirejobs.com",              // downgraded to http
  "https://portal.flashfirejobs.com.evil.com",    // suffix attack
  "https://evilportal.flashfirejobs.com",         // not a real subdomain of ours
  "https://someone-else.vercel.app",              // another Vercel account
  "https://flashfire.evil.vercel.app.attacker.io",
  "null",                                          // sandboxed iframe
]) t(`block ${o}`, allow(o), false);

console.log("\n--- normalisation ---");
t("trailing slash", allow("https://portal.flashfirejobs.com/"), true);
t("uppercase host", allow("HTTPS://PORTAL.FLASHFIREJOBS.COM"), true);
t("surrounding space", allow("  https://portal.flashfirejobs.com  "), true);

console.log("\n--- ALLOWED_ORIGINS env extends without a redeploy ---");
const withExtra = { NODE_ENV: "production", ALLOWED_ORIGINS: "https://new-app.example.com, https://other.example.com" };
t("env origin allowed", allow("https://new-app.example.com", withExtra), true);
t("second env origin", allow("https://other.example.com", withExtra), true);
t("still blocks others", allow("https://evil.com", withExtra), false);

console.log("\n--- kill switch ---");
const killed = { NODE_ENV: "production", CORS_ALLOW_ALL: "1" };
t("CORS_ALLOW_ALL=1 lets anything through", allow("https://evil.com", killed), true);
t("CORS_ALLOW_ALL=0 does not", allow("https://evil.com", { NODE_ENV: "production", CORS_ALLOW_ALL: "0" }), false);

console.log("\n--- options shape ---");
const opt = corsOptions(PROD);
t("credentials enabled", opt.credentials, true);
t("Authorization header allowed", opt.allowedHeaders.includes("Authorization"), true);
t("user-role header allowed", opt.allowedHeaders.includes("user-role"), true);
t("preflight 204", opt.optionsSuccessStatus, 204);
// callback(null,false) not callback(Error) — an Error would 500 instead of just
// omitting the header and letting the browser enforce.
let cbErr = "unset", cbVal = "unset";
opt.origin("https://evil.com", (e, v) => { cbErr = e; cbVal = v; });
t("blocked -> no Error", cbErr, null);
t("blocked -> false", cbVal, false);
opt.origin("https://portal.flashfirejobs.com", (e, v) => { cbErr = e; cbVal = v; });
t("allowed -> true", cbVal, true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
