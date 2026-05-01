// UpdateTargetJobs: set the per-client max-jobs cap.
//
// Input  : POST /update-target-jobs  { email, targetJobCount }
// Output : { success, profile? } | { success:false, error, message }
//
// Used by clients-tracking RegisterClient (initial value at sign-up) and
// by the AI Summary admin tab (later edits). /addjob enforces the cap.

import { ProfileModel } from "../Schema_Models/ProfileModel.js";

export default async function UpdateTargetJobs(req, res) {
  try {
    const { email, targetJobCount } = req.body || {};
    if (!email || typeof email !== "string" || !email.includes("@")) {
      return res.status(400).json({ success: false, error: "BAD_INPUT", message: "email is required" });
    }
    if (targetJobCount !== null && (!Number.isInteger(targetJobCount) || targetJobCount < 0 || targetJobCount > 10000)) {
      return res.status(400).json({ success: false, error: "BAD_INPUT", message: "targetJobCount must be 0-10000 or null" });
    }
    const lower = String(email).toLowerCase();
    const profile = await ProfileModel.findOneAndUpdate(
      { email: lower },
      { $set: { targetJobCount } },
      { new: true, lean: true },
    );
    if (!profile) {
      return res.status(404).json({ success: false, error: "PROFILE_NOT_FOUND", message: `no profile for ${email}` });
    }
    return res.json({
      success: true,
      profile: {
        email: profile.email,
        targetJobCount: profile.targetJobCount,
      },
    });
  } catch (err) {
    console.error("UpdateTargetJobs error:", err);
    return res.status(500).json({ success: false, error: "INTERNAL", message: err.message });
  }
}
