import mongoose from 'mongoose'
import { JobModel } from '../Schema_Models/JobModel.js';
import { ProfileModel } from '../Schema_Models/ProfileModel.js';
import { isClientLocked } from './operations/ClientOperations.js';
import { getExclusionBlockReason } from '../Utils/exclusionGuard.js';
import { sanitizeJobTitle } from '../Utils/jobTitle.js';
import { checkCap, detectOvershoot, checkPlanCap } from '../Utils/dailyCapGuard.js';

export default async function AddJob(req, res) {
    let { jobDetails, userDetails, role, operationsEmail, operationsName, extensionCode } = req.body;

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

        // Lifetime PLAN cap. Hard cap on TOTAL applications for this client
        // across all time, applied to both ops- and user-added jobs. Runs
        // BEFORE the daily cap so a client at lifetime limit can't push even
        // if the daily window has room. Skipped silently when no client is
        // resolvable (existing BAD_INPUT path below catches that for ops).
        if (clientForExclusions) {
            let planCheck;
            try {
                planCheck = await checkPlanCap(clientForExclusions);
            } catch (e) {
                console.error('dailyCapGuard.checkPlanCap failed:', e.message);
                return res.status(503).json({
                    success: false,
                    error: 'PLAN_CAP_CHECK_FAILED',
                    message: 'Could not verify plan limit (DB unavailable). Push refused — try again shortly.',
                });
            }
            if (!planCheck.allowed) {
                console.log(JSON.stringify({
                    event: 'plan.cap.hit',
                    client: clientForExclusions,
                    planType: planCheck.planType,
                    cap: planCheck.cap,
                    baseCap: planCheck.baseCap,
                    referralBonus: planCheck.referralBonus,
                    referralCount: planCheck.referralCount,
                    addonBonus: planCheck.addonBonus,
                    addonCount: planCheck.addonCount,
                    count: planCheck.count,
                    source: planCheck.source,
                    operator: operationsName || operationsEmail || (isOpsRole ? 'unknown-ops' : 'user'),
                    ts: new Date().toISOString(),
                }));
                return res.status(403).json({
                    success: false,
                    error: planCheck.reason || 'PLAN_LIMIT_REACHED',
                    message: planCheck.message,
                    cap: planCheck.cap,
                    baseCap: planCheck.baseCap,
                    referralBonus: planCheck.referralBonus,
                    referralCount: planCheck.referralCount,
                    addonBonus: planCheck.addonBonus,
                    addonCount: planCheck.addonCount,
                    current: planCheck.count,
                    remaining: 0,
                    planType: planCheck.planType,
                });
            }
        }

        // Daily-cap gate. Production rules (covered by dailyCapGuard.js):
        //   1. Ops pushes MUST resolve a client email — reject up-front
        //      otherwise (used to silently skip the cap check).
        //   2. Cap defaults to 30/day when admin hasn't set one — no
        //      unbounded route.
        //   3. DB errors propagate as 503 (fail-closed). Old code logged
        //      and let the push through.
        //   4. After insert, detectOvershoot() logs a structured warning
        //      when concurrent inserts raced past the limit.
        //   5. Cap counts ops jobs only since 00:00 IST today.
        if (isOpsRole) {
            if (!clientForExclusions) {
                return res.status(400).json({
                    success: false,
                    error: 'BAD_INPUT',
                    message: 'Operations push requires jobDetails.userID or userDetails.email — refusing without a client to attribute the push to.',
                });
            }
            let capCheck;
            try {
                capCheck = await checkCap(clientForExclusions);
            } catch (e) {
                console.error('dailyCapGuard.checkCap failed:', e.message, e.stack);
                if (e.code === 'BAD_INPUT') {
                    return res.status(400).json({ success: false, error: 'BAD_INPUT', message: e.message });
                }
                return res.status(503).json({
                    success: false,
                    error: 'CAP_CHECK_FAILED',
                    message: 'Could not verify daily cap (DB unavailable). Push refused — try again shortly.',
                });
            }
            if (!capCheck.allowed) {
                console.log(JSON.stringify({
                    event: 'cap.hit',
                    client: clientForExclusions,
                    cap: capCheck.cap,
                    count: capCheck.count,
                    isDefault: capCheck.isDefault,
                    operator: operationsName || operationsEmail || 'unknown',
                    ts: new Date().toISOString(),
                }));
                return res.status(403).json({
                    success: false,
                    error: capCheck.reason || 'TARGET_REACHED',
                    message: capCheck.message,
                    cap: capCheck.cap,
                    current: capCheck.count,
                    remaining: 0,
                    isDefaultCap: capCheck.isDefault,
                });
            }
            // Stash the snapshot so we can detectOvershoot() after insert.
            req._capSnapshot = capCheck;
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
            // Tag the 5-digit operator code so per-operator aggregation
            // works on JobModel.extensionCode (today-stats / activity).
            const code = String(extensionCode || '').trim();
            if (/^\d{5}$/.test(code)) jobDetails.extensionCode = code;
        } else {
            jobDetails.createdByRole = 'user';
            jobDetails.timeline = ['Added by user'];
            jobDetails.operatorName = 'user';
            jobDetails.operatorEmail = 'user@flashfirehq';
        }

        const createdJob = await JobModel.create(jobDetails);

        // Post-insert overshoot detection. Concurrent /addjob requests can
        // both pass the pre-check at cap-1 and both insert. Log structured
        // warning so ops can audit. Non-blocking, fire-and-forget.
        if (req._capSnapshot && clientForExclusions) {
            detectOvershoot(clientForExclusions, req._capSnapshot.cap).catch((err) => {
                console.warn('detectOvershoot threw:', err?.message);
            });
        }

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