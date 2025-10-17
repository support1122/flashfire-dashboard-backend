import { ProfileModel } from "../Schema_Models/ProfileModel.js";

export default async function CheckProfile(req, res) {
    try {
        const { email } = req.body;
        
        if (!email) {
            return res.status(400).json({ 
                hasProfile: false,
                message: "Email is required" 
            });
        }

        // Check if profile exists with this email
        const profile = await ProfileModel.findOne({ email });
        
        // Return true if profile exists and has email, false otherwise
        const hasProfile = profile && profile.email && profile.email.length > 0;
        
        return res.status(200).json({
            hasProfile: hasProfile
        });

    } catch (error) {
        console.error("CheckProfile error:", error);
        return res.status(500).json({ 
            hasProfile: false,
            message: "Internal server error" 
        });
    }
}

