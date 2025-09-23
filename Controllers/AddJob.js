import mongoose from 'mongoose'
import { JobModel } from '../Schema_Models/JobModel.js';

export default async function AddJob(req, res) {
    let {jobDetails, userDetails, jobData} = req.body;
    
    // Handle different payload structures
    let actualJobDetails = jobDetails || jobData;
    let userEmail = userDetails?.email || actualJobDetails?.userID;
    
    console.log('AddJob - req.body:', req.body);
    console.log('AddJob - actualJobDetails:', actualJobDetails);
    console.log('AddJob - userEmail:', userEmail);
    
    if (!actualJobDetails || !userEmail) {
        return res.status(400).json({ message: "Missing job details or user email" });
    }
    
    try {
        
        // if(!req.body?.editjob){            
            await JobModel.create(actualJobDetails);
            let NewJobList = await JobModel.find({userID : userEmail});
            // console.log(NewJobList)
            // console.log('adding job..')
            return res.status(200).json({message : 'job added succesfully',
                                        NewJobList   
                                        });
       // }
        // else if(req.body.editjob){
        //     await JobModel.findOneAndUpdate(
        //         { jobID: jobDetails.jobID },
        //         { $set: jobDetails }
        //         );
        //     let NewJobList = await JobModel.find({userID : jobDetails?.userID});
        //     console.log('editting job')  
        //     return res.status(200).json({message : 'job edited succesfully',
        //                                 NewJobList   
        //                                 });
                                          
        // }
    } catch (error) {
        console.log(error);
        return res.status(500).json({ message: "Failed to add job", error: error.message });
    }
}