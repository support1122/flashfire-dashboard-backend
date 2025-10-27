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

    // Get client information from profile
    const profile = await ProfileModel.findOne({ email });
    if (!profile) {
      return res.status(404).json({ 
        message: "Profile not found" 
      });
    }

    // Create client name from firstName and lastName
    const clientName = `${profile.firstName}_${profile.lastName}`.replace(/[^a-zA-Z0-9._-]/g, '_');

    // Upload file using unified storage service with client-based folder structure
    const fileBuffer = req.file.buffer;
    
    const uploadResult = await uploadFile(fileBuffer, {
      folder: '', // Empty folder since base URL already includes /test
      filename: req.file.originalname,
      contentType: req.file.mimetype,
      clientName: clientName,
      fileType: 'attachments', // Use 'attachments' for profile files
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
      secure_url: uploadResult.url,
      public_id: uploadResult.key || uploadResult.public_id,
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
