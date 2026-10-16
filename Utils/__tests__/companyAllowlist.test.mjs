// Covers Utils/companyAllowlist.js - "only these companies" for a client.
//
// What matters is which pushes get through for a client with a list:
//   • the listed employer passes however the job board spells it
//     ("Meta Platforms, Inc.", "JPMorgan Chase & Co.", "Amazon Web Services")
//   • a different business with a similar name does not
//     ("Applebee's", "Metaview", "Pinstripe", "Advisa")
//   • anything off the list is refused with a 403 the extension files as "blocked"
//   • no list = no rule, so every other client is untouched

import test from "node:test";
import assert from "node:assert/strict";
import {
  companyTokens,
  normalizeAllowlist,
  matchAllowlist,
  companyAllowlistGate,
  companyAllowlistBlock,
  loadIncludedCompanies,
  applyIncludedCompaniesToSummary,
  syncIncludedCompaniesToSummary,
} from "../companyAllowlist.js";

// Sravani's list, as ops sent it (Netflix twice included).
const SRAVANI = ["Walmart", "Amazon", "Apple", "Google", "Chase", "Microsoft", "Meta", "Walgreens",
  "Nvidia", "Wells Fargo", "Tesla", "Capital One", "Oracle", "Broadcom", "Uber", "Best Buy",
  "Warner Bros", "Netflix", "Salesforce", "Starbucks", "Visa", "Paypal", "Adobe", "Blackrock",
  "Reddit", "LinkedIn", "Mastercard", "TikTok", "Stripe", "Databricks", "DoorDash", "JP Morgan",
  "American Express", "Goldman Sachs", "Spotify", "Palantir", "Netflix"];

test("companyTokens drops legal forms and punctuation", () => {
  assert.deepEqual(companyTokens("Meta Platforms, Inc."), ["meta", "platforms"]);
  assert.deepEqual(companyTokens("JPMorgan Chase & Co."), ["jpmorgan", "chase", "and"]);
  assert.deepEqual(companyTokens("Warner Bros. Discovery"), ["warner", "bros", "discovery"]);
  assert.deepEqual(companyTokens(""), []);
});

test("normalizeAllowlist trims, drops blanks and duplicates", () => {
  const out = normalizeAllowlist(SRAVANI);
  assert.equal(out.length, 36);
  assert.equal(out.filter((n) => n === "Netflix").length, 1);
  assert.deepEqual(normalizeAllowlist([" Google ", "", null, "google", "Google LLC"]), ["Google"]);
  assert.deepEqual(normalizeAllowlist(undefined), []);
});

test("listed employers pass under the names job boards actually use", () => {
  const list = normalizeAllowlist(SRAVANI);
  for (const [job, entry] of [
    ["Walmart Global Tech", "Walmart"],
    ["Amazon.com Services LLC", "Amazon"],
    ["Amazon Web Services (AWS)", "Amazon"],
    ["AWS", "Amazon"],
    ["Apple Inc.", "Apple"],
    ["Google LLC", "Google"],
    ["YouTube", "Google"],
    ["Meta Platforms, Inc.", "Meta"],
    ["Instagram", "Meta"],
    ["JPMorgan Chase & Co.", "Chase"],
    ["JPMorganChase", "Chase"],
    ["J.P. Morgan", "Chase"],
    ["NVIDIA", "Nvidia"],
    ["Wells Fargo Bank, N.A.", "Wells Fargo"],
    ["Capital One Financial Corporation", "Capital One"],
    ["Warner Bros. Discovery", "Warner Bros"],
    ["Salesforce.com", "Salesforce"],
    ["Visa Inc.", "Visa"],
    ["PayPal", "Paypal"],
    ["BlackRock", "Blackrock"],
    ["TikTok USA", "TikTok"],
    ["ByteDance", "TikTok"],
    ["Stripe", "Stripe"],
    ["American Express Global Business Travel", "American Express"],
    ["The Goldman Sachs Group, Inc.", "Goldman Sachs"],
  ]) {
    assert.equal(matchAllowlist(job, list), entry, job);
  }
});

test("look-alike names stay out", () => {
  const list = normalizeAllowlist(SRAVANI);
  for (const job of ["Applebee's", "Metaview", "Pinstripe", "Advisa", "Teslar Software", "Infosys", "OpenAI", "EY", "U.S. Bank", "Atlassian", "", null]) {
    assert.equal(matchAllowlist(job, list), null, String(job));
  }
});

