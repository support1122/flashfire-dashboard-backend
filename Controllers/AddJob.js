import mongoose from 'mongoose'
import { JobModel } from '../Schema_Models/JobModel.js';
import { isClientLocked } from './operations/ClientOperations.js';
import { getExclusionBlockReason } from '../Utils/exclusionGuard.js';

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

        const clientForExclusions = jobDetails?.userID || userDetails?.email;
        if (clientForExclusions) {
            const blockReason = await getExclusionBlockReason(
                clientForExclusions,
                jobDetails?.companyName,
                jobDetails?.jobLocation
            );
            if (blockReason === "BLOCKED_COMPANY") {
                return res.status(403).json({
                    success: false,
                    error: "BLOCKED_COMPANY",
                    message: "This company is blocked for this client.",
                });
            }
            if (blockReason === "BLOCKED_LOCATION") {
                return res.status(403).json({
                    success: false,
                    error: "BLOCKED_LOCATION",
                    message: "This location is blocked for this client.",
                });
            }
        }
        
        // Always set an explicit auto-optimization state so ops can see what happened.
        if (jobDetails.jobDescription?.trim()) {
            jobDetails.autoOptimization = { status: 'pending', attempts: 0 };
        } else {
            jobDetails.autoOptimization = {
                status: 'skipped',
                attempts: 0,
                error: 'Skipped: missing job description'
            };
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