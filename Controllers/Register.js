import crypto from 'crypto'
import dotenv from 'dotenv'
import { UserModel } from '../Schema_Models/UserModel.js';
import { OTPModel } from '../Schema_Models/OTPModel.js';
import { encrypt } from '../Utils/CryptoHelper.js';
import { sendOTPEmail, generateOTP } from '../Utils/EmailService.js';
dotenv.config();

export default async function Register(req, res) {
    let {email, name, password} = req.body;
    
    try {
        // Check if user already exists
        const existingUser = await UserModel.findOne({ email });
        if (existingUser) {
            return res.status(400).json({
                message: 'User with this email already exists'
            });
        }

        // Generate OTP
        const otp = generateOTP();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes from now

        // Save OTP to database
        await OTPModel.create({
            email,
            otp,
            expiresAt
        });

        // Send OTP email
        const emailResult = await sendOTPEmail(email, otp, name);
        
        if (!emailResult.success) {
            return res.status(500).json({
                message: 'Failed to send OTP email',
                error: emailResult.message
            });
        }

        res.status(200).json({
            message: 'OTP sent to your email for verification',
            email: email
        });
           
    } catch (error) {
        console.log(error);
        res.status(500).json({
            message: 'Internal server error',
            error: error.message
        });
    }
}