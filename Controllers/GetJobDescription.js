import { JobModel } from "../Schema_Models/JobModel.js";

/**
 * Get job description for a specific job ID
 * This endpoint is optimized for lazy loading job descriptions
 */
export default async function GetJobDescription(req, res) {
    try {
        const { id } = req.body;

        if (!id) {
            return res.status(400).json({ 
                error: "Job ID is required",
                message: "Please provide a job ID to fetch the description"
            });
        }

        console.log('GetJobDescription - Fetching description for job ID:', id);
        let job;
        try {
            job = await JobModel.findById(id).select('jobDescription jobTitle companyName');
        } catch (error) {
            console.log('GetJobDescription - Trying with jobID field for ID:', id);
            job = await JobModel.findOne({ jobID: id }).select('jobDescription jobTitle companyName');
        }
        
        if (!job) {
            console.log('GetJobDescription - Job not found for ID:', id);
            return res.status(404).json({ 
                error: "Job not found",
                message: "No job found with the provided ID"
            });
        }

        console.log('GetJobDescription - Successfully fetched description for job:', job.jobTitle);

        // Return the job description with some context
        res.status(200).json({
            success: true,
            jobDescription: job.jobDescription || '',
            jobTitle: job.jobTitle,
            companyName: job.companyName,
            jobId: id
        });

    } catch (error) {
        console.error("GetJobDescription error:", error);
        res.status(500).json({ 
            error: "Server error",
            message: "Failed to fetch job description"
        });
    }
}

/**
 * Get job description by URL parameter
 * Alternative endpoint for GET requests
 */
export const GetJobDescriptionByUrl = async (req, res) => {
    try {
        const { id } = req.params;

        if (!id) {
            return res.status(400).json({ 
                error: "Job ID is required in URL",
                message: "Please provide a job ID in the URL path"
            });
        }

        console.log('GetJobDescriptionByUrl - Fetching description for job ID:', id);

        // Handle different job ID formats - try both _id and jobID fields
        let job;
        try {
            // First try with _id field (MongoDB ObjectId)
            job = await JobModel.findById(id).select('jobDescription jobTitle companyName');
        } catch (error) {
            // If _id fails, try with jobID field (custom ID format)
            console.log('GetJobDescriptionByUrl - Trying with jobID field for ID:', id);
            job = await JobModel.findOne({ jobID: id }).select('jobDescription jobTitle companyName');
        }
        
        if (!job) {
            console.log('GetJobDescriptionByUrl - Job not found for ID:', id);
            return res.status(404).json({ 
                error: "Job not found",
                message: "No job found with the provided ID"
            });
        }

        console.log('GetJobDescriptionByUrl - Successfully fetched description for job:', job.jobTitle);

        res.status(200).json({
            success: true,
            jobDescription: job.jobDescription || '',
            jobTitle: job.jobTitle,
            companyName: job.companyName,
            jobId: id
        });

    } catch (error) {
        console.error("GetJobDescriptionByUrl error:", error);
        res.status(500).json({ 
            error: "Server error",
            message: "Failed to fetch job description"
        });
    }
};
