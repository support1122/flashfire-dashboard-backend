/**
 * Test script for image caching functionality
 * Run: node test-cache.js
 */

import { getCachedPresignedUrl, getCacheStats, clearAllCache } from './Utils/imageCache.js';
import dotenv from 'dotenv';

dotenv.config();

console.log('🧪 Testing Image Caching System...\n');

// Test URL (replace with actual R2 URL from your uploads)
const testUrl = 'https://pub-9122bde92eac495f8beda15ee45552dd.r2.dev/test/flashfirejobs/attachments/test-image.png';

async function testCaching() {
  try {
    console.log('📊 Initial cache stats:');
    let stats = getCacheStats();
    console.log(`  Size: ${stats.size}/${stats.maxSize}`);
    console.log('');

    console.log('🔄 Test 1: First request (should be cache MISS)');
    const start1 = Date.now();
    const result1 = await getCachedPresignedUrl(testUrl);
    const time1 = Date.now() - start1;
    
    console.log(`  Success: ${result1.success}`);
    console.log(`  Cached: ${result1.cached}`);
    console.log(`  Time: ${time1}ms`);
    console.log('');

    console.log('🔄 Test 2: Second request (should be cache HIT)');
    const start2 = Date.now();
    const result2 = await getCachedPresignedUrl(testUrl);
    const time2 = Date.now() - start2;
    
    console.log(`  Success: ${result2.success}`);
    console.log(`  Cached: ${result2.cached}`);
    console.log(`  Time: ${time2}ms`);
    console.log('');

    console.log('📊 Final cache stats:');
    stats = getCacheStats();
    console.log(`  Size: ${stats.size}/${stats.maxSize}`);
    console.log(`  Entries: ${stats.entries.length}`);
    console.log('');

    console.log('🧹 Clearing cache...');
    clearAllCache();
    
    console.log('📊 Cache stats after clear:');
    stats = getCacheStats();
    console.log(`  Size: ${stats.size}/${stats.maxSize}`);
    console.log('');

    console.log('✅ Cache test completed successfully!');
    console.log('');
    console.log('💡 Expected results:');
    console.log('  - First request: Cache MISS (slower)');
    console.log('  - Second request: Cache HIT (faster)');
    console.log('  - Cache size increases after first request');
    console.log('  - Cache clears successfully');

  } catch (error) {
    console.error('❌ Cache test failed:', error);
    console.log('');
    console.log('🔧 Troubleshooting:');
    console.log('  1. Make sure backend is running');
    console.log('  2. Check R2 credentials in .env');
    console.log('  3. Verify the test URL is valid');
  }
}

// Run the test
testCaching().then(() => {
  process.exit(0);
}).catch((error) => {
  console.error('Test failed:', error);
  process.exit(1);
});
