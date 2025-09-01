import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, '../uploads');
const resumesDir = path.join(uploadsDir, 'resumes');
const coverLettersDir = path.join(uploadsDir, 'cover-letters');

// Ensure directories exist
[uploadsDir, resumesDir, coverLettersDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Helper function to generate unique filename
const generateUniqueFilename = (originalName, fileType) => {
  const timestamp = Date.now();
  const randomString = Math.random().toString(36).substring(2, 15);
  const extension = path.extname(originalName) || '.pdf';
  return `${fileType}_${timestamp}_${randomString}${extension}`;
};

// Helper function to save file locally
export async function saveFileLocally(fileBuffer, originalName, fileType) {
  try {
    const filename = generateUniqueFilename(originalName, fileType);
    const uploadDir = fileType === 'resume' ? resumesDir : coverLettersDir;
    const filePath = path.join(uploadDir, filename);
    
    // Write file to disk
    fs.writeFileSync(filePath, fileBuffer);
    
    // Return the relative path for database storage
    const relativePath = path.join('uploads', fileType === 'resume' ? 'resumes' : 'cover-letters', filename);
    
    return {
      success: true,
      filename: filename,
      filePath: relativePath,
      fullPath: filePath,
      size: fileBuffer.length
    };
  } catch (error) {
    console.error('Local file save error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// Helper function to delete file locally
export async function deleteFileLocally(filePath) {
  try {
    const fullPath = path.join(__dirname, '..', filePath);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
      return { success: true };
    }
    return { success: true, message: 'File not found' };
  } catch (error) {
    console.error('Local file delete error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// Helper function to get file URL for serving
export function getFileUrl(filePath) {
  if (!filePath) return null;
  return `/uploads/${filePath.split('uploads/')[1]}`;
}

// Helper function to check if file exists
export function fileExists(filePath) {
  const fullPath = path.join(__dirname, '..', filePath);
  return fs.existsSync(fullPath);
}
