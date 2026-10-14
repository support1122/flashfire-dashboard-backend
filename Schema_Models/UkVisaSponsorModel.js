// UkVisaSponsorModel: one document per employer on the UK Home Office
// "Register of licensed sponsors: workers" (GOV.UK, refreshed daily).
//
// Written only by scripts/import-uk-visa-sponsors.mjs, from the JSON that
// DASH/uk-visa-sponsors/refresh.sh builds. Read by Utils/ukVisaSponsor.js, which
// gates pushes for UK clients who have "UK visa sponsors only" switched on.
//
// matchKeys is what lookups hit. It holds the normalised forms of the name
// (legal suffixes stripped, "t/a" split into both names), produced by
// companyMatchKeys() so the importer and the lookup can never normalise
// differently. A multikey index on it makes the exact lookup a single index
// seek and the brand-prefix lookup ("barclays" -> "barclays bank") a bounded
// range scan instead of a collection scan over ~127k documents.

import mongoose from "mongoose";

export const UK_VISA_SPONSOR_COLLECTION = "ukvisasponsors";

const UkVisaSponsorSchema = new mongoose.Schema(
  {
    // Lowercased, whitespace-collapsed register name. One document per value.
    nameKey: { type: String, required: true },
    // Display name, as ukvisajobs.com shows it.
    name: { type: String, required: true },
    matchKeys: { type: [String], default: [] },
    cities: { type: [String], default: [] },
    counties: { type: [String], default: [] },
    london: { type: Boolean, default: false },
    routes: { type: [String], default: [] },
    // True when the licence covers the Skilled Worker route, which is the one
    // a sponsored job offer actually needs. Licences for religious, charity or
    // sportsperson routes alone cannot sponsor an ordinary job.
    skilledWorker: { type: Boolean, default: false },
    ratings: { type: [String], default: [] },
    // From ukvisajobs.com: the employer is posting sponsored jobs right now.
    ukvjVerified: { type: Boolean, default: false },
    ukvjJobs: { type: Number, default: 0 },
    ukvjNewLicence: { type: Boolean, default: false },
    // Register edition this row came from, e.g. "13 October 2026". The importer
    // deletes rows whose edition is older, so a revoked licence drops out.
    registerDate: { type: String, required: true },
    importedAt: { type: Date, default: null },
  },
  { collection: UK_VISA_SPONSOR_COLLECTION, timestamps: false, versionKey: false },
);

UkVisaSponsorSchema.index({ nameKey: 1 }, { unique: true });
UkVisaSponsorSchema.index({ matchKeys: 1 });
UkVisaSponsorSchema.index({ registerDate: 1 });
// Per-place sponsor counts on the clients-tracking card ("how many sponsors in
// Manchester?"). Case-insensitive collation so "manchester" and "Manchester"
// hit the same index; queries must pass CITY_COLLATION to use it.
export const CITY_COLLATION = { locale: "en", strength: 2 };
UkVisaSponsorSchema.index({ cities: 1, skilledWorker: 1 }, { collation: CITY_COLLATION });
UkVisaSponsorSchema.index({ london: 1, skilledWorker: 1 });

export const UkVisaSponsorModel =
  mongoose.models.UkVisaSponsor || mongoose.model("UkVisaSponsor", UkVisaSponsorSchema);
