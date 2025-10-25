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
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
import jwt from 'jsonwebtoken'

const GoogleOAuth = async (req, res) => {
     const { token, planType } = req.body;

     try {

          const ticket = await client.verifyIdToken({
               idToken: token,
               audience: process.env.GOOGLE_CLIENT_ID
          });
          const payload = ticket.getPayload();

          // Check if user exists in regular UserModel
          let userFromDb = await UserModel.findOne({ email: payload.email });
          
          // Check if user exists in Operations model for @flashfirehq emails
          let operationsUser = null;
          if (payload.email?.includes("@flashfirehq")) {
               operationsUser = await Operations.findOne({ email: payload.email });
          }

          if (!userFromDb && !operationsUser) {
               // Don't create new user, return error for non-existing accounts
               return res.status(404).json({ 
                    message: "User not found",
                    error: "Account does not exist. Please register first."
               });
          }

          // Handle operations user login
          if (operationsUser) {
               const tokenNew = jwt.sign(
                    { email: payload?.email, name: operationsUser?.name },
                    process.env.JWT_SECRET || 'flashfire-secret-key-2024',
                    { expiresIn: '7d' }
               );
               
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
          let profileLookUp = await ProfileModel.findOne({ email: payload.email });
          const hasProfile = profileLookUp && profileLookUp.email && profileLookUp.email.length > 0;

          const tokenNew = jwt.sign(
               { email: payload?.email, name: userDetails?.name },
               process.env.JWT_SECRET || 'flashfire-secret-key-2024',
               { expiresIn: '7d' }
          );
          
          return res.status(200).json({
               message: 'Login Success..!',
               userDetails: {
                    name: userDetails.name,
                    email: userDetails.email,
                    planType: userDetails.planType,
                    userType: userDetails.userType,
                    planLimit: userDetails.planLimit,
                    resumeLink: userDetails.resumeLink,
                    coverLetters: userDetails.coverLetters,
                    optimizedResumes: userDetails.optimizedResumes
               },
               token: tokenNew,
               userProfile: hasProfile ? profileLookUp : null,
               hasProfile: hasProfile
          });
     } catch (error) {
          console.log(error)
          return res.status(500).json({ message: 'Google OAuth failed' });
     }
};
export default GoogleOAuth;
