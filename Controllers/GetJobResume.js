import { JobModel } from "../Schema_Models/JobModel.js";

/**
 * Get resume data for a specific job ID
 * This endpoint is optimized for lazy loading resume data
 */
export default async function GetJobResume(req, res) {
    try {
        const { id } = req.body;

        if (!id) {
            return res.status(400).json({ 
                error: "Job ID is required",
                message: "Please provide a job ID to fetch the resume data"
            });
        }

        console.log('GetJobResume - Fetching resume for job ID:', id);
        let job;
        try {
            job = await JobModel.findById(id).select('resume jobTitle companyName jobID');
        } catch (error) {
            console.log('GetJobResume - Trying with jobID field for ID:', id);
            job = await JobModel.findOne({ jobID: id }).select('resume jobTitle companyName jobID');
        }
        
        if (!job) {
            console.log('GetJobResume - Job not found for ID:', id);
            return res.status(404).json({ 
                error: "Job not found",
                message: "No job found with the provided ID"
            });
        }

        if (!job.resume || !job.resume.data) {
            console.log('GetJobResume - No resume data found for job:', job.jobTitle);
            return res.status(404).json({ 
                error: "Resume not found",
                message: "No resume data found for this job"
            });
        }

        console.log('GetJobResume - Successfully fetched resume for job:', job.jobTitle);

        // Return the resume data with some context
        res.status(200).json({
            success: true,
            resume: job.resume,
            jobTitle: job.jobTitle,
            companyName: job.companyName,
            jobId: id
        });

    } catch (error) {
        console.error("GetJobResume error:", error);
        res.status(500).json({ 
            error: "Server error",
            message: "Failed to fetch resume data"
        });
    }
}

/**
 * Get resume data by URL parameter
 * Alternative endpoint for GET requests
 */
export const GetJobResumeByUrl = async (req, res) => {
    try {
        const { id } = req.params;

        if (!id) {
            return res.status(400).json({ 
                error: "Job ID is required in URL",
                message: "Please provide a job ID in the URL path"
            });
        }

        console.log('GetJobResumeByUrl - Fetching resume for job ID:', id);

        // Handle different job ID formats - try both _id and jobID fields
        let job;
        try {
            // First try with _id field (MongoDB ObjectId)
            job = await JobModel.findById(id).select('resume jobTitle companyName jobID');
        } catch (error) {
            // If _id fails, try with jobID field (custom ID format)
            console.log('GetJobResumeByUrl - Trying with jobID field for ID:', id);
            job = await JobModel.findOne({ jobID: id }).select('resume jobTitle companyName jobID');
        }
        
        if (!job) {
            console.log('GetJobResumeByUrl - Job not found for ID:', id);
            return res.status(404).json({ 
                error: "Job not found",
                message: "No job found with the provided ID"
            });
        }

        if (!job.resume || !job.resume.data) {
            console.log('GetJobResumeByUrl - No resume data found for job:', job.jobTitle);
            return res.status(404).json({ 
                error: "Resume not found",
                message: "No resume data found for this job"
            });
        }

        console.log('GetJobResumeByUrl - Successfully fetched resume for job:', job.jobTitle);

        res.status(200).json({
            success: true,
            resume: job.resume,
            jobTitle: job.jobTitle,
            companyName: job.companyName,
            jobId: id
        });

    } catch (error) {
        console.error("GetJobResumeByUrl error:", error);
        res.status(500).json({ 
            error: "Server error",
            message: "Failed to fetch resume data"
        });
    }
};
