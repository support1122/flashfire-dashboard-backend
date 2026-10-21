// Covers Utils/ukVisaSponsor.js - "UK visa sponsors only" for UK clients.
//
// What matters is which pushes get through:
//   • a job from a register employer passes, however the job board spells it
//     ("Barclays" vs "Barclays Bank PLC", "Ernst & Young" vs "ERNST & YOUNG LLP")
//   • a different business that merely starts with the same word does not
//     ("Apple" must not match "Apple Tree Care Ltd")
//   • a licence without the Skilled Worker route does not count
//   • the gate only applies to UK clients with the switch on
//   • an empty register refuses loudly instead of blocking everything quietly
//
// The register is an in-memory double that answers the two query shapes the
// lookup uses ($in on matchKeys, anchored $regex on matchKeys), so no database.

import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeCompany,
  companyMatchKeys,
  lookupUkSponsor,
  findUkSponsor,
  clearUkSponsorCache,
  deriveClientCountry,
  ukSponsorGate,
  ukSponsorPushBlock,
  sponsorCountsForPlaces,
} from "../ukVisaSponsor.js";

function registerOf(rows) {
  const docs = rows.map((r) => ({
    skilledWorker: true, ukvjVerified: false, routes: ["Skilled Worker"], ...r,
    matchKeys: companyMatchKeys(r.name),
  }));
  let queries = 0;
  const matches = (doc, q) => {
    const c = q.matchKeys;
    if (c.$in) return doc.matchKeys.some((k) => c.$in.includes(k));
    if (c.$regex) { const rx = new RegExp(c.$regex); return doc.matchKeys.some((k) => rx.test(k)); }
    return false;
  };
  return {
    get queries() { return queries; },
    estimatedDocumentCount: async () => docs.length,
    find(q) {
      queries += 1;
      const out = docs.filter((d) => matches(d, q));
      const chain = { select: () => chain, limit: () => chain, lean: async () => out };
      return chain;
    },
  };
}

const trackingOf = (doc) => ({ findOne: async () => doc });

test("normalizeCompany drops legal forms, punctuation and accents", () => {
  assert.equal(normalizeCompany("Accenture (UK) Limited"), "accenture");
  assert.equal(normalizeCompany("ERNST & YOUNG LLP"), "ernst and young");
  assert.equal(normalizeCompany("Ernst & Young"), "ernst and young");
  assert.equal(normalizeCompany("Antobot Ltd."), "antobot");
  assert.equal(normalizeCompany("McDonald's Restaurants Ltd"), "mcdonalds restaurants");
  assert.equal(normalizeCompany("Nestlé UK Ltd"), "nestle");
  assert.equal(normalizeCompany("John Lewis & Co"), "john lewis");
  // Nothing but legal words: keep them rather than return an empty key.
  assert.equal(normalizeCompany("The Group Ltd"), "the group ltd");
  assert.equal(normalizeCompany(""), "");
  assert.equal(normalizeCompany(null), "");
});

test("companyMatchKeys splits trading-as names into both", () => {
  assert.deepEqual(
    companyMatchKeys("Premier Risk Limited t/a Premier Risk Services"),
    ["premier risk t a premier risk services", "premier risk", "premier risk services"],
  );
  assert.ok(companyMatchKeys("Crazy Tykes Ltd T/A Crazy Tykes").includes("crazy tykes"));
  assert.ok(companyMatchKeys("Foo Limited trading as Bar Digital").includes("bar digital"));
});

test("exact match survives different spellings of the same employer", async () => {
  const model = registerOf([{ name: "ERNST & YOUNG LLP" }, { name: "Deloitte LLP", ukvjVerified: true }]);
  for (const job of ["Ernst & Young", "Ernst and Young LLP", "ernst & young llp"]) {
    const r = await lookupUkSponsor(job, { model });
    assert.equal(r.sponsor, true, job);
    assert.equal(r.match, "exact", job);
  }
  const d = await lookupUkSponsor("Deloitte", { model });
  assert.deepEqual([d.sponsor, d.match, d.ukvjVerified], [true, "exact", true]);
});

