// "Only these companies" for a client, enforced in the backend.
//
// Some clients want jobs from a fixed list of employers and nothing else
// (Sravani: Walmart, Amazon, Apple, ...). Until now that rule lived only as
// prose in the AI summary, where the judge weighed it like any other signal and
// the extension's parser had to guess it out of free text. Off-list employers
// kept landing on the dashboard. "Included companies" (ClientOperations
// .includedCompanies, edited in the dashboard next to Excluded companies) makes
// it data: when the list is non-empty, every operator push for that client from an employer
// not on it is refused with 403 NOT_ON_COMPANY_ALLOWLIST. Empty list = no rule.
//
// Wired into the same three insert paths as "UK visa sponsors only":
//   /addjob (operator pushes), the Job API run, and saveToDashboard.
// A client adding a job to their own board is never second-guessed.
//
// Matching is biased STRICT, because a false accept is the leak this closes:
//   - every token of the entry is in the job's company ("Warner Bros" matches
//     "Warner Bros. Discovery", "Chase" matches "JPMorgan Chase & Co."), or
//   - the job's company starts with the entry run together, for entries of 6+
//     characters ("JP Morgan" matches "JPMorganChase"). Prefix only: a suffix
//     rule would let "Stripe" match "Pinstripe".
//   - a short alias table for subsidiaries that never carry the parent's name
//     (AWS -> Amazon, Instagram -> Meta, YouTube -> Google, ByteDance -> TikTok).
// "Apple" never matches "Applebee's" and "Meta" never matches "Metaview".

import { ProfileModel } from "../Schema_Models/ProfileModel.js";
import { ClientOperationsModel } from "../Schema_Models/ClientOperationsModel.js";

export const MAX_ALLOWLIST = 300;

const COMPANY_SUFFIX_RE = /\b(?:inc|llc|llp|ltd|limited|corp|corporation|co|plc|gmbh|ag|sa|nv|bv|group|holdings|technologies|technology|labs|systems|solutions|services|software|global|worldwide|international)\b\.?/gi;

// Brand -> employer names that belong to it but do not contain it.
const ALIASES = new Map([
  ["amazon", ["aws", "amazon web services", "whole foods", "zappos", "twitch", "audible"]],
  ["meta", ["facebook", "instagram", "whatsapp", "oculus"]],
  ["google", ["alphabet", "youtube", "deepmind", "waymo", "verily"]],
  ["microsoft", ["linkedin", "github", "activision", "nuance"]],
  ["tiktok", ["bytedance"]],
  ["jp morgan", ["chase", "jpmorgan", "j p morgan"]],
  ["chase", ["jpmorgan", "jp morgan", "j p morgan"]],
  ["paypal", ["venmo", "braintree"]],
  ["salesforce", ["slack", "tableau", "mulesoft"]],
  ["walmart", ["sams club"]],
]);

