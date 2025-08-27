// middlewares/userExistsByEmail.js
import { UserModel } from "../Schema_Models/UserModel.js";

export default async function SendgridEmailExistance(req, res, next) {
  try {
    const email = (req.body.email || "").trim().toLowerCase();
    if (!email) return res.status(400).json({ message: "Email is required" });

    const existanceOfUser = await UserModel.findOne({ email });
    if (!existanceOfUser) {
      return res.status(404).json({ message: "User Not Found. Sign Up to continue " });
    }
    req.body.email = email;
    req.body.existanceOfUser = existanceOfUser;
    next();
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Internal error" });
  }
}
