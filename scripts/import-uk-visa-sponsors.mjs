/**
 * Load the UK Home Office sponsor register into the `ukvisasponsors`
 * collection that "UK visa sponsors only" checks against (Utils/ukVisaSponsor.js).
 *
 *   node scripts/import-uk-visa-sponsors.mjs                 # dry run, writes nothing
 *   node scripts/import-uk-visa-sponsors.mjs --apply         # upsert + prune + indexes
 *   node scripts/import-uk-visa-sponsors.mjs --apply --file=/path/uk-visa-sponsors.json
 *
 * The JSON comes from DASH/uk-visa-sponsors/refresh.sh (GOV.UK register CSV +
 * ukvisajobs.com extras). Re-run both after the register updates; it is
 * published daily.
 *
 * What --apply does, in order:
 *   1. builds the indexes the lookup relies on (unique nameKey, multikey
 *      matchKeys, registerDate) BEFORE writing, so a lookup during the import
 *      is never a collection scan;
 *   2. upserts every sponsor by nameKey, stamped with this register's date;
 *   3. deletes rows from older registers - licences that were revoked or
 *      surrendered since the last import. Skipped if step 2 wrote fewer rows
 *      than the file holds, so a half-finished import never empties the table.
 *
 * Reads MONGODB_URI from the environment, or --uri-file=<path> (a file holding
 * only the URI, so it never lands in shell history).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import { UkVisaSponsorModel } from "../Schema_Models/UkVisaSponsorModel.js";
import { companyMatchKeys } from "../Utils/ukVisaSponsor.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const APPLY = process.argv.includes("--apply");
const FILE = arg("file") || path.resolve(here, "../../uk-visa-sponsors/data/uk-visa-sponsors.json");
const BATCH = 2000;

const uriFile = arg("uri-file");
const uri = uriFile ? fs.readFileSync(uriFile, "utf8").trim() : process.env.MONGODB_URI;
if (!uri) {
  console.error("MONGODB_URI is not set (or pass --uri-file=<path>).");
  process.exit(1);
}
if (!fs.existsSync(FILE)) {
  console.error(`No register JSON at ${FILE}. Build it with DASH/uk-visa-sponsors/refresh.sh`);
  process.exit(1);
}

const { meta, sponsors } = JSON.parse(fs.readFileSync(FILE, "utf8"));
if (!meta?.registerDate || !Array.isArray(sponsors) || sponsors.length < 1000) {
  console.error(`Refusing ${FILE}: no registerDate or only ${sponsors?.length ?? 0} sponsors - looks truncated.`);
  process.exit(1);
}

const importedAt = new Date();
const docs = sponsors.map((s) => ({
  nameKey: String(s.name).trim().toLowerCase().replace(/\s+/g, " "),
  name: s.name,
  matchKeys: companyMatchKeys(s.name),
  cities: s.cities || [],
  counties: s.counties || [],
  london: s.london === true,
  routes: s.routes || [],
  skilledWorker: s.skilledWorker === true,
  ratings: s.ratings || [],
  ukvjVerified: s.ukvjVerified === true,
  ukvjJobs: Number(s.ukvjJobs) || 0,
  ukvjNewLicence: s.ukvjNewLicence === true,
  registerDate: meta.registerDate,
  importedAt,
}));

const noKeys = docs.filter((d) => !d.matchKeys.length).length;
console.log(`file:      ${FILE}`);
console.log(`register:  ${meta.registerDate}  sponsors: ${docs.length}  skilled worker: ${docs.filter((d) => d.skilledWorker).length}  without match keys: ${noKeys}`);

await mongoose.connect(uri, { serverSelectionTimeoutMS: 25000 });
const db = mongoose.connection.db;
console.log(`database:  ${db.databaseName}`);
const before = await UkVisaSponsorModel.estimatedDocumentCount();
console.log(`existing:  ${before} rows`);

if (!APPLY) {
  console.log("\nDry run. Re-run with --apply to write.");
  await mongoose.disconnect();
  process.exit(0);
}

const t0 = Date.now();
await UkVisaSponsorModel.createIndexes();
console.log(`indexes:   ${Object.keys(await UkVisaSponsorModel.collection.indexInformation()).join(", ")}`);

let upserted = 0, modified = 0, matched = 0, written = 0;
const batches = [];
for (let i = 0; i < docs.length; i += BATCH) batches.push(docs.slice(i, i + BATCH));
// A few batches in flight at once: one at a time, a remote Atlas cluster spends
// most of the run waiting on round trips (~15 min for the full register).
const PARALLEL = 4;
for (let i = 0; i < batches.length; i += PARALLEL) {
  const results = await Promise.all(batches.slice(i, i + PARALLEL).map((batch) =>
    UkVisaSponsorModel.bulkWrite(batch.map((d) => ({
      updateOne: { filter: { nameKey: d.nameKey }, update: { $set: d }, upsert: true },
    })), { ordered: false })));
  for (const r of results) { upserted += r.upsertedCount; modified += r.modifiedCount; matched += r.matchedCount; }
  written += batches.slice(i, i + PARALLEL).reduce((n, b) => n + b.length, 0);
  console.log(`  written   ${written}/${docs.length}`);
}
console.log(`  upserted ${upserted}, updated ${modified}, unchanged ${matched - modified}`);

const current = await UkVisaSponsorModel.countDocuments({ registerDate: meta.registerDate });
if (current >= docs.length) {
  const pruned = await UkVisaSponsorModel.deleteMany({ registerDate: { $ne: meta.registerDate } });
  console.log(`  pruned ${pruned.deletedCount} rows from older registers`);
} else {
  console.warn(`  NOT pruning: only ${current}/${docs.length} rows carry this register date`);
}

const after = await UkVisaSponsorModel.estimatedDocumentCount();
console.log(`done:      ${after} rows in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
await mongoose.disconnect();
