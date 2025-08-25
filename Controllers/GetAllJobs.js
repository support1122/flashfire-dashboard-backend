import { JobModel } from "../Schema_Models/JobModel.js";
import { UserModel } from "../Schema_Models/UserModel.js";

export default async function GetAllJobs(req, res) {
    try {
        // Get user email from JWT token (set by LocalTokenValidator middleware)
        const userEmail = req.user?.email || req.body?.userDetails?.email;
        
        if (!userEmail) {
            return res.status(400).json({ message: "User email not found" });
        }

        let allJobs = await JobModel.find({ userID: userEmail });
        console.log(`Found ${allJobs.length} jobs for user: ${userEmail}`);
        
        res.status(200).json({
            message: 'All Jobs List',
            allJobs,
            count: allJobs.length
        });
    } catch (error) {
        console.error("GetAllJobs error:", error);
        res.status(500).json({ message: "Failed to fetch jobs" });
    }
}