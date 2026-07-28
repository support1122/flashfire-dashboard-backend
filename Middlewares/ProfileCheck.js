// Middlewares/ProfileCheck.js (ESM)
import { ProfileModel } from "../Schema_Models/ProfileModel.js"; // <-- fix path to your model file
import { normalizeEmail } from "../Utils/AuthToken.js";

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Runs behind LocalTokenValidator on /setprofile.
//
// Two different emails are in play and they must not be conflated:
//   - userDetails.email is the ACCOUNT identity, and Add_Update_Profile uses it
//     as the profile's primary key.
//   - body.email is the user's CONTACT email, stored as contactEmail. It is
//     legitimately allowed to differ from the login address.
// So the identity is pinned to the verified token, and body.email is left
// exactly as the user typed it.
export default async function ProfileCheck(req, res, next) {
  try {
    const authEmail = normalizeEmail(req.authEmail || req.user?.email);
    if (!authEmail) {
      return res.status(401).json({ message: "Authentication required", code: "MISSING_TOKEN" });
    }

    // Canonical spelling from the token. GetProfile matches email exactly, so
    // the profile must be keyed the same way the login response spells it.
    const canonicalEmail = req.authEmailCanonical || req.user?.email || authEmail;

    // Existing profiles may be stored with a differently-cased email. Reuse the
    // stored spelling so the upsert updates that document rather than creating
    // a second one.
    const existing = await ProfileModel.findOne({
      email: { $regex: new RegExp(`^${escapeRegex(authEmail)}$`, "i") },
    }).select("email");
    const email = existing?.email || canonicalEmail;

    // Add_Update_Profile reads userDetails off req.body, so the verified
    // identity has to be written back there - that is what stops a caller from
    // naming someone else's account as the profile key.
    req.body.userDetails = { ...(req.body.userDetails || {}), email };

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
