// SaveAiNotes: persist a free-text "Notes to AI" block per client. Read on
// every BuildAiSummary call and injected into the user prompt as authoritative
// operator guidance.
//
// Endpoints:
//   POST /save-ai-notes   { email, text, updatedBy? }   → { success, notes }
//   GET  /ai-notes?email= → { success, notes }
//
// Schema fields live under aiNotes.{text,updatedAt,updatedBy} on ProfileModel.

import { ProfileModel } from "../Schema_Models/ProfileModel.js";

const MAX_NOTES_CHARS = 4000;

function lower(email) {
    return String(email || "").toLowerCase();
}

export async function SaveAiNotes(req, res) {
    try {
        const { email, text, updatedBy } = req.body || {};
        if (!email || typeof email !== "string" || !email.includes("@")) {
            return res.status(400).json({ success: false, error: "BAD_INPUT", message: "email is required" });
        }
        if (typeof text !== "string") {
            return res.status(400).json({ success: false, error: "BAD_INPUT", message: "text must be a string" });
        }
        const trimmed = text.slice(0, MAX_NOTES_CHARS);
        const now = new Date();
        const profile = await ProfileModel.findOneAndUpdate(
            { email: lower(email) },
            {
                $set: {
                    "aiNotes.text": trimmed,
                    "aiNotes.updatedAt": now,
                    "aiNotes.updatedBy": String(updatedBy || "").slice(0, 80),
                },
            },
            { new: true, lean: true },
        );
        if (!profile) {
            return res.status(404).json({ success: false, error: "PROFILE_NOT_FOUND", message: `no profile for ${email}` });
        }
        return res.json({
            success: true,
            message: trimmed
                ? `Notes saved (${trimmed.length} chars). Next BuildAiSummary call will use them.`
                : "Notes cleared.",
            notes: {
                text: profile.aiNotes?.text || "",
                updatedAt: profile.aiNotes?.updatedAt ? new Date(profile.aiNotes.updatedAt).toISOString() : null,
                updatedBy: profile.aiNotes?.updatedBy || "",
                charCount: (profile.aiNotes?.text || "").length,
            },
        });
    } catch (err) {
        console.error("SaveAiNotes error:", err);
        return res.status(500).json({ success: false, error: "INTERNAL", message: err.message });
    }
}

export async function GetAiNotes(req, res) {
    try {
        const email = req.query?.email;
        if (!email || typeof email !== "string" || !email.includes("@")) {
            return res.status(400).json({ success: false, error: "BAD_INPUT", message: "email is required" });
        }
        const profile = await ProfileModel.findOne({ email: lower(email) }).lean();
        if (!profile) {
            return res.status(404).json({ success: false, error: "PROFILE_NOT_FOUND", message: `no profile for ${email}` });
        }
        return res.json({
            success: true,
            notes: {
                text: profile.aiNotes?.text || "",
                updatedAt: profile.aiNotes?.updatedAt ? new Date(profile.aiNotes.updatedAt).toISOString() : null,
                updatedBy: profile.aiNotes?.updatedBy || "",
                charCount: (profile.aiNotes?.text || "").length,
            },
        });
    } catch (err) {
        console.error("GetAiNotes error:", err);
        return res.status(500).json({ success: false, error: "INTERNAL", message: err.message });
    }
}
