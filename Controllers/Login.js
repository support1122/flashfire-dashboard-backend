import { UserModel } from "../Schema_Models/UserModel.js";
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken'
import { decrypt } from "../Utils/CryptoHelper.js";
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
            console.log('✅ Login successful for:', email);
            
            // Generate JWT token
            const token = jwt.sign(
                { userId: existanceOfUser._id, email: existanceOfUser.email },
                process.env.JWT_SECRET_KEY || 'FLASHFIRE',
                { expiresIn: '24h' }
            );

            return res.status(200).json({
                message: "Login Success..!",
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
                token: token
            });
        } else {
            console.log('❌ Invalid password for:', email);
            return res.status(401).json({ message: "Invalid email or password" });
        }

    } catch (error) {
        console.log('❌ Login error:', error);
        res.status(500).json({ message: "Internal server error" });
    }
}
