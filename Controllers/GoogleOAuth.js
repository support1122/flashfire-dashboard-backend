import { UserModel } from "../Schema_Models/UserModel.js";
import { OAuth2Client } from "google-auth-library";
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
import jwt from "jsonwebtoken";
import { ProfileModel } from "../Schema_Models/ProfileModel.js";
import Operations from "../Schema_Models/Operations.js"; // ✅ add this

const GoogleOAuth = async (req, res) => {
  const { token, planType } = req.body;

  try {
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const email = payload.email;

    if (email.includes("@flashfirehq.com")) {
      // ✅ fixed missing parenthesis
      if (!email) {
        return res.status(400).json({ error: "Email is required." });
      }

      const opUser = await Operations.findOne({ email }).populate({
        path: "managedUsers",
        select: "userID name email",
      });

      if (!opUser) {
        return res.status(401).json({ error: "Invalid credentials" });
      }

      return res.json({
        message: "Login successful",
        user: {
          id: opUser._id,
          name: opUser.name,
          email: opUser.email,
          role: opUser.role,
          managedUsers: opUser.managedUsers,
        },
      });
    } else {
      let profileLookUp = await ProfileModel.findOne({ email });
      const existanceOfUser = await UserModel.findOne({ email });

      if (!existanceOfUser) {
        return res.status(401).json({ message: "User not found" });
      }

      return res.status(200).json({
        message: "Login Success..!",
        userDetails: {
          name: existanceOfUser.name,
          email,
          planType: existanceOfUser.planType,
          userType: existanceOfUser.userType,
          planLimit: existanceOfUser.planLimit,
          resumeLink: existanceOfUser.resumeLink,
          coverLetters: existanceOfUser.coverLetters,
          optimizedResumes: existanceOfUser.optimizedResumes,
          transcript: existanceOfUser.transcript,
          dashboardManager: existanceOfUser.dashboardManager,
        },
        token: jwt.sign(
          { email },
          process.env.JWT_SECRET_KEY ||
            process.env.JWT_SECRET ||
            "FLASHFIRE",
          { expiresIn: "30d" }
        ),
        userProfile:
          profileLookUp?.email?.length > 0 ? profileLookUp : null,
      });
    }
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Google OAuth failed" });
  }
};

export default GoogleOAuth;

