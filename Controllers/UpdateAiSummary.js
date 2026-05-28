// UpdateAiSummary: persist a client's AI-generated candidate summary on
// their profile so the JR-direct extension (and any future grading call)
// can reuse it instead of rebuilding from scratch every run.
//
// Inputs : { email, aiSummary, model?, source?, wordCount? }
// Outputs: { success, profile? } | { success:false, message }
//
// Notes:
//   • Treats absent profile as 404. We never create one here — onboarding
//     owns profile creation.
//   • Truncates aiSummary to 8000 chars defensively (~1500 words upper
//     bound) so a malformed AI response can't blow up the document size.

import { ProfileModel } from "../Schema_Models/ProfileModel.js";

const MAX_SUMMARY_CHARS = 8000;

export default async function UpdateAiSummary(req, res) {
  try {
    const { email, aiSummary, model = "", source = "" } = req.body || {};
    if (!email || typeof email !== "string" || !email.includes("@")) {
      return res
        .status(400)
        .json({ success: false, message: "email is required" });
    }
    if (typeof aiSummary !== "string" || aiSummary.trim().length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "aiSummary (non-empty string) is required" });
    }
    const trimmed = aiSummary.slice(0, MAX_SUMMARY_CHARS);
    const wordCount =
      Number.isInteger(req.body.wordCount) && req.body.wordCount > 0
        ? req.body.wordCount
        : trimmed.trim().split(/\s+/).filter(Boolean).length;

    const lower = String(email).toLowerCase();
    const update = {
      aiSummary: trimmed,
      aiSummaryMeta: {
        builtAt: new Date(),
        model: String(model || "").slice(0, 80),
        source: String(source || "").slice(0, 60),
        wordCount,
        // Manual edits are operator-authored — no [R]/[P] markers to extract.
        // Drop provenance so the UI renders manual lines as neutral (user).
        provenance: null,
      },
      // Manual edit counts as up-to-date — clear the rebuild banner.
      summaryStale: false,
    };

    const profile = await ProfileModel.findOneAndUpdate(
      { email: lower },
      { $set: update },
      { new: true, lean: true },
    );
    if (!profile) {
      return res.status(404).json({ success: false, message: "profile not found" });
    }
    return res.json({
      success: true,
      message: "aiSummary saved",
      profile: {
        email: profile.email,
        aiSummary: profile.aiSummary,
        aiSummaryMeta: profile.aiSummaryMeta,
      },
    });
  } catch (err) {
    console.error("UpdateAiSummary error:", err);
    return res
      .status(500)
      .json({ success: false, message: "internal server error", error: err.message });
  }
}
