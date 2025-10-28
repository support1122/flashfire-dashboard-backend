import multer from "multer";
import { uploadFile } from "../Utils/storageService.js";
import { ProfileModel } from "../Schema_Models/ProfileModel.js";
import dotenv from "dotenv";

dotenv.config();

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
});

/**
 * Generic file upload endpoint
 * Supports multiple file types: images, PDFs, documents
 */
export const uploadSingleFile = async (req, res) => {
  try {
    // Check if file exists
    if (!req.file) {
      return res.status(400).json({ 
        success: false,
        message: "No file uploaded" 
      });
    }

    const { folder = 'flashfirejobs', email, fileType = 'attachments' } = req.body;

    // Determine file type based on file extension or MIME type if not provided
    const fileName = req.file.originalname.toLowerCase();
    let determinedFileType = fileType;
    
    // Check if it's a PDF, DOC, DOCX, TXT (these should go to resume folder)
    if (fileName.endsWith('.pdf') || 
        fileName.endsWith('.doc') || 
        fileName.endsWith('.docx') || 
        fileName.endsWith('.txt') ||
        req.file.mimetype === 'application/pdf' ||
        req.file.mimetype === 'application/msword' ||
        req.file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        req.file.mimetype === 'text/plain') {
      determinedFileType = 'resume'; // PDFs and documents go to resume folder
    }

    // Use email as client identifier (unique and always available)
    // Sanitize email for use as folder name
    let clientName = null;
    if (email) {
      // Use email directly as folder identifier
      clientName = email.replace(/[^a-zA-Z0-9._-]/g, '_');
    }

    // Upload file using unified storage service with email-based folder structure
    const fileBuffer = req.file.buffer;
    
    const uploadResult = await uploadFile(fileBuffer, {
      folder,
      filename: req.file.originalname,
      contentType: req.file.mimetype,
      clientName,
      fileType: determinedFileType,
    });

    if (!uploadResult.success) {
      return res.status(500).json({
        success: false,
        message: "Failed to upload file",
        error: uploadResult.error,
      });
    }

    res.json({
      success: true,
      url: uploadResult.url,
      secure_url: uploadResult.url,
      key: uploadResult.key,
      storage: uploadResult.storage,
      contentType: uploadResult.contentType,
      size: uploadResult.size,
      message: "File uploaded successfully",
    });

  } catch (error) {
    console.error("File upload error:", error);
    res.status(500).json({ 
      success: false,
      message: error.message || "Failed to upload file" 
    });
  }
};

/**
 * Base64 file upload endpoint
 * Accepts base64 encoded files
 */
export const uploadBase64File = async (req, res) => {
  try {
    const { fileData, filename, folder = '', email, fileType = 'attachments' } = req.body;

    if (!fileData || !filename) {
      return res.status(400).json({
        success: false,
        message: "File data and filename are required",
      });
    }

    // Get client information if email is provided
    let clientName = null;
    if (email) {
      const profile = await ProfileModel.findOne({ email });
      if (profile) {
        clientName = `${profile.firstName}_${profile.lastName}`.replace(/[^a-zA-Z0-9._-]/g, '_');
      }
    }

    // Extract content type from base64 string
    const mimeMatch = fileData.match(/^data:([^;]+);base64,/);
    if (!mimeMatch) {
      return res.status(400).json({
        success: false,
        message: "Invalid base64 file format",
      });
    }

    const contentType = mimeMatch[1];
    const base64Data = fileData.split(',')[1];
    const fileBuffer = Buffer.from(base64Data, 'base64');

    // Upload file using unified storage service
    const uploadResult = await uploadFile(fileBuffer, {
      folder,
      filename,
      contentType,
      clientName,
      fileType,
    });

    if (!uploadResult.success) {
      return res.status(500).json({
        success: false,
        message: "Failed to upload file",
        error: uploadResult.error,
      });
    }

    res.json({
      success: true,
      url: uploadResult.url,
      secure_url: uploadResult.url,
      key: uploadResult.key,
      storage: uploadResult.storage,
      contentType: uploadResult.contentType,
      size: uploadResult.size,
      message: "File uploaded successfully",
    });

  } catch (error) {
    console.error("Base64 upload error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to upload file",
    });
  }
};

// Export the multer middleware for use in routes
export { upload };

