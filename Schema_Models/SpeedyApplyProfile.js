import mongoose from "mongoose";

// Per-client SpeedyApply autofill data, keyed by the client's dashboard email.
// The SpeedyApply Chrome extension saves the profile a client fills in (name,
// contact, EEO answers, links, etc.), their settings, and their parsed resume
// here so that logging in on any machine restores everything.
//
// The three payloads are stored as opaque blobs (Mixed) — the extension owns
// their exact shape, and the backend never needs to interpret them. Keeping
// them loose means a new field in the extension form needs no schema change.
const SpeedyApplyProfileSchema = new mongoose.Schema(
  {
    clientEmail: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    profile: { type: mongoose.Schema.Types.Mixed, default: null }, // the autofill form fields
    settings: { type: mongoose.Schema.Types.Mixed, default: null }, // toggles / preferences
    resume: { type: mongoose.Schema.Types.Mixed, default: null }, // { name, size, base64, mimeType }
    apiKey: { type: String, default: "" }, // the client's Gemini API key (a field they fill in Settings)
    updatedAt: { type: Date, default: Date.now }
  },
  { collection: "speedyapplyprofiles", minimize: false }
);

export const SpeedyApplyProfile = mongoose.model("SpeedyApplyProfile", SpeedyApplyProfileSchema);
