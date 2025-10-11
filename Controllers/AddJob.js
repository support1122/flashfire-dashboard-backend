import mongoose from 'mongoose'
import { JobModel } from '../Schema_Models/JobModel.js';

export default async function AddJob(req, res) {
    let {jobDetails, userDetails} = req.body;
    
    try {
        // Create the job and get the created document
        const createdJob = await JobModel.create(jobDetails);
        
        // Get all jobs for the user with _id as string
        let NewJobList = await JobModel.find({userID : jobDetails?.userID}).lean();
        
        // Convert _id to string for all jobs
        NewJobList = NewJobList.map(job => ({
            ...job,
            _id: job._id.toString()
        }));
        
        console.log('Job added successfully with _id:', createdJob._id);
        
        return res.status(200).json({
            message: 'job added succesfully',
            NewJobList,
            createdJobId: createdJob._id.toString() // Return the created job's _id
        });
    } catch (error) {
        console.log(error);
        return res.status(500).json({ message: "Failed to add job", error: error.message });
    }
}