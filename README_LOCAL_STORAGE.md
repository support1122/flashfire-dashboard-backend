# Local File Storage Implementation

## Overview
This implementation stores PDF files (resumes and cover letters) locally on the server instead of using Cloudinary.

## File Structure
```
flashfire-dashboard-backend/
├── uploads/
│   ├── resumes/          # Resume PDF files
│   └── cover-letters/    # Cover letter PDF files
├── Utils/
│   └── localFileStorage.js  # File storage utilities
└── Controllers/
    └── FileUpload.js     # File upload controller
```

## How It Works

### 1. File Upload Process
- User selects a PDF file in the frontend
- File is converted to base64 and sent to `/upload-file` endpoint
- Backend saves the file locally with a unique filename
- File URL is stored in the user's profile in MongoDB

### 2. File Storage
- Files are stored in `uploads/resumes/` and `uploads/cover-letters/`
- Unique filenames are generated using timestamp and random string
- Files are served statically via Express at `/uploads/` route

### 3. File Access
- Files are accessible via URLs like: `http://localhost:8086/uploads/resumes/filename.pdf`
- Frontend displays these URLs as clickable links

## API Endpoints

### POST `/upload-file`
Uploads a file and updates the user's profile.

**Request Body:**
```json
{
  "email": "user@example.com",
  "fileType": "resume" | "coverLetter",
  "fileData": "base64-encoded-file-data"
}
```

**Response:**
```json
{
  "message": "resume uploaded successfully",
  "url": "/uploads/resumes/resume_1234567890_abc123.pdf",
  "profile": { /* updated profile object */ }
}
```

## Security Considerations
- Files are stored with unique names to prevent conflicts
- Only authenticated users can upload files
- File size limit: 10MB
- Supported formats: PDF, DOC, DOCX, TXT

## Migration from Cloudinary
If you want to switch back to Cloudinary later:
1. Update the FileUpload controller to use Cloudinary
2. Update frontend upload functions
3. Add Cloudinary environment variables
4. Remove local file storage utilities

## File Cleanup
To clean up old files, you can:
1. Delete files from the uploads directory
2. Update the database to remove file references
3. Implement a scheduled cleanup script if needed
