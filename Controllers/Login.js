import { UserModel } from "../Schema_Models/UserModel.js";
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken'
import { decrypt } from "../Utils/CryptoHelper.js";
import { OTPModel } from "../Schema_Models/OTPModel.js";
import { sendOTPEmail, generateOTP } from "../Utils/EmailService.js";
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
            // Generate and send OTP for login verification
            const otp = generateOTP();
            
            // Save OTP to database
            await OTPModel.findOneAndUpdate(
                { email },
                { 
                    email, 
                    otp, 
                    createdAt: new Date(),
                    isUsed: false
                },
                { upsert: true, new: true }
            );

            // Send OTP email
            const emailResult = await sendOTPEmail(email, otp, existanceOfUser.name, 'login');
            
            if (emailResult.success) {
                return res.status(200).json({
                    message: "OTP sent to your email for verification",
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
                    }
                });
            } else {
                console.log('OTP Email Error:', emailResult.error);
                // For development, log OTP to console
                console.log('🔐 LOGIN OTP for', email, ':', otp);
                return res.status(200).json({
                    message: "OTP sent to your email for verification",
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
                    }
                });
            }
        } else {
            req.body.token = 'InvalidUser';
            return res.status(401).json({ message: "Invalid password" });
        }

    } catch (error) {
        console.log(error);
        res.status(500).json({ message: "Internal server error" });
    }
}
