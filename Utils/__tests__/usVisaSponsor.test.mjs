// Covers Utils/usVisaSponsor.js - "US H-1B sponsors only" for US clients.
//
// What matters:
//   • the JS normaliser produces the SAME keys as the Python builder
//     (DASH/us-visa-sponsors/bin/build.py name_key), or lookups silently miss
//   • job-board names find the filer ("Walmart" -> "WAL-MART ASSOCIATES, INC.")
//   • a dead filer never shadows a live one ("Meta" is also "META Company", 2017)
//   • look-alikes stay out ("Applebees", "Pinstripe")
//   • the gate only applies to US clients with the switch on, and fails closed
//     when the data is not loaded

import test from "node:test";
import assert from "node:assert/strict";
import {
  usNameKey,
  usQueryKeys,
  buildUsSponsorIndex,
  setUsSponsorIndex,
  lookupUsSponsor,
  usSponsorGate,
  usSponsorPushBlock,
  usSponsorStatus,
} from "../usVisaSponsor.js";

// Produced by build.py name_key() on 2026-10-20. Change both sides together.
const PYTHON_KEYS = [
  ["Amazon.com Services LLC", "amazoncom services"],
  ["WAL-MART ASSOCIATES, INC.", "wal mart associates"],
  ["JPMorgan Chase & Co.", "jpmorgan chase"],
  ["J.P. Morgan Securities LLC", "jp morgan securities"],
  ["Meta Platforms, Inc", "meta platforms"],
  ["Google LLC", "google"],
  ["The Coca-Cola Company", "coca cola"],
  ["Macy’s, Inc.", "macys"],
  ["Nestlé USA, Inc.", "nestle"],
  ["¿¿89 Solutions USA, Inc.¿", "89 solutions"],
  ['"?WHAT IF! USA LTD', "what if"],
  ["Ernst & Young U.S. LLP", "ernst and young"],
  ["TATA CONSULTANCY SERVICES LIMITED", "tata consultancy services"],
  ["The Group Ltd", "group"],
  ["Bank of America, N.A.", "bank of america"],
  ["AT&T Services, Inc.", "at and t services"],
  ["McKinsey & Company, Inc. United States", "mckinsey and united states"],
  ["PwC US Consulting LLP", "pwc consulting"],
  ["Siemens Americas, LLC", "siemens americas"],
  ["and", "and"],
];

test("usNameKey matches the Python builder key for key", () => {
  for (const [name, key] of PYTHON_KEYS) assert.equal(usNameKey(name), key, name);
  assert.equal(usNameKey(""), "");
  assert.equal(usNameKey(null), "");
});

test("query keys add a hyphen-joined and a parenthesis-free spelling", () => {
  assert.deepEqual(usQueryKeys("Wal-Mart"), ["wal mart", "walmart"]);
  assert.ok(usQueryKeys("Amazon Web Services (AWS)").includes("amazon web services"));
});

// [name, matchKeys, lastH1bFiling, recentH1b, h1bFilings, domain] - the file's row shape.
const row = (name, last, recent = 0, filings = 1) => {
  const keys = [...new Set([usNameKey(name), usNameKey(name.replace(/-/g, ""))])];
  return [name, keys, last, recent, filings, null];
};
const FIXTURE = {
  meta: { builtAt: "2026-10-20T00:00:00Z" },
  rows: [
    row("Google LLC", "2026-06-29", 8234, 64399),
    row("META Company", "2017-05-31", 0, 1),
    row("Meta Platforms, Inc", "2026-06-23", 6006, 23042),
    row("Amazon CORP LLC", "2017-01-24", 0, 1),
    row("Amazon Web Services, Inc.", "2026-06-23", 2979, 18619),
    row("WAL-MART ASSOCIATES, INC.", "2026-06-23", 2934, 21483),
    row("JPMorgan Chase & Co.", "2026-06-23", 3357, 21520),
    row("Apple Inc.", "2026-06-30", 7058, 30000),
    row("Old Widgets Inc", "2019-03-01", 0, 4),
  ],
};
const install = () => setUsSponsorIndex(buildUsSponsorIndex(FIXTURE, { since: "2024-10-01" }));

test("job-board names find the filer", () => {
  install();
  const cases = [
    ["Google", "exact", "Google LLC"],
    ["Walmart", "prefix", "WAL-MART ASSOCIATES, INC."],
    ["Walmart Global Tech", "prefix", "WAL-MART ASSOCIATES, INC."],
    ["JP Morgan", "prefix", "JPMorgan Chase & Co."],
    ["Chase", "alias", "JPMorgan Chase & Co."],
    ["Facebook", "alias", "Meta Platforms, Inc"],
    ["Amazon Web Services (AWS)", "exact", "Amazon Web Services, Inc."],
  ];
  for (const [job, match, name] of cases) {
    const r = lookupUsSponsor(job);
    assert.deepEqual([r.sponsor, r.match, r.name], [true, match, name], job);
  }
});

test("a dead filer never shadows a live one", () => {
  install();
  assert.equal(lookupUsSponsor("Meta").name, "Meta Platforms, Inc");
  assert.equal(lookupUsSponsor("Amazon").name, "Amazon Web Services, Inc.");
  const old = lookupUsSponsor("Old Widgets");
  assert.deepEqual([old.sponsor, old.reason, old.lastH1bFiling], [false, "NO_RECENT_H1B", "2019-03-01"]);
});

test("look-alikes and unknowns stay out", () => {
  install();
  for (const job of ["Applebees", "Pinstripe", "Random Startup Inc"]) {
    assert.equal(lookupUsSponsor(job).reason, "NOT_AN_H1B_FILER", job);
  }
  assert.equal(lookupUsSponsor("").reason, "NO_COMPANY_NAME");
});

const trackingOf = (doc) => ({ findOne: async () => doc });

test("gate applies only to US clients with the switch on", async () => {
  install();
  const us = trackingOf({ clientCountry: "USA" });
  const email = "c@example.com";
  assert.equal(await usSponsorGate({ email, profile: { usSponsorOnly: false } }, { collection: us }), null);
  assert.equal(await usSponsorGate({ email, profile: null }, { collection: us }), null);
  // Re-tagged to the UK after the switch was turned on: not enforced.
  assert.equal(await usSponsorGate({ email, profile: { usSponsorOnly: true } }, { collection: trackingOf({ clientCountry: "UK" }) }), null);
  // A "$" payment with no country set counts as US, like clients-tracking.
  const dollar = trackingOf({ amountPaid: "$299" });
  assert.ok(await usSponsorGate({ email, profile: { usSponsorOnly: true } }, { collection: dollar }));

  const on = { usSponsorOnly: true };
  assert.equal(await usSponsorPushBlock({ email, companyName: "Google", profile: on }, { collection: us }), null);
  const blocked = await usSponsorPushBlock({ email, companyName: "Random Startup Inc", profile: on }, { collection: us });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.error, "NOT_US_H1B_SPONSOR");
  assert.match(blocked.message, /no H-1B filings/);
  const stale = await usSponsorPushBlock({ email, companyName: "Old Widgets", profile: on }, { collection: us });
  assert.match(stale.message, /last filed an H-1B on 2019-03-01/);
});

test("opted-in client with no data loaded is refused, not waved through", async () => {
  setUsSponsorIndex(null);
  const { loadUsSponsors } = await import("../usVisaSponsor.js");
  assert.throws(() => loadUsSponsors({ file: "/nonexistent/us-h1b-sponsors.json.gz" }));
  assert.equal(usSponsorStatus().loaded, false);
  install();
  assert.equal(usSponsorStatus().loaded, true);
});
