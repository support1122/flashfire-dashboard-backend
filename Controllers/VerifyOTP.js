// VerifyOTP.js
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import { UserModel } from '../Schema_Models/UserModel.js';
import { OTPModel } from '../Schema_Models/OTPModel.js';
import { encrypt } from '../Utils/CryptoHelper.js';
dotenv.config();

export default async function VerifyOTP(req, res) {
    const { email, otp } = req.body;

    try {
        // Find the OTP record
        const otpRecord = await OTPModel.findOne({
            email,
            otp,
            isUsed: false,
            createdAt: { $gt: new Date(Date.now() - 10 * 60 * 1000) } // 10 minutes ago
        });

        if (!otpRecord) {
            return res.status(400).json({
                message: 'Invalid or expired OTP'
            });
        }

        // Find the user
        const user = await UserModel.findOne({ email });
        if (!user) {
            return res.status(400).json({
                message: 'User not found'
            });
        }

        // Mark OTP as used
        otpRecord.isUsed = true;
        await otpRecord.save();

        // Generate JWT token
        const token = jwt.sign(
            { userId: user._id, email: user.email },
            process.env.JWT_SECRET_KEY || 'FLASHFIRE',
            { expiresIn: '24h' }
        );

        res.status(200).json({
            message: 'Login successful',
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



