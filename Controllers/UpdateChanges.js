import { JobModel } from "../Schema_Models/JobModel.js";

export default async function UpdateChanges(req, res) {
    let {jobID, userDetails, action} = req.body;
    try {
        if(action == 'UpdateStatus'){
            await JobModel.findOneAndUpdate(
            { jobID, userID : userDetails?.email },
            {
                $set: { currentStatus: req.body?.status },
                $push: { timeline: req.body?.status }
            }
            );        }
        else if(action == 'edit'){
            await JobModel.findOneAndUpdate({jobID},{});
        }
        else if(action == 'delete'){
            await JobModel.findOneAndDelete({jobID, userID : userDetails.email});
        }
        let updatedJobs = await JobModel.find({userID : userDetails.email});
        res.status(200).json({message : 'Jobs updated successfully',
                              updatedJobs  
                            })
    } catch (error) {
        console.log(error)
    }
}