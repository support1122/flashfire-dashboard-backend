/**
 * Test script to verify R2 storage for resume data
 * Run with: node test-resume-r2-flow.js
 */

import dotenv from 'dotenv';
import { uploadJSONToR2, getJSONFromR2 } from './Utils/r2Storage.js';

dotenv.config();

const testResumeData = {
    personalInfo: {
        name: "John Doe",
        email: "john@example.com",
        phone: "+1234567890",
        location: "San Francisco, CA"
    },
    summary: "Experienced software engineer with 5+ years in full-stack development",
    workExperience: [
        {
            company: "Tech Corp",
            position: "Senior Software Engineer",
            startDate: "Jan 2020",
            endDate: "Present",
            responsibilities: [
                "Led development of microservices architecture",
                "Mentored junior developers",
                "Improved system performance by 40%"
            ]
        }
    ],
    skills: {
        technical: ["JavaScript", "React", "Node.js", "MongoDB", "AWS"],
        soft: ["Leadership", "Communication", "Problem Solving"]
    },
    education: [
        {
            institution: "University of California",
            degree: "BS in Computer Science",
            year: "2018"
        }
    ]
};

async function testR2ResumeFlow() {
    console.log('\n========================================');
    console.log('🧪 Testing R2 Resume Data Flow');
    console.log('========================================\n');

    try {
        // Test 1: Upload JSON
        console.log('📤 Test 1: Uploading resume data to R2...');
        const uploadResult = await uploadJSONToR2(testResumeData, {
            clientName: 'test_user@example.com',
            jobID: 'test_job_' + Date.now(),
            folder: 'flashfirejobs'
        });

        if (!uploadResult.success) {
            console.error('❌ Upload failed:', uploadResult.error);
            console.log('\n⚠️  Check your R2 credentials in .env file:');
            console.log('   - R2_ACCOUNT_ID');
            console.log('   - R2_ACCESS_KEY_ID');
            console.log('   - R2_SECRET_ACCESS_KEY');
            console.log('   - R2_BUCKET_NAME\n');
            process.exit(1);
        }

        console.log('✅ Upload successful!');
        console.log('   Key:', uploadResult.key);
        console.log('   Size:', uploadResult.size, 'bytes');
        console.log('   Storage:', uploadResult.storage);

        // Test 2: Retrieve JSON
        console.log('\n📥 Test 2: Retrieving resume data from R2...');
        const retrieveResult = await getJSONFromR2(uploadResult.key);

        if (!retrieveResult.success) {
            console.error('❌ Retrieve failed:', retrieveResult.error);
            process.exit(1);
        }

        console.log('✅ Retrieve successful!');
        console.log('   Retrieved', Object.keys(retrieveResult.data).length, 'fields');

        // Test 3: Verify data integrity
        console.log('\n🔍 Test 3: Verifying data integrity...');
        const originalKeys = Object.keys(testResumeData).sort();
        const retrievedKeys = Object.keys(retrieveResult.data).sort();

        if (JSON.stringify(originalKeys) !== JSON.stringify(retrievedKeys)) {
            console.error('❌ Data integrity check failed - keys mismatch');
            console.log('Original keys:', originalKeys);
            console.log('Retrieved keys:', retrievedKeys);
            process.exit(1);
        }

        if (retrieveResult.data.personalInfo.name !== testResumeData.personalInfo.name) {
            console.error('❌ Data integrity check failed - data mismatch');
            process.exit(1);
        }

        console.log('✅ Data integrity verified!');
        console.log('   All fields match');
        console.log('   Sample: Name =', retrieveResult.data.personalInfo.name);

        // Test 4: Calculate savings
        console.log('\n💰 Test 4: Calculating storage savings...');
        const jsonSize = JSON.stringify(testResumeData).length;
        const keySize = uploadResult.key.length;
        const savingsPerJob = jsonSize - keySize;
        const savingsPercentage = ((savingsPerJob / jsonSize) * 100).toFixed(2);

        console.log('   Resume data size:', jsonSize, 'bytes');
        console.log('   R2 key size:', keySize, 'bytes');
        console.log('   Savings per job:', savingsPerJob, 'bytes');
        console.log('   Savings percentage:', savingsPercentage + '%');

        console.log('\n   💡 For 100 jobs:');
        console.log('      MongoDB size without R2:', (jsonSize * 100 / 1024).toFixed(2), 'KB');
        console.log('      MongoDB size with R2:', (keySize * 100 / 1024).toFixed(2), 'KB');
        console.log('      Space saved:', ((savingsPerJob * 100) / 1024).toFixed(2), 'KB');

        console.log('\n   💡 For 1000 jobs:');
        console.log('      MongoDB size without R2:', (jsonSize * 1000 / 1024 / 1024).toFixed(2), 'MB');
        console.log('      MongoDB size with R2:', (keySize * 1000 / 1024 / 1024).toFixed(2), 'MB');
        console.log('      Space saved:', ((savingsPerJob * 1000) / 1024 / 1024).toFixed(2), 'MB');

        console.log('\n========================================');
        console.log('✅ All Tests Passed!');
        console.log('========================================');
        console.log('\n🎉 Your R2 storage is configured correctly!');
        console.log('📝 Next steps:');
        console.log('   1. Run migration status check in Postman');
        console.log('   2. Run dry run migration');
        console.log('   3. Run actual migration');
        console.log('\n   See QUICK_START_MIGRATION.md for details\n');

        process.exit(0);

    } catch (error) {
        console.error('\n❌ Test failed with error:', error.message);
        console.log('\n⚠️  Troubleshooting:');
        console.log('   1. Check R2 credentials in .env');
        console.log('   2. Verify bucket exists and is accessible');
        console.log('   3. Check network connectivity');
        console.log('   4. Review backend logs for details\n');
        process.exit(1);
    }
}

// Run tests
testR2ResumeFlow();