export function companyTokens(name) {
  return String(name || "")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(COMPANY_SUFFIX_RE, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/** Trimmed, de-duplicated (case-insensitive), capped. Drops blanks. */
export function normalizeAllowlist(list) {
  const out = [];
  const seen = new Set();
  // Ops paste "Walmart, Amazon, Apple" as one entry; a comma never matters
  // here ("Acme, Inc." -> "Acme" + "Inc.", and "Inc." strips to nothing).
  const parts = (Array.isArray(list) ? list : []).flatMap((x) => String(x ?? "").split(/[,\n|]/));
  for (const raw of parts) {
    const name = String(raw ?? "").trim().replace(/\s+/g, " ").slice(0, 80);
    const key = companyTokens(name).join(" ");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length >= MAX_ALLOWLIST) break;
  }
  return out;
}

function entryMatches(entryTokens, jobSet, jobCompact) {
  if (!entryTokens.length) return false;
  if (entryTokens.every((t) => jobSet.has(t))) return true;
  const entryCompact = entryTokens.join("");
  return entryCompact.length >= 6 && jobCompact.startsWith(entryCompact);
}

/** Is `company` one of the employers on `allowlist`? Returns the entry, or null. */
export function matchAllowlist(company, allowlist) {
  const jobTokens = companyTokens(company);
  if (!jobTokens.length) return null;
  const jobSet = new Set(jobTokens);
  const jobCompact = jobTokens.join("");
  for (const entry of allowlist || []) {
    const entryTokens = companyTokens(entry);
    if (entryMatches(entryTokens, jobSet, jobCompact)) return entry;
    for (const alias of ALIASES.get(entryTokens.join(" ")) || []) {
      if (entryMatches(companyTokens(alias), jobSet, jobCompact)) return entry;
    }
  }
  return null;
}

/** The client's included companies, [] when there is no rule. One indexed read. */
export async function loadIncludedCompanies(email, deps = {}) {
  const model = deps.model || ClientOperationsModel;
  const doc = await model.findOne({ clientEmail: String(email || "").toLowerCase().trim() })
    .select("includedCompanies")
    .lean();
  return normalizeAllowlist(doc?.includedCompanies);
}

/**
 * The client's check, or null when the client has no included companies.
 * Pass `list` when it is already loaded; otherwise this reads ClientOperations.
 */
export async function companyAllowlistGate({ email, list }, deps = {}) {
  const names = list !== undefined ? normalizeAllowlist(list) : await loadIncludedCompanies(email, deps);
  if (!names.length) return null;
  return {
    size: names.length,
    check(companyName) {
      if (matchAllowlist(companyName, names)) return null;
      const who = String(companyName || "").trim() || "(no company name)";
      return {
        status: 403,
        error: "NOT_ON_COMPANY_ALLOWLIST",
        message: `${who} is not on this client's included companies (${names.length}). Client only takes jobs from those companies.`,
      };
    },
  };
}

/** null when the push may go ahead, else { status: 403, error, message }. */
export async function companyAllowlistBlock({ email, companyName, list }, deps = {}) {
  const gate = await companyAllowlistGate({ email, list }, deps);
  return gate ? gate.check(companyName) : null;
}

// ---- the AI summary line ------------------------------------------------------
//
// The judge and the extension both read the AI summary, so the list is also
// written there as the one R4b bullet BuildAiSummary already asks the model for
// ("Only scrape jobs from these companies: A, B, C."). This keeps exactly one
// such bullet, always matching the saved list: any older copy (the model's own,
// or one from a previous list) is removed first. It runs when ops save the
// list and as the last step of every summary rebuild, so a rebuild can never
// drop it or bring back a stale version.

const ALLOW_LINE_RE = /^[ \t]*[-*][ \t]*Only scrape jobs from these companies:.*(?:\r?\n|$)/gim;
const HARD_DISQ_RE = /^#{1,3}[ \t]*Hard Disqualifiers[ \t]*$/im;

export function includedCompaniesLine(list) {
  const names = normalizeAllowlist(list);
  return names.length ? `- Only scrape jobs from these companies: ${names.join(", ").replace(/\.$/, "")}.` : "";
}

export function applyIncludedCompaniesToSummary(summary, list) {
  const text = String(summary || "");
  if (!text.trim()) return text;          // nothing built yet; the first build adds it
  let out = text.replace(ALLOW_LINE_RE, "");
  const line = includedCompaniesLine(list);
  if (line) {
    const m = HARD_DISQ_RE.exec(out);
    if (m) {
      const at = m.index + m[0].length;
      out = `${out.slice(0, at)}\n${line}${out.slice(at)}`;
    } else {
      out = `${out.trimEnd()}\n\n# Hard Disqualifiers\n${line}\n`;
    }
  }
  return out.replace(/\n{3,}/g, "\n\n");
}

/**
 * Rewrite the saved AI summary so it carries the current list. No-op when the
 * text would not change or the client has no summary yet. Returns true when
 * it wrote.
 */
export async function syncIncludedCompaniesToSummary(email, list, deps = {}) {
  const model = deps.profileModel || ProfileModel;
  const emailLower = String(email || "").toLowerCase().trim();
  const profile = await model.findOne({ email: emailLower }).select("aiSummary").lean();
  if (!profile?.aiSummary) return false;
  const next = applyIncludedCompaniesToSummary(profile.aiSummary, list);
  if (next === profile.aiSummary) return false;
  await model.updateOne({ _id: profile._id }, { $set: { aiSummary: next } });
  return true;
}
