/**
 * Quick test to verify R2 upload works
 */
import dotenv from 'dotenv';
import { uploadJSONToR2, getJSONFromR2 } from './Utils/r2Storage.js';

dotenv.config();

console.log('\n🧪 Testing R2 Connection...\n');
console.log('R2_ENDPOINT:', process.env.R2_ENDPOINT);
console.log('R2_BUCKET_NAME:', process.env.R2_BUCKET_NAME);
console.log('R2_ACCESS_KEY_ID:', process.env.R2_ACCESS_KEY_ID ? '✓ Set' : '✗ Not set');
console.log('R2_SECRET_ACCESS_KEY:', process.env.R2_SECRET_ACCESS_KEY ? '✓ Set' : '✗ Not set\n');

async function testR2() {
    try {
        // Test data
        const testData = {
            test: true,
            timestamp: new Date().toISOString(),
            message: "This is a test upload to R2"
        };

        console.log('📤 Uploading test data to R2...');
        const uploadResult = await uploadJSONToR2(testData, {
            clientName: 'test_user',
            jobID: 'test_' + Date.now(),
            folder: 'flashfirejobs'
        });

        if (uploadResult.success) {
            console.log('✅ Upload successful!');
            console.log('   Key:', uploadResult.key);
            console.log('   Size:', uploadResult.size, 'bytes');
            
            console.log('\n📥 Fetching data back from R2...');
            const fetchResult = await getJSONFromR2(uploadResult.key);
            
            if (fetchResult.success) {
                console.log('✅ Fetch successful!');
                console.log('   Data:', JSON.stringify(fetchResult.data, null, 2));
                
                console.log('\n🎉 R2 connection is working perfectly!');
                console.log('You can now run the migration script:\n');
                console.log('   node Utils/migrateResumeDataToR2.js\n');
            } else {
                console.error('❌ Fetch failed:', fetchResult.error);
            }
        } else {
            console.error('❌ Upload failed:', uploadResult.error);
            console.log('\n💡 Please check your R2 credentials in .env file');
        }
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        console.log('\n💡 Troubleshooting:');
        console.log('   1. Check R2_ENDPOINT format (no trailing path)');
        console.log('   2. Verify R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY');
        console.log('   3. Ensure R2_BUCKET_NAME exists');
        console.log('   4. Check network connectivity');
    }
}

testR2();

