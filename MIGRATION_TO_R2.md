# Cloudflare R2 Migration Guide

## Overview

This document describes the migration from Cloudinary to Cloudflare R2 for file storage while maintaining backward compatibility with existing Cloudinary uploads.

## What Changed

### Backend Changes

1. **New Dependencies**
   - Added `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` for R2 integration

2. **New Utilities**
   - `Utils/r2Storage.js` - Cloudflare R2 operations (upload, delete, presigned URLs)
   - `Utils/storageService.js` - Unified storage service that routes to R2 or Cloudinary

3. **Updated Controllers**
   - `Controllers/UploadProfileFile.js` - Now uses unified storage service
   - `Controllers/FileUpload.js` - Now uses unified storage service
   - `Controllers/UploadFile.js` - New generic file upload endpoint

4. **New API Endpoints**
   - `POST /upload-file` - Generic file upload (multipart/form-data)
   - `POST /upload-base64` - Base64 file upload

### Frontend Changes

1. **New Utilities**
   - `src/utils/uploadService.ts` - Unified upload service for frontend
   - Updated `src/utils/cloudinary.ts` - Now uses the new upload service

2. **Updated Components**
   - `JobModal.tsx` - Uses backend API for uploads
   - `JobForm.tsx` - Uses backend API for uploads
   - `ResumeOptimizer.tsx` - Uses backend API for uploads
   - `ResumeOptimizer1.tsx` - Uses backend API for uploads

## Configuration

### Environment Variables

Add these to your `.env` file:

```env
# Enable R2 for new uploads (set to 'true' to use R2, 'false' for Cloudinary)
USE_R2_FOR_NEW_UPLOADS=true

# Cloudflare R2 Configuration
R2_ENDPOINT=https://ea7feaa0807f23a74111f715fbf1c169.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=87ccb6169189c8547df2d4533098d501
R2_SECRET_ACCESS_KEY=5803b4a0bd17d07a19164aefc1a7b7636244380fcf4d48fb2e159e1008c2aa34
R2_BUCKET_NAME=flashfire-storage
R2_PUBLIC_URL=https://your-custom-domain.com

# Keep Cloudinary config for backward compatibility (existing files)
CLOUDINARY_CLOUD_NAME=your-cloudinary-cloud-name
CLOUDINARY_API_KEY=your-cloudinary-api-key
CLOUDINARY_API_SECRET=your-cloudinary-api-secret
```

### R2 Bucket Setup

1. **Create a Bucket** in Cloudflare R2 (if not already created)
   - Bucket name: `flashfire-storage` (or as configured in `R2_BUCKET_NAME`)

2. **Configure CORS** (if accessing files from browser)
   ```json
   [
     {
       "AllowedOrigins": ["*"],
       "AllowedMethods": ["GET", "HEAD"],
       "AllowedHeaders": ["*"],
       "ExposeHeaders": ["ETag"],
       "MaxAgeSeconds": 3000
     }
   ]
   ```

3. **Optional: Set up Custom Domain**
   - Configure a custom domain in R2 for cleaner URLs
   - Update `R2_PUBLIC_URL` with your custom domain

## How It Works

### Upload Flow

1. **Frontend** calls upload API endpoints with file
2. **Backend** checks `USE_R2_FOR_NEW_UPLOADS` environment variable
3. **If TRUE**: Upload to Cloudflare R2
4. **If FALSE**: Upload to Cloudinary (legacy)
5. Returns URL to frontend

### Backward Compatibility

- **Existing URLs** from Cloudinary continue to work
- **New uploads** go to R2 (when `USE_R2_FOR_NEW_UPLOADS=true`)
- The system automatically detects storage type from URL format
- Delete operations work for both R2 and Cloudinary files

### URL Detection

The system identifies storage type from URL patterns:
- **R2**: Contains `.r2.cloudflarestorage.com` or matches `R2_PUBLIC_URL`
- **Cloudinary**: Contains `cloudinary.com`

## Testing

### 1. Test Backend API

```bash
# Test file upload endpoint
curl -X POST http://localhost:8001/upload-file \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "file=@test.pdf" \
  -F "folder=test-uploads"

# Test base64 upload endpoint
curl -X POST http://localhost:8001/upload-base64 \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "fileData": "data:application/pdf;base64,JVBERi0xLjQK...",
    "filename": "test.pdf",
    "folder": "test-uploads"
  }'
```

### 2. Test Frontend Integration

1. Upload a resume through the Resume Optimizer
2. Upload an image attachment in a job modal
3. Verify URLs are from R2 (should contain your R2 endpoint)
4. Verify existing Cloudinary files still load correctly

### 3. Verify Storage Toggle

```bash
# Test with R2
USE_R2_FOR_NEW_UPLOADS=true npm start

# Test with Cloudinary (fallback)
USE_R2_FOR_NEW_UPLOADS=false npm start
```

## Rollback Plan

If you need to rollback to Cloudinary:

1. Set `USE_R2_FOR_NEW_UPLOADS=false` in `.env`
2. Restart the backend service
3. All new uploads will go to Cloudinary
4. R2 files remain accessible (read-only)

## Cost Comparison

### Cloudinary (Previous)
- **Storage**: $0.125/GB/month
- **Bandwidth**: $0.11/GB
- **Transformations**: Billed separately

### Cloudflare R2 (New)
- **Storage**: $0.015/GB/month (8x cheaper)
- **Bandwidth**: $0 (FREE egress)
- **Operations**: $0.36 per million writes, $4.50 per million reads

### Example Savings
For 100GB storage + 1TB bandwidth/month:
- **Cloudinary**: ~$122.50/month
- **R2**: ~$1.50/month + operations
- **Savings**: ~$121/month (99% reduction)

## Security Best Practices

1. **Never commit** credentials to git
2. **Rotate keys** regularly in Cloudflare dashboard
3. **Use environment variables** for all sensitive data
4. **Implement rate limiting** on upload endpoints
5. **Validate file types** and sizes before upload
6. **Use presigned URLs** for temporary access when needed

## Monitoring

### Key Metrics to Monitor

1. **Upload Success Rate**
   ```javascript
   // Check backend logs for upload errors
   grep "Upload error" logs/app.log
   ```

2. **Storage Usage**
   - Monitor R2 dashboard for storage consumption
   - Track number of objects stored

3. **API Response Times**
   - Upload endpoint latency
   - File retrieval performance

## Troubleshooting

### Issue: Upload fails with "Authentication required"

**Solution**: Ensure token is present in localStorage and valid

```javascript
const token = localStorage.getItem('token');
console.log('Token:', token);
```

### Issue: Upload fails with "Missing Cloudinary envs"

**Solution**: Set `USE_R2_FOR_NEW_UPLOADS=true` or configure Cloudinary variables

### Issue: Files upload but URLs don't work

**Solution**: Check CORS configuration in R2 bucket settings

### Issue: Large files fail to upload

**Solution**: Increase request size limits in nginx/server config

```nginx
client_max_body_size 20M;
```

## Next Steps

1. ✅ Deploy updated backend
2. ✅ Deploy updated frontend
3. ✅ Update environment variables
4. ✅ Test upload functionality
5. ⏳ Monitor for issues
6. ⏳ Migrate existing Cloudinary files (optional)

## Support

For issues or questions:
- Check backend logs: `/logs/app.log`
- Review R2 dashboard: https://dash.cloudflare.com/
- Contact DevOps team

---

**Last Updated**: October 2025
**Version**: 1.0.0

