import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import dotenv from 'dotenv';
import crypto from 'crypto';

dotenv.config();

// Configure Cloudflare R2 Client
const r2Client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const BUCKET_NAME = process.env.R2_BUCKET_NAME || 'flashfire-storage';
const PUBLIC_URL = process.env.R2_PUBLIC_URL || '';

/**
 * Upload file to Cloudflare R2
 * @param {Buffer} fileBuffer - The file buffer to upload
 * @param {Object} options - Upload options
 * @param {string} options.folder - Folder path within bucket
 * @param {string} options.filename - Original filename
 * @param {string} options.contentType - MIME type of the file
 * @returns {Promise<Object>} Upload result with URL and metadata
 */
export async function uploadToR2(fileBuffer, options = {}) {
  try {
    const {
      folder = 'flashfire-uploads',
      filename = 'file',
      contentType = 'application/octet-stream',
    } = options;

    // Generate unique filename
    const timestamp = Date.now();
    const randomString = crypto.randomBytes(8).toString('hex');
    const sanitizedFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const key = `${folder}/${timestamp}_${randomString}_${sanitizedFilename}`;

    // Upload to R2
    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      Body: fileBuffer,
      ContentType: contentType,
      Metadata: {
        originalName: filename,
        uploadedAt: new Date().toISOString(),
      },
    });

    await r2Client.send(command);

    // Construct public URL
    const url = PUBLIC_URL 
      ? `${PUBLIC_URL}/${key}`
      : `https://${BUCKET_NAME}.r2.cloudflarestorage.com/${key}`;

    return {
      success: true,
      url,
      key,
      bucket: BUCKET_NAME,
      size: fileBuffer.length,
      contentType,
      storage: 'r2',
    };
  } catch (error) {
    console.error('R2 upload error:', error);
    return {
      success: false,
      error: error.message,
      storage: 'r2',
    };
  }
}

/**
 * Delete file from Cloudflare R2
 * @param {string} key - The file key/path in R2
 * @returns {Promise<Object>} Delete result
 */
export async function deleteFromR2(key) {
  try {
    const command = new DeleteObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    });

    await r2Client.send(command);

    return {
      success: true,
      key,
      storage: 'r2',
    };
  } catch (error) {
    console.error('R2 delete error:', error);
    return {
      success: false,
      error: error.message,
      storage: 'r2',
    };
  }
}

/**
 * Generate a presigned URL for temporary access to R2 files
 * @param {string} key - The file key/path in R2
 * @param {number} expiresIn - URL expiration time in seconds (default: 1 hour)
 * @returns {Promise<Object>} Presigned URL result
 */
export async function getPresignedUrl(key, expiresIn = 3600) {
  try {
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    });

    const url = await getSignedUrl(r2Client, command, { expiresIn });

    return {
      success: true,
      url,
      expiresIn,
      storage: 'r2',
    };
  } catch (error) {
    console.error('R2 presigned URL error:', error);
    return {
      success: false,
      error: error.message,
      storage: 'r2',
    };
  }
}

/**
 * Extract R2 key from URL
 * @param {string} url - The R2 URL
 * @returns {string|null} The key or null if not an R2 URL
 */
export function extractR2Key(url) {
  if (!url) return null;
  
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    
    // Remove leading slash
    return pathname.startsWith('/') ? pathname.slice(1) : pathname;
  } catch (error) {
    return null;
  }
}

/**
 * Check if URL is from R2
 * @param {string} url - The URL to check
 * @returns {boolean} True if R2 URL
 */
export function isR2Url(url) {
  if (!url) return false;
  return url.includes('.r2.cloudflarestorage.com') || 
         (PUBLIC_URL && url.startsWith(PUBLIC_URL));
}

export default r2Client;

