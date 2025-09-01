import { ProfileModel } from "../Schema_Models/ProfileModel.js";

export default async function GetProfile(req, res) {
  try {
    const { email } = req.query;

    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    const profile = await ProfileModel.findOne({ email });

    if (!profile) {
      return res.status(404).json({ message: "Profile not found" });
    }

    return res.json({
      message: "Profile retrieved successfully",
      userProfile: profile,
    });
  } catch (error) {
    console.error("GetProfile error:", error);
    return res.status(500).json({
      message: "Internal server error",
      error: error.message,
    });
  }
}
