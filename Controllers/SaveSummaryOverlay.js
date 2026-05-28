// SaveSummaryOverlay: persist the operator's "format snapshot" so future
// BuildAiSummary rebuilds re-inject the operator-added bullets on top of
// every freshly-generated brief.
//
// Endpoints:
//   POST /save-summary-overlay   { email, savedText }      → enabled:true
//   POST /clear-summary-overlay  { email }                 → enabled:false
//   GET  /summary-overlay?email= → { enabled, savedText, savedAt, stats }
//
// The merge itself lives in Utils/summaryOverlay.js and runs at the tail of
// runForProfileCore in BuildAiSummary.js. This controller only writes/reads
// the snapshot.

import { ProfileModel } from "../Schema_Models/ProfileModel.js";
import { countOverlayBullets } from "../Utils/summaryOverlay.js";

const MAX_OVERLAY_CHARS = 8000;

function lower(email) {
    return String(email || "").toLowerCase();
}

export async function SaveSummaryOverlay(req, res) {
    try {
        const { email, savedText } = req.body || {};
        if (!email || typeof email !== "string" || !email.includes("@")) {
            return res.status(400).json({ success: false, error: "BAD_INPUT", message: "email is required" });
        }
        if (typeof savedText !== "string" || savedText.trim().length === 0) {
            return res.status(400).json({ success: false, error: "BAD_INPUT", message: "savedText must be a non-empty string" });
        }
        const trimmed = savedText.slice(0, MAX_OVERLAY_CHARS);
        const now = new Date();
        const profile = await ProfileModel.findOneAndUpdate(
            { email: lower(email) },
            {
                $set: {
                    "aiSummaryOverlay.savedText": trimmed,
                    "aiSummaryOverlay.savedAt": now,
                    "aiSummaryOverlay.enabled": true,
                },
            },
            { new: true, lean: true },
        );
        if (!profile) {
            return res.status(404).json({ success: false, error: "PROFILE_NOT_FOUND", message: `no profile for ${email}` });
        }
        const stats = countOverlayBullets(trimmed, profile.aiSummary || "");
        return res.json({
            success: true,
            message: stats.total
                ? `Format saved. ${stats.total} operator-added line${stats.total === 1 ? "" : "s"} will persist on rebuild.`
                : "Format saved. No new lines detected vs the current summary — overlay stored for future rebuilds.",
            overlay: {
                enabled: true,
                savedAt: now.toISOString(),
                charCount: trimmed.length,
                stats,
            },
        });
    } catch (err) {
        console.error("SaveSummaryOverlay error:", err);
        return res.status(500).json({ success: false, error: "INTERNAL", message: err.message });
    }
}

export async function ClearSummaryOverlay(req, res) {
    try {
        const { email } = req.body || {};
        if (!email || typeof email !== "string" || !email.includes("@")) {
            return res.status(400).json({ success: false, error: "BAD_INPUT", message: "email is required" });
        }
        const profile = await ProfileModel.findOneAndUpdate(
            { email: lower(email) },
            { $set: { "aiSummaryOverlay.enabled": false } },
            { new: true, lean: true },
        );
        if (!profile) {
            return res.status(404).json({ success: false, error: "PROFILE_NOT_FOUND", message: `no profile for ${email}` });
        }
        return res.json({
            success: true,
            message: "Overlay disabled. Next rebuild will use pure AI output (saved text retained but not applied).",
            overlay: { enabled: false, savedAt: profile.aiSummaryOverlay?.savedAt || null },
        });
    } catch (err) {
        console.error("ClearSummaryOverlay error:", err);
        return res.status(500).json({ success: false, error: "INTERNAL", message: err.message });
    }
}

export async function GetSummaryOverlay(req, res) {
    try {
        const email = req.query?.email;
        if (!email || typeof email !== "string" || !email.includes("@")) {
            return res.status(400).json({ success: false, error: "BAD_INPUT", message: "email is required" });
        }
        const profile = await ProfileModel.findOne({ email: lower(email) }).lean();
        if (!profile) {
            return res.status(404).json({ success: false, error: "PROFILE_NOT_FOUND", message: `no profile for ${email}` });
        }
        const overlay = profile.aiSummaryOverlay || {};
        const stats = countOverlayBullets(overlay.savedText || "", profile.aiSummary || "");
        return res.json({
            success: true,
            overlay: {
                enabled: !!overlay.enabled,
                savedAt: overlay.savedAt ? new Date(overlay.savedAt).toISOString() : null,
                charCount: (overlay.savedText || "").length,
                savedText: overlay.savedText || "",
                stats,
            },
        });
    } catch (err) {
        console.error("GetSummaryOverlay error:", err);
        return res.status(500).json({ success: false, error: "INTERNAL", message: err.message });
    }
}
