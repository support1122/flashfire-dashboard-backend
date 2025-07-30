import { JobModel } from "../Schema_Models/JobModel.js";

export default async function CheckForDuplicateJobs(req, res, next) {
    let {jobDetails,userDetails } = req.body;
    console.log(req.body)
    try {
       let existingJobDetails = await JobModel.findOne({jobID : jobDetails?.jobID});
       if(existingJobDetails){
            req.body.editjob = true;
            
       };
       console.log('did i log')
       next();
    } catch (error) {
        console.log(error);
    }
}