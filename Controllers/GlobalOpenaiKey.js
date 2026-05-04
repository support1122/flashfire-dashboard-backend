// Global OpenAI key admin endpoints.
//
// GET  /admin/global-openai-key       → { success, keySet, maskedKey, updatedAt }
// POST /admin/global-openai-key       → { success, keySet, maskedKey, updatedAt }
//   body: { openaiKey, updatedBy? }   — empty string clears.
//
// Used by the AI Summaries admin page so ops can drop in one shared OpenAI
// key for every client at once. The JR extension reads it via clientLogin
// (per-profile key takes precedence) and BuildAiSummary falls back to it
// when process.env.OPENAI_API_KEY is unset.

import { AppSettingsModel, getAppSettings } from "../Schema_Models/AppSettings.js";

function mask(key) {
    const k = String(key || "");
    if (k.length <= 8) return k ? "••••" : "";
    return `${k.slice(0, 4)}…${k.slice(-4)}`;
}

export async function GetGlobalOpenaiKey(_req, res) {
    try {
        const doc = await getAppSettings();
        const k = doc.globalOpenaiKey || "";
        return res.json({
            success: true,
            keySet: k.length > 0,
            maskedKey: mask(k),
            updatedAt: doc.updatedAt || null,
            updatedBy: doc.updatedBy || "",
        });
    } catch (err) {
        console.error("GetGlobalOpenaiKey error:", err);
        return res.status(500).json({ success: false, error: "INTERNAL", message: err.message });
    }
}

export async function SetGlobalOpenaiKey(req, res) {
    try {
        const { openaiKey, updatedBy } = req.body || {};
        if (openaiKey != null && typeof openaiKey !== "string") {
            return res.status(400).json({ success: false, error: "BAD_INPUT", message: "openaiKey must be a string" });
        }
        const trimmed = (openaiKey || "").trim();
        if (trimmed && !trimmed.startsWith("sk-")) {
            return res.status(400).json({ success: false, error: "BAD_INPUT", message: "openaiKey must start with sk-" });
        }
        const updated = await AppSettingsModel.findOneAndUpdate(
            { key: "singleton" },
            { $set: { globalOpenaiKey: trimmed, updatedBy: String(updatedBy || "").slice(0, 200) } },
            { new: true, upsert: true, lean: true },
        );
        return res.json({
            success: true,
            keySet: trimmed.length > 0,
            maskedKey: mask(trimmed),
            updatedAt: updated.updatedAt || null,
            updatedBy: updated.updatedBy || "",
        });
    } catch (err) {
        console.error("SetGlobalOpenaiKey error:", err);
        return res.status(500).json({ success: false, error: "INTERNAL", message: err.message });
    }
}
