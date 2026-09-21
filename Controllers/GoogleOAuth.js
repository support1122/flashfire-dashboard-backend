// import { UserModel } from "../Schema_Models/UserModel.js";
// import { ProfileModel } from "../Schema_Models/ProfileModel.js";
// import { OAuth2Client } from "google-auth-library";
// const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
// import jwt from 'jsonwebtoken'

// const GoogleOAuth = async (req, res) => {
//      const { token, planType } = req.body;

//      try {

//           const ticket = await client.verifyIdToken({
//                idToken: token,
//                audience: process.env.GOOGLE_CLIENT_ID
//           });
//           const payload = ticket.getPayload();

//           let userFromDb = await UserModel.findOne({ email: payload.email });
//           if (!userFromDb) {
//                // Create new user with selected plan or default to "Free Trial"
//                await UserModel.create({
//                     name: payload?.name,
//                     email: payload?.email,
//                     planType: planType || "Free Trial"
//                });
//           }
//           let userDetails = await UserModel.findOne({ email: payload.email });

//           let profileLookUp = await ProfileModel.findOne({ email: payload.email });
//           const hasProfile = profileLookUp && profileLookUp.email && profileLookUp.email.length > 0;

//           const tokenNew = jwt.sign(
//                { email: payload?.email, name: userFromDb?.name },
//                process.env.JWT_SECRET || 'flashfire-secret-key-2024',
//                { expiresIn: '7d' }
//           );
//           return res.status(200).json({
//                message: 'Login Sucess..!',
//                userDetails: {
//                     name: userDetails.name,
//                     email: userDetails.email,
//                     planType: userDetails.planType,
//                     userType: userDetails.userType,
//                     planLimit: userDetails.planLimit,
//                     resumeLink: userDetails.resumeLink,
//                     coverLetters: userDetails.coverLetters,
//                     optimizedResumes: userDetails.optimizedResumes
//                },
//                token: tokenNew,
//                userProfile: hasProfile ? profileLookUp : null,
//                hasProfile: hasProfile
//           });
//      } catch (error) {
//           console.log(error)
//           return res.status(500).json({ message: 'Google OAuth failed' });
//      }
// };
// export default GoogleOAuth;

import { UserModel } from "../Schema_Models/UserModel.js";
import { ProfileModel } from "../Schema_Models/ProfileModel.js";
import Operations from "../Schema_Models/Operations.js";
import { OAuth2Client } from "google-auth-library";
import { signAuthToken, normalizeEmail } from "../Utils/AuthToken.js";
import dotenv from 'dotenv';
dotenv.config();

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const client = new OAuth2Client(GOOGLE_CLIENT_ID);

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Case-insensitive lookup, matching the behaviour of the password login so a
// record stored as "John@x.com" is still found for a Google payload of
// "john@x.com" (and vice versa).
const findByEmail = (Model, email) =>
     Model.findOne({ email }).then((hit) =>
          hit || Model.findOne({ email: { $regex: new RegExp(`^${escapeRegex(email)}$`, "i") } })
     );

