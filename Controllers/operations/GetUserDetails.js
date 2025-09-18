import { UserModel } from "../../Schema_Models/UserModel.js";
import { ProfileModel } from "../../Schema_Models/ProfileModel.js";
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
dotenv.config();

export default async function GetUserDetails(req, res) {
     const { email, existanceOfUser } = req.body;
     console.log(req.body);

     try {
          let profileLookUp = await ProfileModel.findOne({ email });

          // Generate JWT token for the client user
          const token = jwt.sign(
               { 
                    email: email, 
                    id: existanceOfUser._id,
                    role: 'User' // Client users have 'User' role
               },
               process.env.JWT_SECRET_KEY,
               { expiresIn: '24h' }
          );
          console.log("token: ", token);

          return res.status(200).json({
               message: 'User data loaded  Sucess..!',
               token: token, // Add the JWT token
               userDetails: { 
                    name: existanceOfUser.name, 
                    email, 
                    planType: existanceOfUser.planType, 
                    userType: existanceOfUser.userType, 
                    planLimit: existanceOfUser.planLimit, 
                    resumeLink: existanceOfUser.resumeLink, 
                    coverLetters: existanceOfUser.coverLetters, 
                    optimizedResumes: existanceOfUser.optimizedResumes 
               },
               userProfile: profileLookUp?.email.length > 0 ? profileLookUp : null
          });

     } catch (error) {
          console.log(error);
          res.status(500).json({ message: "Internal server error while fetching user details of Operations team" });
     }
}
