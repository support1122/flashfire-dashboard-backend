import { uploadToCloudinary, deleteFromCloudinary } from './cloudinary.js';
import { uploadToR2, deleteFromR2, isR2Url, extractR2Key } from './r2Storage.js';
import dotenv from 'dotenv';

dotenv.config();

// Determine which storage to use for new uploads
const USE_R2_FOR_NEW_UPLOADS = process.env.USE_R2_FOR_NEW_UPLOADS === 'true';

/**
 * Unified upload function that routes to appropriate storage
 * @param {Buffer} fileBuffer - The file buffer to upload
 * @param {Object} options - Upload options
 * @returns {Promise<Object>} Upload result with URL and metadata
 */
export async function uploadFile(fileBuffer, options = {}) {
  const {
    folder = 'flashfire-uploads',
    filename = 'file',
    contentType = 'application/octet-stream',
  } = options;

  // Use R2 for new uploads if enabled
  if (USE_R2_FOR_NEW_UPLOADS) {
    console.log('Uploading to Cloudflare R2...');
    return await uploadToR2(fileBuffer, { folder, filename, contentType });
  } else {
    // Fallback to Cloudinary
    console.log('Uploading to Cloudinary...');
    return await uploadToCloudinary(fileBuffer, folder);
  }
}

/**
 * Delete file from appropriate storage based on URL
 * @param {string} urlOrKey - File URL or storage key
 * @returns {Promise<Object>} Delete result
 */
export async function deleteFile(urlOrKey) {
  if (!urlOrKey) {
    return {
      success: false,
      error: 'No URL or key provided',
    };
  }

  // Check if it's an R2 URL
  if (isR2Url(urlOrKey)) {
    console.log('Deleting from R2...');
    const key = extractR2Key(urlOrKey);
    return await deleteFromR2(key);
  } else {
    // Assume it's a Cloudinary URL - extract public_id
    console.log('Deleting from Cloudinary...');
    // Extract public_id from Cloudinary URL
    const publicId = extractCloudinaryPublicId(urlOrKey);
    if (publicId) {
      return await deleteFromCloudinary(publicId);
    } else {
      return {
        success: false,
        error: 'Could not extract public ID from URL',
      };
    }
  }
}

/**
 * Extract Cloudinary public_id from URL
 * @param {string} url - Cloudinary URL
 * @returns {string|null} Public ID or null
 */
function extractCloudinaryPublicId(url) {
  try {
    // Cloudinary URL format: https://res.cloudinary.com/{cloud_name}/{resource_type}/upload/v{version}/{public_id}.{format}
    const urlParts = url.split('/');
    const uploadIndex = urlParts.indexOf('upload');
    
    if (uploadIndex !== -1 && uploadIndex < urlParts.length - 1) {
      // Get parts after 'upload'
      const afterUpload = urlParts.slice(uploadIndex + 1);
      
      // Skip version if present (starts with 'v')
      const startIndex = afterUpload[0].startsWith('v') ? 1 : 0;
      const publicIdParts = afterUpload.slice(startIndex);
      
      // Join and remove extension
      const fullPath = publicIdParts.join('/');
      const publicId = fullPath.replace(/\.[^/.]+$/, '');
      
      return publicId;
    }
    
    return null;
  } catch (error) {
    console.error('Error extracting Cloudinary public_id:', error);
    return null;
  }
}

/**
 * Get file info including storage type
 * @param {string} url - File URL
 * @returns {Object} File info including storage type
 */
export function getFileInfo(url) {
  if (!url) {
    return {
      url: null,
      storage: null,
      valid: false,
    };
  }

  if (isR2Url(url)) {
    return {
      url,
      storage: 'r2',
      key: extractR2Key(url),
      valid: true,
    };
  } else if (url.includes('cloudinary.com')) {
    return {
      url,
      storage: 'cloudinary',
      publicId: extractCloudinaryPublicId(url),
      valid: true,
    };
  } else {
    return {
      url,
      storage: 'unknown',
      valid: false,
    };
  }
}

/**
 * Validate storage configuration
 * @returns {Object} Configuration status
 */
export function validateStorageConfig() {
  const config = {
    r2: {
      enabled: USE_R2_FOR_NEW_UPLOADS,
      configured: !!(
        process.env.R2_ENDPOINT &&
        process.env.R2_ACCESS_KEY_ID &&
        process.env.R2_SECRET_ACCESS_KEY
      ),
    },
    cloudinary: {
      enabled: !USE_R2_FOR_NEW_UPLOADS,
      configured: !!(
        process.env.CLOUDINARY_CLOUD_NAME &&
        process.env.CLOUDINARY_API_KEY &&
        process.env.CLOUDINARY_API_SECRET
      ),
    },
  };

  return config;
}

export default {
  uploadFile,
  deleteFile,
  getFileInfo,
  validateStorageConfig,
};

