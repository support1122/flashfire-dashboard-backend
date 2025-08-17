import { UserModel } from "../Schema_Models/UserModel.js";
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken'
import { decrypt } from "../Utils/CryptoHelper.js";
import { OTPModel } from "../Schema_Models/OTPModel.js";
import { sendOTPEmail, generateOTP } from "../Utils/EmailService.js";
dotenv.config();

export default async function Login(req, res) {
    const { email, password, existanceOfUser, token} = req.body;
    console.log('🔐 Login attempt for:', email);

    try {
        // Check if user exists
        if (!existanceOfUser) {
            console.log('❌ User not found:', email);
            return res.status(401).json({ message: "Invalid email or password" });
        }

        // Verify password
        let passwordDecrypted = decrypt(existanceOfUser.passwordHashed)
        if (passwordDecrypted === password) {
            console.log('✅ Password verified for:', email);
            
            // Generate and send OTP for login verification
            const otp = generateOTP();
            console.log('🔐 Generated OTP for', email, ':', otp);
            
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
            console.log('💾 OTP saved to database for:', email);

            // Send OTP email
            const emailResult = await sendOTPEmail(email, otp, existanceOfUser.name, 'login');
            
            if (emailResult.success) {
                console.log('📧 Email sent successfully for:', email);
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
                console.log('⚠️ Email sending failed for:', email, 'Error:', emailResult.error);
                // Still return success since OTP is logged to console
                return res.status(200).json({
                    message: "OTP sent to your email for verification (check console for OTP)",
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
            console.log('❌ Invalid password for:', email);
            req.body.token = 'InvalidUser';
            return res.status(401).json({ message: "Invalid email or password" });
        }

    } catch (error) {
        console.log('❌ Login error:', error);
        res.status(500).json({ message: "Internal server error" });
    }
}
