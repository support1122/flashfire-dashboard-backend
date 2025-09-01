import jwt from 'jsonwebtoken';
import { UserModel } from "../Schema_Models/UserModel.js";
import dotenv from 'dotenv';
dotenv.config();

export default async function RefreshToken(req, res) {
    try {
        const { email } = req.body;
        
        if (!email) {
            return res.status(400).json({ message: "Email is required" });
        }

        // Verify user exists
        const user = await UserModel.findOne({ email });
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        // Generate new token
        const newToken = jwt.sign(
            { email: user.email, name: user.name },
            process.env.JWT_SECRET || 'flashfire-secret-key-2024',
            { expiresIn: '7d' }
        );

        return res.status(200).json({
            message: 'Token refreshed successfully',
            token: newToken,
            userDetails: {
                name: user.name,
                email: user.email,
                planType: user.planType,
                userType: user.userType,
                planLimit: user.planLimit,
                resumeLink: user.resumeLink,
                coverLetters: user.coverLetters,
                optimizedResumes: user.optimizedResumes
            }
        });

    } catch (error) {
        console.error('Token refresh error:', error);
        return res.status(500).json({ message: "Internal server error" });
    }
}
