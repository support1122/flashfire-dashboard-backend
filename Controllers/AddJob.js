import mongoose from 'mongoose'
import { JobModel } from '../Schema_Models/JobModel.js';

export default async function AddJob(req, res) {
    let {jobDetails, userDetails} = req.body;
    
    try {
        
        // if(!req.body?.editjob){            
            await JobModel.create(jobDetails);
            let NewJobList = await JobModel.find({userID : jobDetails?.userID});
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