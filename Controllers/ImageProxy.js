import { getCachedPresignedUrl } from '../Utils/imageCache.js';
import { isR2Url } from '../Utils/r2Storage.js';

/**
 * Proxy endpoint for serving cached images
 * Reduces R2 operations by caching presigned URLs
 */
export const serveCachedImage = async (req, res) => {
  try {
    const { url } = req.query;
    
    if (!url) {
      return res.status(400).json({
        success: false,
        message: 'URL parameter is required',
      });
    }

    // Validate URL
    if (!isR2Url(url)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid R2 URL',
      });
    }

    // Get cached presigned URL
    const result = await getCachedPresignedUrl(url);
    
    if (!result.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to get presigned URL',
        error: result.error,
      });
    }

    // Redirect to the presigned URL
    res.redirect(302, result.url);
    
  } catch (error) {
    console.error('Image proxy error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message,
    });
  }
};

/**
 * Get cache statistics
 */
export const getCacheStats = async (req, res) => {
  try {
    const { getCacheStats } = await import('../Utils/imageCache.js');
    const stats = getCacheStats();
    
    res.json({
      success: true,
      stats,
    });
  } catch (error) {
    console.error('Cache stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get cache stats',
      error: error.message,
    });
  }
};

/**
 * Clear cache
 */
export const clearCache = async (req, res) => {
  try {
    const { clearAllCache } = await import('../Utils/imageCache.js');
    clearAllCache();
    
    res.json({
      success: true,
      message: 'Cache cleared successfully',
    });
  } catch (error) {
    console.error('Clear cache error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to clear cache',
      error: error.message,
    });
  }
};
