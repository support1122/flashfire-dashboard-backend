// UpdateOpenaiKey: set the per-client OpenAI API key used by the JR-direct
// extension SW for auto-judge. Stored plain-text on the ProfileModel.
//
// Input  : POST /update-openai-key  { email, openaiKey }
// Output : { success, profile? } | { success:false, error, message }
//
// Empty string clears the key. The extension reads it via the userProfile
// returned by /extension/clientLogin.

import { ProfileModel } from "../Schema_Models/ProfileModel.js";

export default async function UpdateOpenaiKey(req, res) {
  try {
    const { email, openaiKey } = req.body || {};
    if (!email || typeof email !== "string" || !email.includes("@")) {
      return res.status(400).json({ success: false, error: "BAD_INPUT", message: "email is required" });
    }
    if (openaiKey != null && typeof openaiKey !== "string") {
      return res.status(400).json({ success: false, error: "BAD_INPUT", message: "openaiKey must be a string (or empty)" });
    }
    const trimmed = (openaiKey || "").trim();
    if (trimmed && !/^sk-/.test(trimmed)) {
      return res.status(400).json({ success: false, error: "BAD_INPUT", message: "openaiKey must start with sk-" });
    }
    const lower = String(email).toLowerCase();
    const profile = await ProfileModel.findOneAndUpdate(
      { email: lower },
      { $set: { openaiKey: trimmed } },
      { new: true, lean: true },
    );
    if (!profile) {
      return res.status(404).json({ success: false, error: "PROFILE_NOT_FOUND", message: `no profile for ${email}` });
    }
    return res.json({
      success: true,
      profile: {
        email: profile.email,
        openaiKey: profile.openaiKey || "",
        keySet: !!(profile.openaiKey && profile.openaiKey.length > 0),
      },
    });
  } catch (err) {
    console.error("UpdateOpenaiKey error:", err);
    return res.status(500).json({ success: false, error: "INTERNAL", message: err.message });
  }
}
