import { JobModel } from "../../Schema_Models/JobModel.js";

export default async function GetAllJobsOPS(req,res) {
    let {email}= req.body;
    try {
        console.log(email)
        
        // Get all jobs and use lean() to get plain JavaScript objects with _id
        let allJobs = await JobModel.find({userID : email})
            .select('-jobDescription')
            .lean();
        
        // Ensure _id is converted to string for frontend compatibility
        allJobs = allJobs.map(job => ({
            ...job,
            _id: job._id.toString()
        }));
        
        console.log("all jobs ", allJobs)
        console.log('Operations GetAllJobs - Sample job with _id:', allJobs[0]?._id);
        
        res.status(200).json({
            message : 'all Jobs List',
            allJobs ,
        });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: "Failed to fetch jobs" });
    }
}