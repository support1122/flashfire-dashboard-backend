// routes/ForgotPassword.js
import { UserModel } from "../Schema_Models/UserModel.js";
import { encrypt } from "../Utils/CryptoHelper.js";

export default async function ForgotPassword(req, res) {
     try {
          const { email, newPassword } = req.body;

          if (!email || !newPassword) {
               return res.status(400).json({ message: "Email and new password are required" });
          }

          // Check if user exists
          const user = await UserModel.findOne({ email });
          if (!user) {
               return res.status(404).json({ message: "User not found" });
          }

          // Encrypt new password
          const encryptedPassword = encrypt(newPassword);

          // Update password
          user.passwordHashed = encryptedPassword;
          await user.save();

          return res.status(200).json({ message: "Password updated successfully" });
     } catch (error) {
          console.error("ForgotPassword error:", error);
          return res.status(500).json({ message: "Password reset failed", error: error.message });
     }
}
