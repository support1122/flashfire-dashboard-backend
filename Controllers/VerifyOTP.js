// VerifyOTP.js
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import { UserModel } from '../Schema_Models/UserModel.js';
import { OTPModel } from '../Schema_Models/OTPModel.js';
import { encrypt } from '../Utils/CryptoHelper.js';
dotenv.config();

export default async function VerifyOTP(req, res) {
    const { email, otp, name, password } = req.body;

    try {
        // Find the OTP record
        const otpRecord = await OTPModel.findOne({
            email,
            otp,
            isUsed: false,
            expiresAt: { $gt: new Date() }
        });

        if (!otpRecord) {
            return res.status(400).json({
                message: 'Invalid or expired OTP'
            });
        }

        // Check if user already exists (in case of duplicate registration attempts)
        let user = await UserModel.findOne({ email });
        
        if (user) {
            // If user exists but email is not verified, update the verification
            if (!user.isEmailVerified) {
                user.isEmailVerified = true;
                user.emailVerificationToken = null;
                await user.save();
            } else {
                return res.status(400).json({
                    message: 'Email already verified'
                });
            }
        } else {
            // Create new user
            const passwordEncrypted = encrypt(password);
            user = await UserModel.create({
                name,
                email,
                passwordHashed: passwordEncrypted,
                isEmailVerified: true,
                emailVerificationToken: null
            });
        }

        // Mark OTP as used
        otpRecord.isUsed = true;
        await otpRecord.save();

        // Generate JWT token
        const token = jwt.sign(
            { userId: user._id, email: user.email },
            process.env.JWT_SECRET || 'your-secret-key',
            { expiresIn: '24h' }
        );

        res.status(200).json({
            message: 'Email verified successfully! Welcome to FlashFire Dashboard',
            userDetails: {
                name: user.name,
                email: user.email,
                planType: user.planType,
                userType: user.userType,
                planLimit: user.planLimit,
                resumeLink: user.resumeLink,
                coverLetters: user.coverLetters,
                optimizedResumes: user.optimizedResumes,
                isEmailVerified: user.isEmailVerified
            },
            token
        });

    } catch (error) {
        console.log(error);
        res.status(500).json({
            message: 'Internal server error',
            error: error.message
        });
    }
}



