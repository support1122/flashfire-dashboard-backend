/**
 * Test script for storage configuration
 * Run: node test-storage.js
 */

import dotenv from 'dotenv';
import { validateStorageConfig } from './Utils/storageService.js';

dotenv.config();

console.log('🔍 Testing Storage Configuration...\n');

// Check environment variables
console.log('📋 Environment Variables:');
console.log('USE_R2_FOR_NEW_UPLOADS:', process.env.USE_R2_FOR_NEW_UPLOADS);
console.log('R2_ENDPOINT:', process.env.R2_ENDPOINT ? '✓ Set' : '✗ Not set');
console.log('R2_ACCESS_KEY_ID:', process.env.R2_ACCESS_KEY_ID ? '✓ Set' : '✗ Not set');
console.log('R2_SECRET_ACCESS_KEY:', process.env.R2_SECRET_ACCESS_KEY ? '✓ Set' : '✗ Not set');
console.log('R2_BUCKET_NAME:', process.env.R2_BUCKET_NAME || 'flashfire-storage (default)');
console.log('R2_PUBLIC_URL:', process.env.R2_PUBLIC_URL || '✗ Not set (optional)');
console.log('');

console.log('CLOUDINARY_CLOUD_NAME:', process.env.CLOUDINARY_CLOUD_NAME ? '✓ Set' : '✗ Not set');
console.log('CLOUDINARY_API_KEY:', process.env.CLOUDINARY_API_KEY ? '✓ Set' : '✗ Not set');
console.log('CLOUDINARY_API_SECRET:', process.env.CLOUDINARY_API_SECRET ? '✓ Set' : '✗ Not set');
console.log('');

// Validate configuration
console.log('🔧 Configuration Status:');
const config = validateStorageConfig();
console.log('');

console.log('📦 R2 Storage:');
console.log('  Enabled:', config.r2.enabled ? '✓ YES' : '✗ NO');
console.log('  Configured:', config.r2.configured ? '✓ YES' : '✗ NO');
console.log('');

console.log('☁️  Cloudinary Storage:');
console.log('  Enabled:', config.cloudinary.enabled ? '✓ YES' : '✗ NO');
console.log('  Configured:', config.cloudinary.configured ? '✓ YES' : '✗ NO');
console.log('');

// Determine which storage will be used
const useR2 = process.env.USE_R2_FOR_NEW_UPLOADS === 'true';
const storageReady = useR2 ? config.r2.configured : config.cloudinary.configured;

console.log('📊 Summary:');
console.log('  Active Storage:', useR2 ? 'Cloudflare R2' : 'Cloudinary');
console.log('  Status:', storageReady ? '✅ READY' : '❌ NOT CONFIGURED');
console.log('');

if (!storageReady) {
  console.log('⚠️  Warning: Active storage is not properly configured!');
  if (useR2) {
    console.log('   Please set R2 environment variables in your .env file.');
  } else {
    console.log('   Please set Cloudinary environment variables in your .env file.');
  }
  process.exit(1);
}

console.log('✨ Storage configuration is valid and ready to use!');
console.log('');
console.log('💡 Tips:');
console.log('  - New uploads will go to:', useR2 ? 'Cloudflare R2' : 'Cloudinary');
console.log('  - To switch storage, change USE_R2_FOR_NEW_UPLOADS in .env');
console.log('  - Existing files from both storages will continue to work');
console.log('');

process.exit(0);

