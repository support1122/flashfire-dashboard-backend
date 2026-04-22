import { JobModel } from "../Schema_Models/JobModel.js";
import { sanitizeJobTitle, normalizeWhitespace } from "../Utils/jobTitle.js";

export default async function CheckForDuplicateJobs(req, res, next) {
    let {jobDetails,userDetails } = req.body;
    // console.log(req.body)
    try {
       jobDetails = jobDetails || {};
       const normalizedTitle = sanitizeJobTitle(jobDetails.jobTitle);
       const normalizedCompany = normalizeWhitespace(jobDetails.companyName);
       jobDetails.jobTitle = normalizedTitle;

       if (!normalizedTitle) {
            return res.status(400).json({ message: "Job title is required and must be at most 50 characters." });
       }

       let existingJobDetails = await JobModel.findOne({
            userID: userDetails.email,
            jobTitle: { $regex: new RegExp("^" + normalizedTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$", "i") },
            companyName: { $regex: new RegExp("^" + normalizedCompany.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$", "i") }
        });
       if(existingJobDetails){
            //req.body.editjob = true;
            return res.status(403).json({message : 'Job Already Exist  !'});
            
       }
       else {
            next();
       }
       
    } catch (error) {
        console.log(error);
        return res.status(500).json({ message: "Error checking for duplicate jobs", error: error.message });
    }
}