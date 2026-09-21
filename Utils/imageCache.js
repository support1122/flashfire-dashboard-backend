import { getPresignedUrl } from './r2Storage.js';
import { isR2Url, extractR2Key } from './r2Storage.js';
import dotenv from 'dotenv';

dotenv.config();

// In-memory cache for presigned URLs
const urlCache = new Map();
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
const MAX_CACHE_SIZE = 1000; // Maximum number of cached URLs

/**
 * Get cached presigned URL or generate new one
 * @param {string} url - The R2 URL
 * @param {number} expiresIn - URL expiration time in seconds (default: 1 hour)
 * @returns {Promise<Object>} Cached or new presigned URL
 */
export async function getCachedPresignedUrl(url, expiresIn = 3600) {
  try {
    // Check if it's an R2 URL
    if (!isR2Url(url)) {
      return {
        success: true,
        url,
        cached: false,
        storage: 'non-r2',
      };
    }

    // Check cache first
    const cacheKey = `${url}_${expiresIn}`;
    const cached = urlCache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
      console.log('📦 Cache HIT for URL:', url);
      return {
        success: true,
        url: cached.url,
        cached: true,
        storage: 'r2',
        expiresIn: cached.expiresIn,
      };
    }

    // Generate new presigned URL
    console.log('🔄 Cache MISS - generating new presigned URL for:', url);
    const key = extractR2Key(url);
    if (!key) {
      throw new Error('Could not extract R2 key from URL');
    }

    const result = await getPresignedUrl(key, expiresIn);
    
    if (result.success) {
      // Cache the new URL
      cachePresignedUrl(cacheKey, result.url, expiresIn);
      
      return {
        success: true,
        url: result.url,
        cached: false,
        storage: 'r2',
        expiresIn: result.expiresIn,
      };
    }

    return result;
  } catch (error) {
    console.error('Error getting cached presigned URL:', error);
    return {
      success: false,
      error: error.message,
      cached: false,
    };
  }
}

/**
 * Cache a presigned URL
 * @param {string} key - Cache key
 * @param {string} url - Presigned URL
 * @param {number} expiresIn - Expiration time
 */
function cachePresignedUrl(key, url, expiresIn) {
  // Clean up old entries if cache is full
  if (urlCache.size >= MAX_CACHE_SIZE) {
    const oldestKey = urlCache.keys().next().value;
    urlCache.delete(oldestKey);
  }

  urlCache.set(key, {
    url,
    timestamp: Date.now(),
    expiresIn,
  });
}

/**
 * Clear expired cache entries
 */
export function clearExpiredCache() {
  const now = Date.now();
  for (const [key, value] of urlCache.entries()) {
    if (now - value.timestamp > CACHE_DURATION) {
      urlCache.delete(key);
    }
  }
  console.log(`🧹 Cleared expired cache entries. Remaining: ${urlCache.size}`);
}

/**
 * Get cache statistics
 * @returns {Object} Cache stats
 */
export function getCacheStats() {
  return {
    size: urlCache.size,
    maxSize: MAX_CACHE_SIZE,
    duration: CACHE_DURATION,
    entries: Array.from(urlCache.entries()).map(([key, value]) => ({
      key: key.substring(0, 50) + '...',
      age: Date.now() - value.timestamp,
      expiresIn: value.expiresIn,
    })),
  };
}

/**
 * Clear all cache
 */
export function clearAllCache() {
  urlCache.clear();
  console.log('🗑️ Cleared all cache entries');
}

// Clean up expired entries every hour
setInterval(clearExpiredCache, 60 * 60 * 1000);

export default {
  getCachedPresignedUrl,
  clearExpiredCache,
  getCacheStats,
  clearAllCache,
};
