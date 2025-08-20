// Middlewares/ProfileCheck.js (ESM)
import { ProfileModel } from "../Schema_Models/ProfileModel.js"; // <-- fix path to your model file

export default async function ProfileCheck(req, res, next) {
  try {
    const email = req.body?.email || req.body?.userDetails?.email;
    if (!email) return res.status(400).json({ message: "Email is required" });

    const result = await ProfileModel.findOneAndUpdate(
      { email },
      { $setOnInsert: { email, status: "new" } }, // minimal skeleton
      {
        upsert: true,
        new: true,
        rawResult: true,
        runValidators: false,      // do NOT validate skeleton
        setDefaultsOnInsert: true,
      }
    );

    req.profile = result.value;
    req.profileWasCreated = Boolean(result.lastErrorObject?.upserted);
    return next();
  } catch (err) {
    console.error("profileCheck error:", err);
    return res.status(500).json({ message: "Failed to ensure profile" });
  }
}
