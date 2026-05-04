// AppSettings: process-wide singleton config that admins can edit at runtime
// without restarting the backend. Currently holds the global OpenAI API key
// shared across every JR-direct extension session + any backend OpenAI call
// that doesn't already have a per-client override. Exactly one document is
// expected — we look it up by `key: 'singleton'`.

import mongoose from "mongoose";

const appSettingsSchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true, default: "singleton" },
    // Plain-text storage: the dashboard backend, the JR extension, and the
    // operator UI all run inside the trusted ops perimeter. Encryption can
    // bolt on later via the existing CryptoHelper if compliance asks.
    globalOpenaiKey: { type: String, default: "" },
    updatedBy: { type: String, default: "" },
}, { timestamps: true });

export const AppSettingsModel = mongoose.model("AppSettings", appSettingsSchema);

// Read-helper. Returns the singleton (creates if missing) so callers can
// always rely on the document existing.
export async function getAppSettings() {
    let doc = await AppSettingsModel.findOne({ key: "singleton" }).lean();
    if (!doc) {
        const created = await AppSettingsModel.create({ key: "singleton" });
        doc = created.toObject();
    }
    return doc;
}
