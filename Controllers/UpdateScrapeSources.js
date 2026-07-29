// UpdateScrapeSources: set the per-client scrape-source allowlist.
//
// Input  : POST /update-scrape-sources  { email, scrapeSources: ["jobright","indeed","reed","flexa"] }
// Output : { success, profile? } | { success:false, error, message }
//
// Used by the clients-tracking AI Summary admin tab ("Scrape sources" card).
// The JR-direct extension reads scrapeSources off the client profile and only
// captures cards from sites in this list. At least one source is required so a
// client always has somewhere to scrape from.

import { ProfileModel } from "../Schema_Models/ProfileModel.js";

const VALID_SOURCES = ["jobright", "indeed", "reed", "flexa"];

export default async function UpdateScrapeSources(req, res) {
  try {
    const { email, scrapeSources } = req.body || {};
    if (!email || typeof email !== "string" || !email.includes("@")) {
      return res.status(400).json({ success: false, error: "BAD_INPUT", message: "email is required" });
    }
    if (!Array.isArray(scrapeSources)) {
      return res.status(400).json({ success: false, error: "BAD_INPUT", message: "scrapeSources must be an array" });
    }
    // Normalise: lowercase, trim, dedupe, keep only known slugs.
    const cleaned = [
      ...new Set(
        scrapeSources
          .map((s) => String(s || "").toLowerCase().trim())
          .filter((s) => VALID_SOURCES.includes(s)),
      ),
    ];
    if (cleaned.length === 0) {
      return res.status(400).json({
        success: false,
        error: "BAD_INPUT",
        message: `scrapeSources must contain at least one of: ${VALID_SOURCES.join(", ")}`,
      });
    }
    const lower = String(email).toLowerCase();
    const profile = await ProfileModel.findOneAndUpdate(
      { email: lower },
      { $set: { scrapeSources: cleaned } },
      { new: true, lean: true },
    );
    if (!profile) {
      return res.status(404).json({ success: false, error: "PROFILE_NOT_FOUND", message: `no profile for ${email}` });
    }
    return res.json({
      success: true,
      profile: {
        email: profile.email,
        scrapeSources: profile.scrapeSources,
      },
    });
  } catch (err) {
    console.error("UpdateScrapeSources error:", err);
    return res.status(500).json({ success: false, error: "INTERNAL", message: err.message });
  }
}