test("brand prefix matches only when the extra words are generic", async () => {
  const model = registerOf([
    { name: "Barclays Bank PLC" },
    { name: "Amazon UK Services Ltd" },
    { name: "Apple Tree Care Ltd" },
  ]);
  const barclays = await lookupUkSponsor("Barclays", { model });
  assert.deepEqual([barclays.sponsor, barclays.match, barclays.name], [true, "prefix", "Barclays Bank PLC"]);
  const amazon = await lookupUkSponsor("Amazon", { model });
  assert.deepEqual([amazon.sponsor, amazon.match], [true, "prefix"]);
  // "tree care" changes the business: Apple Inc. is not that care home.
  const apple = await lookupUkSponsor("Apple", { model });
  assert.deepEqual([apple.sponsor, apple.reason], [false, "NOT_ON_REGISTER"]);
});

test("a licence without the Skilled Worker route does not count", async () => {
  const model = registerOf([
    { name: "St Mary's Church", skilledWorker: false, routes: ["Religious Worker"] },
  ]);
  const r = await lookupUkSponsor("St Mary's Church", { model });
  assert.deepEqual([r.sponsor, r.match, r.reason], [false, "exact", "NO_SKILLED_WORKER_ROUTE"]);
});

test("unknown employers and blank names are not sponsors", async () => {
  const model = registerOf([{ name: "Deloitte LLP" }]);
  assert.equal((await lookupUkSponsor("Totally Unknown Widgets", { model })).reason, "NOT_ON_REGISTER");
  assert.equal((await lookupUkSponsor("", { model })).reason, "NO_COMPANY_NAME");
  // Two letters is too short to prefix-match safely.
  const short = registerOf([{ name: "BT Group PLC" }, { name: "BT Pension Scheme Management" }]);
  assert.equal((await lookupUkSponsor("BT", { model: short })).match, "exact");
});

test("findUkSponsor caches, so a repeat employer costs no query", async () => {
  clearUkSponsorCache();
  const model = registerOf([{ name: "Deloitte LLP" }]);
  await findUkSponsor("Deloitte", { model });
  const after = model.queries;
  await findUkSponsor("Deloitte LLP", { model });   // same keys -> same cache entry
  await findUkSponsor("deloitte", { model });
  assert.equal(model.queries, after);
  clearUkSponsorCache();
});

test("deriveClientCountry mirrors clients-tracking: field first, then £ amountPaid", () => {
  assert.deepEqual(deriveClientCountry({ clientCountry: "UK" }), { country: "UK", source: "clientCountry" });
  assert.deepEqual(deriveClientCountry({ amountPaid: "£419" }), { country: "UK", source: "amountPaid" });
  // An explicit country wins over the payment currency.
  assert.deepEqual(deriveClientCountry({ clientCountry: "USA", amountPaid: "£419" }), { country: "USA", source: "clientCountry" });
  // Same payment fallbacks as clients-tracking: $ / ₹ -> USA, CAD, AUD, €.
  assert.deepEqual(deriveClientCountry({ amountPaid: "$299" }), { country: "USA", source: "amountPaid" });
  assert.deepEqual(deriveClientCountry({ amountPaid: "CAD 399" }), { country: "Canada", source: "amountPaid" });
  assert.deepEqual(deriveClientCountry({ amountPaid: "" }), { country: null, source: null });
  assert.deepEqual(deriveClientCountry(null), { country: null, source: null });
});

test("gate applies only to UK clients with the switch on", async () => {
  clearUkSponsorCache();
  const model = registerOf([{ name: "Deloitte LLP" }]);
  const uk = trackingOf({ clientCountry: "UK" });
  const email = "c@example.com";

  assert.equal(await ukSponsorGate({ email, profile: { ukSponsorOnly: false } }, { model, collection: uk }), null);
  assert.equal(await ukSponsorGate({ email, profile: null }, { model, collection: uk }), null);
  // Switch left on after ops re-tagged the client to the US: not enforced.
  assert.equal(
    await ukSponsorGate({ email, profile: { ukSponsorOnly: true } }, { model, collection: trackingOf({ clientCountry: "USA" }) }),
    null,
  );

  const on = { ukSponsorOnly: true };
  assert.equal(await ukSponsorPushBlock({ email, companyName: "Deloitte", profile: on }, { model, collection: uk }), null);
  const blocked = await ukSponsorPushBlock({ email, companyName: "Random Startup Inc", profile: on }, { model, collection: uk });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.error, "NOT_UK_VISA_SPONSOR");
  assert.match(blocked.message, /Random Startup Inc is not on the Home Office register/);
  clearUkSponsorCache();
});