test("gate is off when the client has no list", async () => {
  assert.equal(await companyAllowlistGate({ email: "c@example.com", list: [] }), null);
  assert.equal(await companyAllowlistGate({ email: "c@example.com", list: null }), null);
  assert.equal(await companyAllowlistBlock({ email: "c@example.com", companyName: "Anyone", list: [] }), null);
});

test("gate reads the client's included companies from ClientOperations", async () => {
  const seen = [];
  const model = { findOne: (q) => { seen.push(q); return { select: () => ({ lean: async () => ({ includedCompanies: ["Google, Meta"] }) }) }; } };
  assert.deepEqual(await loadIncludedCompanies("S@Example.com ", { model }), ["Google", "Meta"]);
  assert.deepEqual(seen[0], { clientEmail: "s@example.com" });
  const blocked = await companyAllowlistBlock({ email: "s@example.com", companyName: "Infosys" }, { model });
  assert.equal(blocked.error, "NOT_ON_COMPANY_ALLOWLIST");
  const none = { findOne: () => ({ select: () => ({ lean: async () => null }) }) };
  assert.equal(await companyAllowlistBlock({ email: "x@example.com", companyName: "Infosys" }, { model: none }), null);
});

test("off-list employer is refused with a 403 the extension files as blocked", async () => {
  const list = SRAVANI;
  assert.equal(await companyAllowlistBlock({ email: "s@example.com", companyName: "Google LLC", list }), null);
  const blocked = await companyAllowlistBlock({ email: "s@example.com", companyName: "Infosys", list });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.error, "NOT_ON_COMPANY_ALLOWLIST");
  assert.match(blocked.message, /Infosys is not on this client's included companies \(36\)/);
});

test("ops can paste the list comma-separated as one entry", () => {
  assert.deepEqual(normalizeAllowlist(["Walmart, Amazon, Apple"]), ["Walmart", "Amazon", "Apple"]);
  assert.deepEqual(normalizeAllowlist(["Acme, Inc."]), ["Acme"]);
});

const SUMMARY = `# Candidate Summary
Backend engineer.

# Strong Signals
- Java — operator priority

# Hard Disqualifiers
- Only scrape jobs from these companies: Deloitte, PwC.
- Skip Cisco jobs.

# Notes for Grader
- none
`;

test("summary carries exactly one allowlist bullet, always the saved list", () => {
  const out = applyIncludedCompaniesToSummary(SUMMARY, ["Google", "Meta"]);
  assert.equal(out.match(/Only scrape jobs from these companies/g).length, 1);
  assert.match(out, /# Hard Disqualifiers\n- Only scrape jobs from these companies: Google, Meta\.\n- Skip Cisco jobs\./);
  assert.ok(!out.includes("Deloitte"));
  // Idempotent: re-applying the same list changes nothing.
  assert.equal(applyIncludedCompaniesToSummary(out, ["Google", "Meta"]), out);
  // Clearing the list removes the bullet and leaves everything else alone.
  const cleared = applyIncludedCompaniesToSummary(out, []);
  assert.ok(!/Only scrape jobs from these companies/.test(cleared));
  assert.match(cleared, /# Hard Disqualifiers\n- Skip Cisco jobs\./);
  // No Hard Disqualifiers section yet: one is added.
  assert.match(applyIncludedCompaniesToSummary("# Candidate Summary\nX\n", ["Google"]),
    /# Hard Disqualifiers\n- Only scrape jobs from these companies: Google\.\n$/);
  // No summary built yet: left empty, the first build adds the bullet.
  assert.equal(applyIncludedCompaniesToSummary("", ["Google"]), "");
});

test("syncIncludedCompaniesToSummary writes only when the text changes", async () => {
  const writes = [];
  let doc = { _id: "p1", aiSummary: SUMMARY };
  const profileModel = {
    findOne: () => ({ select: () => ({ lean: async () => doc }) }),
    updateOne: async (q, u) => { writes.push(u.$set.aiSummary); doc = { ...doc, aiSummary: u.$set.aiSummary }; },
  };
  assert.equal(await syncIncludedCompaniesToSummary("s@example.com", ["Google"], { profileModel }), true);
  assert.equal(await syncIncludedCompaniesToSummary("s@example.com", ["Google"], { profileModel }), false);
  assert.equal(writes.length, 1);
  doc = { _id: "p2", aiSummary: "" };
  assert.equal(await syncIncludedCompaniesToSummary("s@example.com", ["Google"], { profileModel }), false);
});
