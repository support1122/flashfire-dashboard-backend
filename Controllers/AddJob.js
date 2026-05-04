import mongoose from 'mongoose'
import { JobModel } from '../Schema_Models/JobModel.js';
import { ProfileModel } from '../Schema_Models/ProfileModel.js';
import { isClientLocked } from './operations/ClientOperations.js';
import { getExclusionBlockReason } from '../Utils/exclusionGuard.js';
import { sanitizeJobTitle } from '../Utils/jobTitle.js';

// Daily cap window: ops jobs are counted from 00:00 Asia/Kolkata each day.
// IST is UTC+5:30 fixed (no DST), so we shift the wall-clock IST midnight back
// to its UTC equivalent. Returned Date is UTC; pair with an _id ObjectId range
// for an indexed aggregation that does not depend on createdAt's string format.
function startOfTodayIST() {
    const offsetMs = 5.5 * 60 * 60 * 1000;
    const istNow = new Date(Date.now() + offsetMs);
    istNow.setUTCHours(0, 0, 0, 0);
    return new Date(istNow.getTime() - offsetMs);
}

export default async function AddJob(req, res) {
    let { jobDetails, userDetails, role, operationsEmail, operationsName } = req.body;

    try {
        jobDetails = jobDetails || {};
        jobDetails.jobTitle = sanitizeJobTitle(jobDetails?.jobTitle);
        if (!jobDetails.jobTitle) {
            return res.status(400).json({
                success: false,
                message: "Job title is required and must be at most 50 characters."
            });
        }

        const isOpsRole = role === 'operations' || role === 'operator';
        const isOperations =
            isOpsRole ||
            (operationsEmail && String(operationsEmail).endsWith('@flashfirehq'));

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

        // Target-job-count cap. Refuse new ops pushes once the operator-set
        // limit has been reached. Applies only to operations role; user
        // role is unaffected (clients can still self-track).
        if (isOpsRole && clientForExclusions) {
            try {
                const profile = await ProfileModel.findOne(
                    { email: String(clientForExclusions).toLowerCase() },
                    { targetJobCount: 1 },
                ).lean();
                const cap = Number(profile?.targetJobCount);
                if (Number.isFinite(cap) && cap > 0) {
                    // Daily window — count only ops jobs created since today's
                    // 00:00 IST. Resets every midnight, not 24h sliding.
                    const since = startOfTodayIST();
                    const sinceSeconds = Math.floor(since.getTime() / 1000);
                    const oidLowHex = sinceSeconds.toString(16).padStart(8, '0') + '0000000000000000';
                    const ObjectId = JobModel.base.Types.ObjectId;
                    const opsCount = await JobModel.countDocuments({
                        userID: String(clientForExclusions).toLowerCase(),
                        createdByRole: 'operations',
                        _id: { $gte: new ObjectId(oidLowHex) },
                    });
                    if (opsCount >= cap) {
                        return res.status(403).json({
                            success: false,
                            error: 'TARGET_REACHED',
                            message: `Daily target reached (${opsCount}/${cap} today). Resets at 00:00 IST or raise the target on the dashboard.`,
                            cap,
                            current: opsCount,
                        });
                    }
                }
            } catch (e) {
                console.warn('TARGET_REACHED check failed:', e.message);
            }
        }

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

        const opsDisplayName =
            (operationsName && String(operationsName).trim()) ||
            (userDetails?.name && String(userDetails.name).trim()) ||
            'operations';

        if (isOpsRole) {
            jobDetails.createdByRole = 'operations';
            jobDetails.timeline = ['Added'];
            jobDetails.operatorName = opsDisplayName;
            jobDetails.operatorEmail = operationsEmail || 'operations@flashfirehq';
            jobDetails.addedBy = opsDisplayName;
        } else {
            jobDetails.createdByRole = 'user';
            jobDetails.timeline = ['Added by user'];
            jobDetails.operatorName = 'user';
            jobDetails.operatorEmail = 'user@flashfirehq';
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