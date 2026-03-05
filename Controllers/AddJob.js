import mongoose from 'mongoose'
import { JobModel } from '../Schema_Models/JobModel.js';
import { isClientLocked } from './operations/ClientOperations.js';

export default async function AddJob(req, res) {
    let {jobDetails, userDetails, role, operationsEmail} = req.body;
    
    try {
        const isOperations = role === 'operations' || (operationsEmail && operationsEmail.endsWith('@flashfirehq'));
        
        if (isOperations && jobDetails?.userID) {
            const lockCheck = await isClientLocked(jobDetails.userID);
            if (lockCheck.isLocked) {
                return res.status(403).json({
                    success: false,
                    message: lockCheck.message || "Client is in lock period"
                });
            }
        }
        
        // Queue for auto-optimization if job has a description
        if (jobDetails.jobDescription?.trim()) {
            jobDetails.autoOptimization = { status: 'pending', attempts: 0 };
        }

        const createdJob = await JobModel.create(jobDetails);
        
        let NewJobList = await JobModel.find({userID : jobDetails?.userID}).lean();
        
        NewJobList = NewJobList.map(job => ({
            ...job,
            _id: job._id.toString()
        }));
        
        console.log('Job added successfully with _id:', createdJob._id);
        
        return res.status(200).json({
            message: 'job added succesfully',
            NewJobList,
            createdJobId: createdJob._id.toString()
        });
    } catch (error) {
        console.log(error);
        return res.status(500).json({ message: "Failed to add job", error: error.message });
    }
}