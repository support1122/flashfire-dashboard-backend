import { ProfileModel } from "../Schema_Models/ProfileModel.js";
import { UserModel } from "../Schema_Models/UserModel.js";

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