const GoogleOAuth = async (req, res) => {
     const { token } = req.body || {};

     // Without an audience, google-auth-library skips the `aud` check entirely,
     // which would accept an ID token minted by any third-party Google OAuth
     // client. Refuse to run rather than authenticate against nothing.
     if (!GOOGLE_CLIENT_ID) {
          console.error("GOOGLE_CLIENT_ID is not set - refusing to verify Google ID tokens.");
          return res.status(500).json({
               message: "Google login is not configured",
               code: "GOOGLE_NOT_CONFIGURED"
          });
     }

     if (!token) {
          return res.status(400).json({ message: "Google credential is required", code: "MISSING_CREDENTIAL" });
     }

     let payload;
     try {
          const ticket = await client.verifyIdToken({
               idToken: token,
               audience: GOOGLE_CLIENT_ID
          });
          payload = ticket.getPayload();
     } catch (error) {
          // The usual cause of "Wrong recipient" here is GOOGLE_CLIENT_ID not
          // matching the frontend's VITE_GOOGLE_OAUTH_CLIENT_ID. Say so, because
          // the client-facing message cannot.
          console.error("Google ID token verification failed:", error?.message);
          if (String(error?.message || "").includes("Wrong recipient")) {
               console.error(
                    `  -> GOOGLE_CLIENT_ID (${GOOGLE_CLIENT_ID}) does not match the client id the frontend signed in with. ` +
                    `These two must be identical.`
               );
          }
          return res.status(401).json({ message: "Invalid Google credential", code: "INVALID_CREDENTIAL" });
     }

     try {
          const email = normalizeEmail(payload?.email);

          // Google marks unverified addresses on some workspace/federated setups;
          // an unverified address proves nothing about who is signing in.
          if (!email || payload.email_verified !== true) {
               return res.status(401).json({
                    message: "Google account email is not verified",
                    code: "EMAIL_NOT_VERIFIED"
               });
          }

          // Only accounts that already exist may sign in. Nothing here creates one.
          const userFromDb = await findByEmail(UserModel, email);
          const operationsUser = await findByEmail(Operations, email);

          if (!userFromDb && !operationsUser) {
               return res.status(404).json({
                    message: "User not found",
                    code: "ACCOUNT_NOT_FOUND",
                    error: "Account does not exist. Please contact your account manager."
               });
          }

          // The ops lookup is no longer gated on the address containing
          // "@flashfirehq" - that substring decided nothing about security (the
          // record still has to exist) but did lock ops accounts to one domain.
          // Precedence for an address that exists in both collections is
          // unchanged: ops wins on the flashfirehq domain, client otherwise.
          const useOperations = operationsUser && (!userFromDb || email.includes("@flashfirehq"));

          // Handle operations user login
          if (useOperations) {
               const tokenNew = signAuthToken({ email: operationsUser.email, name: operationsUser?.name });

               return res.status(200).json({
                    message: 'Login Success..!',
                    user: {
                         name: operationsUser.name,
                         email: operationsUser.email,
                         role: operationsUser.role,
                         managedUsers: operationsUser.managedUsers || []
                    },
                    userDetails: {
                         name: operationsUser.name,
                         email: operationsUser.email,
                         role: operationsUser.role,
                         managedUsers: operationsUser.managedUsers || []
                    },
                    token: tokenNew
               });
          }

          // Handle regular user login
          let userDetails = userFromDb;
          const canonicalEmail = userDetails.email || email;
          let profileLookUp = await findByEmail(ProfileModel, canonicalEmail);
          const hasProfile = profileLookUp && profileLookUp.email && profileLookUp.email.length > 0;

          const tokenNew = signAuthToken({ email: canonicalEmail, name: userDetails?.name });

          return res.status(200).json({
               message: 'Login Success..!',
               userDetails: {
                    name: userDetails.name,
                    email: canonicalEmail,
                    planType: userDetails.planType,
                    userType: userDetails.userType,
                    planLimit: userDetails.planLimit,
                    resumeLink: userDetails.resumeLink,
                    coverLetters: userDetails.coverLetters,
                    optimizedResumes: userDetails.optimizedResumes,
                    transcript: userDetails.transcript,
                    portfolioLinks: userDetails.portfolioLinks || [],
                    dashboardManager: userDetails.dashboardManager
               },
               token: tokenNew,
               // Same shape the password login returns. Profile.tsx reads
               // userProfile.removedJobsCount, which lives on the user document
               // rather than the profile, so it has to be grafted on here too.
               userProfile: hasProfile
                    ? { ...profileLookUp.toObject(), removedJobsCount: userDetails.removedJobsCount || 0 }
                    : null,
               hasProfile: hasProfile
          });
     } catch (error) {
          console.error('Google OAuth failed:', error);
          // Client-facing wording: the frontend shows message verbatim when it
          // does not recognise the code.
          return res.status(500).json({
               message: 'Google login failed. Please try again.',
               code: 'SERVER_ERROR'
          });
     }
};
export default GoogleOAuth;
