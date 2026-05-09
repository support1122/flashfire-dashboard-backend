import { UserModel } from "../Schema_Models/UserModel.js";
import { ProfileModel } from "../Schema_Models/ProfileModel.js";
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken'
import { decrypt } from "../Utils/CryptoHelper.js";
dotenv.config();

const normalizeEmail = (email) => String(email || "").trim().toLowerCase();
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export default async function Login(req, res) {
     const { password } = req.body || {};
     const email = normalizeEmail(req.body?.email);

     try {
          if (!email || !password) {
               return res.status(400).json({ message: "Email and password are required" });
          }

          // First find the user by email
          const existanceOfUser = await UserModel.findOne({ email }) ||
               await UserModel.findOne({ email: { $regex: new RegExp(`^${escapeRegex(email)}$`, "i") } });

          if (!existanceOfUser) {
               return res.status(401).json({ message: "User not found" });
          }

          // Check password
          let passwordDecrypted = decrypt(existanceOfUser.passwordHashed);
          if (passwordDecrypted === password) {
               // Find user profile
               let profileLookUp = await ProfileModel.findOne({ email }) ||
                    await ProfileModel.findOne({ email: { $regex: new RegExp(`^${escapeRegex(email)}$`, "i") } });
               const hasProfile = profileLookUp && profileLookUp.email && profileLookUp.email.length > 0;
               const canonicalEmail = existanceOfUser.email || email;

               return res.status(200).json({
                    message: 'Login Success..!',
                    userDetails: {
                         name: existanceOfUser.name,
                         email: canonicalEmail,
                         planType: existanceOfUser.planType,
                         userType: existanceOfUser.userType,
                         planLimit: existanceOfUser.planLimit,
                         resumeLink: existanceOfUser.resumeLink,
                         coverLetters: existanceOfUser.coverLetters,
                         optimizedResumes: existanceOfUser.optimizedResumes,
                         transcript: existanceOfUser.transcript,
                         portfolioLinks: existanceOfUser.portfolioLinks || [],
                         dashboardManager: existanceOfUser.dashboardManager
                    },
                    token: jwt.sign({ email: canonicalEmail }, process.env.JWT_SECRET_KEY || process.env.JWT_SECRET || 'FLASHFIRE', { expiresIn: '7d' }),
                    userProfile: hasProfile ? { ...profileLookUp.toObject(), removedJobsCount: existanceOfUser.removedJobsCount || 0 } : null,
                    hasProfile: hasProfile
               });

          } else {
               return res.status(401).json({ message: "Invalid password" });
          }

     } catch (error) {
          console.log(error);
          res.status(500).json({ message: "Internal server error" });
     }
}
