// EmailService.js
import { Resend } from 'resend';
import dotenv from 'dotenv';

dotenv.config();

// Configure Resend with the provided API key
const resend = new Resend(process.env.RESEND_API_KEY || 're_E5Vx6XvV_DakAD4SLnWGSptb1oAY6VebS');

export const sendOTPEmail = async (email, otp, userName) => {
  try {
    const { data, error } = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL || 'FlashFire <onboarding@resend.dev>',
      to: [email],
      subject: 'Email Verification OTP - FlashFire Dashboard',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f8f9fa;">
          <div style="background-color: #ffffff; padding: 30px; border-radius: 10px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
            <h2 style="color: #333; text-align: center; margin-bottom: 30px;">Email Verification</h2>
            <p style="color: #666; font-size: 16px; line-height: 1.6;">Hello ${userName},</p>
            <p style="color: #666; font-size: 16px; line-height: 1.6;">Thank you for registering with FlashFire Dashboard. To complete your registration, please use the following OTP:</p>
            
            <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; text-align: center; margin: 30px 0;">
              <h1 style="color: #007bff; font-size: 32px; letter-spacing: 8px; margin: 0; font-weight: bold;">${otp}</h1>
            </div>
            
            <p style="color: #666; font-size: 16px; line-height: 1.6;">This OTP will expire in 10 minutes for security reasons.</p>
            <p style="color: #666; font-size: 16px; line-height: 1.6;">If you didn't request this verification, please ignore this email.</p>
            
            <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
              <p style="color: #999; font-size: 14px; text-align: center;">Best regards,<br>The FlashFire Dashboard Team</p>
            </div>
          </div>
        </div>
      `
    });

    if (error) {
      console.error('Resend error:', error);
      return { success: false, message: 'Failed to send OTP email', error: error.message };
    }

    console.log('Email sent successfully:', data);
    return { success: true, message: 'OTP sent successfully' };
  } catch (error) {
    console.error('Error sending email:', error);
    return { success: false, message: 'Failed to send OTP email', error: error.message };
  }
};

export const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};
