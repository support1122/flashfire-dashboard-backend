import { JobModel } from "../Schema_Models/JobModel.js";

export default async function CheckForDuplicateJobs(req, res, next) {
    let {jobDetails,userDetails } = req.body;
    // console.log(req.body)
    try {
       let existingJobDetails = await JobModel.findOne({userID : userDetails.email ,
                                                       jobTitle : jobDetails.jobTitle,
                                                       joblink : jobDetails.joblink,
                                                        companyName :jobDetails.companyName
                                                    });
       if(existingJobDetails){
            //req.body.editjob = true;
            return res.status(403).json({message : 'Job Already Exist  !..'});
            
       }
       else {
            next();
       }
       
    } catch (error) {
        console.log(error);
    }
}