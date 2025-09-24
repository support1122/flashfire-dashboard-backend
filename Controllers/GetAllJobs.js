import { JobModel } from "../Schema_Models/JobModel.js";
import { UserModel } from "../Schema_Models/UserModel.js";

export default async function GetAllJobs(req, res) {
    try {
        // Get user email from JWT token (set by LocalTokenValidator middleware)
        const userEmail = req.body?.email || req.body?.userDetails?.email || req.email;
        
        console.log('GetAllJobs - User email:', userEmail);
        
        if (!userEmail) {
            console.log('GetAllJobs - No user email found');
            return res.status(400).json({ message: "User email not found" });
        }

        // First, let's check if there are any jobs at all in the collection
        const totalJobs = await JobModel.countDocuments({});
        console.log('GetAllJobs - Total jobs in collection:', totalJobs);

        // Get all jobs for this user (excluding jobDescription for performance)
        let allJobs = await JobModel.find({ userID: userEmail }).select('-jobDescription');
        console.log(`GetAllJobs - Found ${allJobs.length} jobs for user: ${userEmail}`);
        
        // If no jobs found, let's check what userIDs exist in the jobs collection
        if (allJobs.length === 0) {
            const distinctUserIDs = await JobModel.distinct('userID');
            console.log('GetAllJobs - Distinct userIDs in jobs collection:', distinctUserIDs);
        }

        res.status(200).json({
            message: 'All Jobs List',
            allJobs,
            count: allJobs.length,
            userEmail: userEmail
        });
    } catch (error) {
        console.error("GetAllJobs error:", error);
        res.status(500).json({ message: "Failed to fetch jobs" });
    }
}