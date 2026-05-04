import { ProfileModel } from "../Schema_Models/ProfileModel.js";
import { UserModel } from "../Schema_Models/UserModel.js";
import { getAppSettings } from "../Schema_Models/AppSettings.js";

export default async function GetProfile(req, res) {
  try {
    const { email } = req.query;

    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    const [profile, user] = await Promise.all([
      ProfileModel.findOne({ email }).lean(), // Use lean() for better performance and modifiable object
      UserModel.findOne({ email }).select('removedJobsCount').lean()
    ]);

    if (!profile) {
      return res.status(404).json({ message: "Profile not found" });
    }

    const userProfile = {
      ...profile,
      removedJobsCount: user?.removedJobsCount || 0
    };

    // Fallback to the admin-managed global OpenAI key when the per-client
    // profile has none. Extension reads userProfile.openaiKey on every
    // reloadProfile call, so the swap is invisible to the client code.
    if (!userProfile.openaiKey || !String(userProfile.openaiKey).trim()) {
      try {
        const settings = await getAppSettings();
        const globalKey = (settings?.globalOpenaiKey || "").trim();
        if (globalKey) userProfile.openaiKey = globalKey;
      } catch (e) {
        console.warn("GetProfile global-key fallback failed:", e.message);
      }
    }

    return res.json({
      message: "Profile retrieved successfully",
      userProfile,
    });
  } catch (error) {
    console.error("GetProfile error:", error);
    return res.status(500).json({
      message: "Internal server error",
      error: error.message,
    });
  }
}
