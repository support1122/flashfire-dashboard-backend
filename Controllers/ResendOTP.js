// ResendOTP.js
import dotenv from 'dotenv';
import { OTPModel } from '../Schema_Models/OTPModel.js';
import { sendOTPEmail, generateOTP } from '../Utils/EmailService.js';
dotenv.config();

export default async function ResendOTP(req, res) {
    const { email, name } = req.body;

    try {
        // Check if there's an existing unused OTP
        const existingOTP = await OTPModel.findOne({
            email,
            isUsed: false,
            expiresAt: { $gt: new Date() }
        });

        if (existingOTP) {
            // If OTP exists and is not expired, send the same OTP
            const emailResult = await sendOTPEmail(email, existingOTP.otp, name);
            
            if (!emailResult.success) {
                return res.status(500).json({
                    message: 'Failed to resend OTP email',
                    error: emailResult.message
                });
            }

            return res.status(200).json({
                message: 'OTP resent successfully',
                email: email
            });
        }

        // Generate new OTP
        const otp = generateOTP();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes from now

        // Save new OTP to database
        await OTPModel.create({
            email,
            otp,
            expiresAt
        });

        // Send new OTP email
        const emailResult = await sendOTPEmail(email, otp, name);
        
        if (!emailResult.success) {
            return res.status(500).json({
                message: 'Failed to send OTP email',
                error: emailResult.message
            });
        }

        res.status(200).json({
            message: 'New OTP sent successfully',
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



