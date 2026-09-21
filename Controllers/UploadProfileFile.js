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
  fileFilter: (req, file, cb) => {
    // Allow only specific file types
    if (file.mimetype === 'application/pdf' || 
        file.mimetype === 'application/msword' || 
        file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        file.mimetype === 'text/plain') {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PDF, DOC, DOCX, and TXT files are allowed.'), false);
    }
  },
});

export const uploadProfileFile = async (req, res) => {
  try {
    // Check if file exists
    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    // Determine file type based on file extension or MIME type
    const fileName = req.file.originalname.toLowerCase();
    let fileType = 'attachments'; // default for attachments
    
    // Check if it's a PDF, DOC, DOCX, TXT (these should go to resume folder)
    if (fileName.endsWith('.pdf') || 
        fileName.endsWith('.doc') || 
        fileName.endsWith('.docx') || 
        fileName.endsWith('.txt') ||
        req.file.mimetype === 'application/pdf' ||
        req.file.mimetype === 'application/msword' ||
        req.file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        req.file.mimetype === 'text/plain') {
      fileType = 'resume'; // PDFs and documents go to resume folder
    }

    // Use email as client identifier (unique and always available)
    const clientEmail = email.replace(/[^a-zA-Z0-9._-]/g, '_');

    // Upload file using unified storage service with email-based folder structure
    const fileBuffer = req.file.buffer;
    
    const uploadResult = await uploadFile(fileBuffer, {
      folder: 'flashfirejobs', // Base folder
      filename: req.file.originalname,
      contentType: req.file.mimetype,
      clientName: clientEmail, // Use email as client identifier
      fileType: fileType, // 'resume' for PDFs/docs, 'attachments' for images
    });

    if (!uploadResult.success) {
      return res.status(500).json({
        success: false,
        message: "Failed to upload file",
        error: uploadResult.error,
      });
    }

    console.log('Upload Profile File Response:', {
      url: uploadResult.url,
      key: uploadResult.key,
      storage: uploadResult.storage,
      email,
      filename: req.file.originalname,
    });

    res.json({
      success: true,
      secure_url: uploadResult.url,
      url: uploadResult.url, // Also include url for consistency
      public_id: uploadResult.key || uploadResult.public_id,
      key: uploadResult.key,
      storage: uploadResult.storage,
      message: "File uploaded successfully",
    });

  } catch (error) {
    console.error("File upload error:", error);
    res.status(500).json({ 
      message: error.message || "Failed to upload file" 
    });
  }
};

// Export the multer middleware for use in routes
export { upload };