test("an empty register refuses loudly instead of blocking every job", async () => {
  clearUkSponsorCache();
  const empty = registerOf([]);
  await assert.rejects(
    ukSponsorGate({ email: "c@example.com", profile: { ukSponsorOnly: true } },
      { model: empty, collection: trackingOf({ clientCountry: "UK" }) }),
    (e) => e.code === "SPONSOR_REGISTER_EMPTY",
  );
  clearUkSponsorCache();
});

test("preferred locations become places with sponsor counts", async () => {
  const counts = { manchester: 2890, leeds: 1085 };
  const calls = [];
  const model = {
    countDocuments: async (q, opts) => {
      calls.push({ q, opts });
      if (q.london) return 47000;
      return counts[String(q.cities).toLowerCase()] || 0;
    },
  };
  const out = await sponsorCountsForPlaces(
    ["London, UK", "Manchester / Leeds", "Remote", "Scotland", "Dubai", "manchester"],
    { model },
  );
  assert.deepEqual(out, [
    { place: "London", kind: "london", sponsors: 47000 },
    { place: "Manchester", kind: "city", sponsors: 2890 },
    { place: "Leeds", kind: "city", sponsors: 1085 },
    { place: "Scotland", kind: "nation", sponsors: null },
    { place: "Dubai", kind: "other", sponsors: 0 },
  ]);
  // City counts go through the case-insensitive collation the index uses.
  assert.ok(calls.filter((c) => c.q.cities).every((c) => c.opts?.collation?.strength === 2));
  assert.deepEqual(await sponsorCountsForPlaces(undefined, { model }), []);
  // Nothing narrower given: the whole-UK chip stays.
  assert.deepEqual(await sponsorCountsForPlaces(["United Kingdom", "Remote"], { model }),
    [{ place: "Whole UK", kind: "uk", sponsors: null }]);
});

test("the register's own name beats a t/a trading name", async () => {
  // Live data: "Amazon" used to land on a restaurant trading as "The Amazon".
  const model = registerOf([
    { name: "Maxico Uk limited t/a The Amazon" },
    { name: "Amazon UK Services Ltd", ukvjVerified: true },
    { name: "Amazon Filters Ltd", ukvjVerified: true },
  ]);
  const r = await lookupUkSponsor("Amazon", { model });
  assert.deepEqual([r.sponsor, r.match, r.name], [true, "prefix", "Amazon UK Services Ltd"]);
  // With nothing better, the trading name still counts.
  const only = registerOf([{ name: "Maxico Uk limited t/a The Amazon" }]);
  assert.equal((await lookupUkSponsor("The Amazon", { model: only })).name, "Maxico Uk limited t/a The Amazon");
});

test("spaced-out brands and shop words match the register spelling", async () => {
  const model = registerOf([
    { name: "JPMorgan Chase Bank, National Association" },
    { name: "Tesco Stores Limited" },
    { name: "Tescon Business & Process Consultancy Limited" },
  ]);
  const jp = await lookupUkSponsor("JP Morgan", { model });
  assert.deepEqual([jp.sponsor, jp.name], [true, "JPMorgan Chase Bank, National Association"]);
  assert.equal((await lookupUkSponsor("J.P. Morgan", { model })).sponsor, true);   // dots join to "jp morgan"
  const tesco = await lookupUkSponsor("Tesco", { model });
  assert.deepEqual([tesco.sponsor, tesco.name], [true, "Tesco Stores Limited"]);
  const lloyds = registerOf([{ name: "Lloyds Bank plc" }, { name: "Lloyds Ceramics Ltd" }]);
  assert.equal((await lookupUkSponsor("Lloyds Banking Group", { model: lloyds })).name, "Lloyds Bank plc");
  // A one-word query never uses the joined-brand rule, so "Tescon" stays separate.
  assert.equal((await lookupUkSponsor("Tescon", { model })).sponsor, false);
});
