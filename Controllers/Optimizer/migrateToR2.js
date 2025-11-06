import { JobModel } from "../../Schema_Models/JobModel.js";
import { uploadJSONToR2 } from "../../Utils/r2Storage.js";

/**
 * Migration controller to move legacy resumeData from MongoDB to R2
 * This endpoint should be called via Postman (no authentication needed but should be secured)
 * 
 * POST /api/migrate-resume-data-to-r2
 * Body: {
 *   "dryRun": true,  // Set to false to actually perform migration
 *   "clearOldData": false,  // Set to true to remove resumeData from MongoDB after migration
 *   "batchSize": 10  // Number of jobs to process at once
 * }
 */
export const migrateResumeDataToR2 = async (req, res) => {
    try {
        const { dryRun = true, clearOldData = false, batchSize = 10 } = req.body;

        console.log('\n========================================');
        console.log('🚀 RESUME DATA MIGRATION TO R2');
        console.log('========================================');
        console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE MIGRATION'}`);
        console.log(`Clear Old Data: ${clearOldData ? 'YES' : 'NO'}`);
        console.log(`Batch Size: ${batchSize}`);
        console.log('========================================\n');

        // Find all jobs that have legacy resumeData in MongoDB
        // These are jobs where optimizedResume.resumeData exists
        const legacyJobs = await JobModel.find({
            'optimizedResume.hasResume': true,
            $or: [
                { 'optimizedResume.storageType': 'legacy' },
                { 'optimizedResume.storageType': 'mongodb' },
                { 'optimizedResume.storageType': { $exists: false } }
            ]
        }).lean();

        console.log(`📊 Found ${legacyJobs.length} jobs with potential legacy resume data\n`);

        if (legacyJobs.length === 0) {
            return res.json({
                success: true,
                message: 'No legacy jobs found to migrate',
                stats: {
                    totalJobs: 0,
                    migrated: 0,
                    failed: 0,
                    skipped: 0
                }
            });
        }

        // Filter jobs that actually have resumeData field
        const jobsToMigrate = [];
        for (const job of legacyJobs) {
            // Check if resumeData exists in the optimizedResume object
            const fullJob = await JobModel.findById(job._id).lean();
            if (fullJob?.optimizedResume?.resumeData) {
                jobsToMigrate.push(fullJob);
            }
        }

        console.log(`✅ Found ${jobsToMigrate.length} jobs with actual resumeData to migrate\n`);

        if (jobsToMigrate.length === 0) {
            return res.json({
                success: true,
                message: 'No jobs with resumeData found to migrate (all already migrated or no data)',
                stats: {
                    totalJobs: legacyJobs.length,
                    migrated: 0,
                    failed: 0,
                    skipped: legacyJobs.length
                }
            });
        }

        let successCount = 0;
        let failCount = 0;
        const failures = [];
        const migrationDetails = [];

        // Process in batches
        for (let i = 0; i < jobsToMigrate.length; i += batchSize) {
            const batch = jobsToMigrate.slice(i, Math.min(i + batchSize, jobsToMigrate.length));
            
            console.log(`\n📦 Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(jobsToMigrate.length / batchSize)}`);
            console.log(`   Jobs ${i + 1} to ${Math.min(i + batchSize, jobsToMigrate.length)}\n`);

            for (const job of batch) {
                const progress = `[${i + 1}/${jobsToMigrate.length}]`;
                
                console.log(`${progress} Processing: ${job.jobTitle} at ${job.companyName}`);
                console.log(`   Job ID: ${job.jobID}`);
                console.log(`   User: ${job.userID}`);

                if (dryRun) {
                    console.log(`   ✓ [DRY RUN] Would upload resume data to R2\n`);
                    successCount++;
                    migrationDetails.push({
                        jobId: job.jobID,
                        jobTitle: job.jobTitle,
                        companyName: job.companyName,
                        userID: job.userID,
                        status: 'dry-run',
                        message: 'Would be migrated to R2'
                    });
                    continue;
                }

                try {
                    // Upload resume data to R2
                    const r2Result = await uploadJSONToR2(job.optimizedResume.resumeData, {
                        clientName: job.userID,
                        jobID: job.jobID,
                        folder: 'flashfirejobs'
                    });

                    if (r2Result.success) {
                        console.log(`   ✓ Uploaded to R2: ${r2Result.key}`);

                        // Update the job document
                        const updateData = {
                            'optimizedResume.resumeDataKey': r2Result.key,
                            'optimizedResume.storageType': 'r2'
                        };

                        // Optionally clear old data to save MongoDB space
                        if (clearOldData) {
                            updateData['optimizedResume.resumeData'] = null;
                            console.log(`   ✓ Clearing old MongoDB data`);
                        }

                        await JobModel.updateOne(
                            { _id: job._id },
                            { $set: updateData }
                        );

                        console.log(`   ✓ Updated job document\n`);
                        successCount++;
                        
                        migrationDetails.push({
                            jobId: job.jobID,
                            jobTitle: job.jobTitle,
                            companyName: job.companyName,
                            userID: job.userID,
                            status: 'success',
                            r2Key: r2Result.key,
                            dataCleared: clearOldData
                        });
                    } else {
                        console.error(`   ✗ Failed to upload to R2: ${r2Result.error}\n`);
                        failCount++;
                        failures.push({
                            jobId: job.jobID,
                            jobTitle: job.jobTitle,
                            error: r2Result.error
                        });
                        
                        migrationDetails.push({
                            jobId: job.jobID,
                            jobTitle: job.jobTitle,
                            companyName: job.companyName,
                            userID: job.userID,
                            status: 'failed',
                            error: r2Result.error
                        });
                    }
                } catch (error) {
                    console.error(`   ✗ Error processing job: ${error.message}\n`);
                    failCount++;
                    failures.push({
                        jobId: job.jobID,
                        jobTitle: job.jobTitle,
                        error: error.message
                    });
                    
                    migrationDetails.push({
                        jobId: job.jobID,
                        jobTitle: job.jobTitle,
                        companyName: job.companyName,
                        userID: job.userID,
                        status: 'error',
                        error: error.message
                    });
                }
            }
        }

        console.log('\n========================================');
        console.log('📊 MIGRATION SUMMARY');
        console.log('========================================');
        console.log(`Total Jobs Found: ${legacyJobs.length}`);
        console.log(`Jobs to Migrate: ${jobsToMigrate.length}`);
        console.log(`✅ Success: ${successCount}`);
        console.log(`❌ Failed: ${failCount}`);
        console.log(`⏭️  Skipped: ${legacyJobs.length - jobsToMigrate.length}`);
        console.log('========================================\n');

        if (failures.length > 0) {
            console.log('❌ Failed migrations:');
            failures.forEach(f => {
                console.log(`   - ${f.jobTitle} (${f.jobId}): ${f.error}`);
            });
            console.log('');
        }

        return res.json({
            success: true,
            message: dryRun 
                ? `DRY RUN completed - ${successCount} jobs would be migrated` 
                : `Migration completed - ${successCount} jobs migrated successfully`,
            stats: {
                totalJobsFound: legacyJobs.length,
                jobsWithResumeData: jobsToMigrate.length,
                migrated: successCount,
                failed: failCount,
                skipped: legacyJobs.length - jobsToMigrate.length
            },
            mode: dryRun ? 'dry-run' : 'live',
            clearOldData,
            failures: failures.length > 0 ? failures : undefined,
            details: migrationDetails
        });

    } catch (error) {
        console.error('❌ Migration error:', error);
        return res.status(500).json({
            success: false,
            error: 'Migration failed',
            message: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
};

/**
 * Get migration status - check how many jobs still need migration
 * 
 * GET /api/migration-status
 */
export const getMigrationStatus = async (req, res) => {
    try {
        // Count jobs by storage type
        const totalJobs = await JobModel.countDocuments({
            'optimizedResume.hasResume': true
        });

        const r2Jobs = await JobModel.countDocuments({
            'optimizedResume.hasResume': true,
            'optimizedResume.storageType': 'r2'
        });

        const legacyJobs = await JobModel.countDocuments({
            'optimizedResume.hasResume': true,
            $or: [
                { 'optimizedResume.storageType': 'legacy' },
                { 'optimizedResume.storageType': 'mongodb' },
                { 'optimizedResume.storageType': { $exists: false } }
            ]
        });

        // Check if any of the legacy jobs actually have resumeData
        const legacyJobsWithData = await JobModel.find({
            'optimizedResume.hasResume': true,
            $or: [
                { 'optimizedResume.storageType': 'legacy' },
                { 'optimizedResume.storageType': 'mongodb' },
                { 'optimizedResume.storageType': { $exists: false } }
            ]
        }).select('jobID jobTitle companyName optimizedResume.storageType').lean();

        let jobsNeedingMigration = 0;
        const sampleJobsNeedingMigration = [];

        for (const job of legacyJobsWithData) {
            const fullJob = await JobModel.findById(job._id).lean();
            if (fullJob?.optimizedResume?.resumeData) {
                jobsNeedingMigration++;
                if (sampleJobsNeedingMigration.length < 5) {
                    sampleJobsNeedingMigration.push({
                        jobID: job.jobID,
                        jobTitle: job.jobTitle,
                        companyName: job.companyName,
                        storageType: job.optimizedResume?.storageType || 'none'
                    });
                }
            }
        }

        return res.json({
            success: true,
            status: {
                totalJobsWithResumes: totalJobs,
                migratedToR2: r2Jobs,
                legacyJobs: legacyJobs,
                jobsNeedingMigration: jobsNeedingMigration,
                migrationComplete: jobsNeedingMigration === 0,
                percentageMigrated: totalJobs > 0 ? Math.round((r2Jobs / totalJobs) * 100) : 0
            },
            sampleJobsNeedingMigration: sampleJobsNeedingMigration.length > 0 ? sampleJobsNeedingMigration : undefined,
            message: jobsNeedingMigration === 0 
                ? 'All jobs have been migrated to R2' 
                : `${jobsNeedingMigration} jobs need migration to R2`
        });

    } catch (error) {
        console.error('Error checking migration status:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to check migration status',
            message: error.message
        });
    }
};

