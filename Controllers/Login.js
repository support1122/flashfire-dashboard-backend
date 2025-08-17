import { UserModel } from "../Schema_Models/UserModel.js";
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken'
import { decrypt } from "../Utils/CryptoHelper.js";
dotenv.config();

export default async function Login(req, res) {
    const { email, password, existanceOfUser, token} = req.body;
    console.log(req.body);

    try {
        // Check if user's email is verified
        if (!existanceOfUser.isEmailVerified) {
            return res.status(401).json({ 
                message: "Please verify your email before logging in. Check your inbox for the verification OTP." 
            });
        }

        let passwordDecrypted = decrypt(existanceOfUser.passwordHashed)
        if (passwordDecrypted === password) {
            return res.status(200).json({
                message: 'Login Success..!',
                userDetails: { 
                    name: existanceOfUser.name, 
                    email, 
                    planType: existanceOfUser.planType, 
                    userType: existanceOfUser.userType, 
                    planLimit: existanceOfUser.planLimit, 
                    resumeLink: existanceOfUser.resumeLink, 
                    coverLetters: existanceOfUser.coverLetters, 
                    optimizedResumes: existanceOfUser.optimizedResumes,
                    isEmailVerified: existanceOfUser.isEmailVerified
                },
                token
            });

        } else {
            req.body.token = 'InvalidUser';
            return res.status(401).json({ message: "Invalid password" });
        }

    } catch (error) {
        console.log(error);
        res.status(500).json({ message: "Internal server error" });
    }
}
