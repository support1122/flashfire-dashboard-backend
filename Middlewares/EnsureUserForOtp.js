import { UserModel } from "../Schema_Models/UserModel.js";

export default async function EnsureUserForOtp(req, res, next) {
  try {
    const email = (req.body.email || "").trim().toLowerCase();
    if (!email) return res.status(400).json({ message: "Email is required" });

    let user = await UserModel.findOne({ email });
    if (!user) {
      user = await UserModel.create({
        email,
        name: email.split("@")[0],
        userType: "user",
        planType: "free",
      });
    }

    req.body.email = email;
    req.body.existanceOfUser = user; // Tokenizer expects this
    next();
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Internal error" });
  }
}
