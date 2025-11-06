/**
 * Migration script to move existing resume data from MongoDB to Cloudflare R2
 * 
 * This script:
 * 1. Finds all jobs with resume data stored in MongoDB
 * 2. Uploads the resume data to R2
 * 3. Updates the job document to reference the R2 key
 * 4. Optionally clears the old resume data from MongoDB to save space
 * 
 * Usage: node Utils/migrateResumeDataToR2.js [--dry-run] [--clear-old-data]
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { JobModel } from '../Schema_Models/JobModel.js';
import { uploadJSONToR2 } from './r2Storage.js';

dotenv.config();

// Parse command line arguments
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const clearOldData = args.includes('--clear-old-data');

console.log('\n=== Resume Data Migration to R2 ===');
console.log(`Mode: ${isDryRun ? 'DRY RUN (no changes will be made)' : 'LIVE'}`);
console.log(`Clear old data: ${clearOldData ? 'YES' : 'NO'}`);
console.log('=====================================\n');

async function migrateResumeData() {
    try {
        // Connect to MongoDB
        console.log('Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });
        console.log('✓ Connected to MongoDB\n');

        // Find all jobs that have resume data in MongoDB but not yet migrated to R2
        const query = {
            'optimizedResume.hasResume': true,
            'optimizedResume.resumeData': { $ne: null, $exists: true },
            $or: [
                { 'optimizedResume.storageType': { $in: ['mongodb', 'legacy'] } },
                { 'optimizedResume.storageType': { $exists: false } },
                { 'optimizedResume.resumeDataKey': { $exists: false } },
                { 'optimizedResume.resumeDataKey': null }
            ]
        };

        console.log('Searching for jobs with resume data to migrate...');
        const jobsToMigrate = await JobModel.find(query).select('jobID userID optimizedResume jobTitle companyName');
        
        console.log(`\nFound ${jobsToMigrate.length} jobs to migrate\n`);

        if (jobsToMigrate.length === 0) {
            console.log('No jobs to migrate. All done!');
            return;
        }

        let successCount = 0;
        let failureCount = 0;
        const failures = [];

        for (let i = 0; i < jobsToMigrate.length; i++) {
            const job = jobsToMigrate[i];
            const progress = `[${i + 1}/${jobsToMigrate.length}]`;
            
            console.log(`${progress} Processing job: ${job.jobTitle} at ${job.companyName} (ID: ${job.jobID})`);

            if (isDryRun) {
                console.log(`  [DRY RUN] Would upload resume data to R2 for user: ${job.userID}`);
                successCount++;
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
                    console.log(`  ✓ Uploaded to R2: ${r2Result.key}`);

                    // Update the job document
                    const updateData = {
                        'optimizedResume.resumeDataKey': r2Result.key,
                        'optimizedResume.storageType': 'r2'
                    };

                    // Optionally clear old data to save space
                    if (clearOldData) {
                        updateData['optimizedResume.resumeData'] = null;
                        console.log(`  ✓ Clearing old MongoDB data`);
                    }

                    await JobModel.updateOne(
                        { _id: job._id },
                        { $set: updateData }
                    );

                    console.log(`  ✓ Updated job document\n`);
                    successCount++;
                } else {
                    console.error(`  ✗ Failed to upload to R2: ${r2Result.error}\n`);
                    failureCount++;
                    failures.push({
                        jobID: job.jobID,
                        jobTitle: job.jobTitle,
                        error: r2Result.error
                    });
                }
            } catch (error) {
                console.error(`  ✗ Error migrating job: ${error.message}\n`);
                failureCount++;
                failures.push({
                    jobID: job.jobID,
                    jobTitle: job.jobTitle,
                    error: error.message
                });
            }
        }

        // Summary
        console.log('\n=== Migration Summary ===');
        console.log(`Total jobs: ${jobsToMigrate.length}`);
        console.log(`✓ Successful: ${successCount}`);
        console.log(`✗ Failed: ${failureCount}`);
        
        if (failures.length > 0) {
            console.log('\nFailed jobs:');
            failures.forEach((f, i) => {
                console.log(`  ${i + 1}. ${f.jobTitle} (${f.jobID}): ${f.error}`);
            });
        }
        
        console.log('========================\n');

    } catch (error) {
        console.error('Migration error:', error);
    } finally {
        // Close MongoDB connection
        await mongoose.connection.close();
        console.log('MongoDB connection closed');
    }
}

// Run migration
migrateResumeData()
    .then(() => {
        console.log('\nMigration complete!');
        process.exit(0);
    })
    .catch((error) => {
        console.error('\nMigration failed:', error);
        process.exit(1);
    });

