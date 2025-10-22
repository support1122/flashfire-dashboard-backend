import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import dotenv from "dotenv";

dotenv.config();

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

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

    // Convert buffer to base64
    const fileBuffer = req.file.buffer;
    const base64File = fileBuffer.toString('base64');
    const dataURI = `data:${req.file.mimetype};base64,${base64File}`;

    // Upload to Cloudinary
    const uploadResult = await cloudinary.uploader.upload(dataURI, {
      folder: 'flashfire-profiles',
      resource_type: 'raw',
      public_id: `${email}_${Date.now()}_${req.file.originalname}`,
      overwrite: true,
    });

    res.json({
      success: true,
      secure_url: uploadResult.secure_url,
      public_id: uploadResult.public_id,
      message: "File uploaded successfully"
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
