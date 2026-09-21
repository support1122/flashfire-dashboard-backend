import { UserModel } from "../../Schema_Models/UserModel.js";
import { ProfileModel } from "../../Schema_Models/ProfileModel.js";
import { getAppSettings } from "../../Schema_Models/AppSettings.js";
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken'
import { decrypt } from "../../Utils/CryptoHelper.js";
dotenv.config();

export default async function ClientLogin(req, res) {
    const { email, password } = req.body;
    
    try {
        const existanceOfUser = await UserModel.findOne({ email });
        
        if (!existanceOfUser) {
            return res.status(401).json({ message: "User not found" });
        }

        // Check password
        let passwordDecrypted = decrypt(existanceOfUser.passwordHashed);
        if (passwordDecrypted === password) {
            // Find user profile
            let profileLookUp = await ProfileModel.findOne({email});

            // Inject the global OpenAI key as a fallback when the per-client
            // profile doesn't carry one. Extension prefers profile.openaiKey;
            // by overlaying global onto a missing/empty value here we keep
            // the extension code unchanged.
            if (profileLookUp) {
                const existingKey = (profileLookUp.openaiKey || "").trim();
                if (!existingKey) {
                    try {
                        const settings = await getAppSettings();
                        const globalKey = (settings?.globalOpenaiKey || "").trim();
                        if (globalKey) {
                            profileLookUp = profileLookUp.toObject ? profileLookUp.toObject() : profileLookUp;
                            profileLookUp.openaiKey = globalKey;
                        }
                    } catch (e) {
                        console.warn("clientLogin global-key fallback failed:", e.message);
                    }
                }
            }

            return res.status(200).json({
                message: 'Login Success..!',
                userDetails: { 
                    name: existanceOfUser.name, 
                    email, 
                    planType: existanceOfUser.planType, 
                    preferredRoles: Array.isArray(profileLookUp?.preferredRoles) ? profileLookUp.preferredRoles : [],
                    preferredLocations: Array.isArray(profileLookUp?.preferredLocations) ? profileLookUp.preferredLocations : []
                    // userType: existanceOfUser.userType, 
                    // planLimit: existanceOfUser.planLimit, 
                    // resumeLink: existanceOfUser.resumeLink, 
                    // coverLetters: existanceOfUser.coverLetters, 
                    // optimizedResumes: existanceOfUser.optimizedResumes 
                },
                token: jwt.sign({ email }, process.env.JWT_SECRET || 'your-secret-key', { expiresIn: '7d' }),
                userProfile: profileLookUp?.email?.length > 0 ? profileLookUp : null
            });

        } else {
            return res.status(401).json({ message: "Invalid password" });
        }

    } catch (error) {
        console.log(error);
        res.status(500).json({ message: "Internal server error" });
    }
}
