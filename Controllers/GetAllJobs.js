import mongoose from "mongoose";
import { JobModel } from "../Schema_Models/JobModel.js";

export default async function GetAllJobs(req,res) {
    let {userDetails}= req.body;
    try {
        let allJobs = await JobModel.find({userID : userDetails?.email})
        console.log(allJobs,'desc');
        res.status(200).json({message : 'all Jobs List',
                              allJobs                  
                            });
    } catch (error) {
        console.log(error)
    }
}