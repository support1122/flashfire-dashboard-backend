import { JobModel } from "../Schema_Models/JobModel.js";

export const resumeDownloaded = async (req, res) => {
    try {
        const { id } = req.body;

        if (!id) {
            return res.status(400).json({ 
                error: "Job ID is required",
                message: "Please provide a job ID to mark as downloaded"
            });
        }

        console.log('resumeDownloaded - Marking download for job ID:', id);
        
        let job;
        try {
            job = await JobModel.findById(id);
        } catch (error) {
            console.log('resumeDownloaded - Trying with jobID field for ID:', id);
            job = await JobModel.findOne({ jobID: id });
        }
        
        if (!job) {
            console.log('resumeDownloaded - Job not found for ID:', id);
            return res.status(404).json({ 
                error: "Job not found",
                message: "No job found with the provided ID"
            });
        }

        job.downloaded = true;
        await job.save();
        
        console.log('resumeDownloaded - Successfully marked job as downloaded:', job.jobTitle);
        res.status(200).json({ 
            success: true,
            message: "Job marked as downloaded",
            jobId: id
        });
    } catch (error) {
        console.error("resumeDownloaded error:", error);
        res.status(500).json({ 
            error: "Server error",
            message: "Failed to mark job as downloaded"
        });
    }
}
