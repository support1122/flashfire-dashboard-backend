import { uploadFile } from "../Utils/storageService.js";
import { ProfileModel } from "../Schema_Models/ProfileModel.js";

export default async function FileUpload(req, res) {
  try {
    const { email, fileType, fileData } = req.body;
    
    if (!email || !fileType || !fileData) {
      return res.status(400).json({ 
        message: "Email, file type, and file data are required" 
      });
    }

    // Validate file type
    const allowedTypes = ['resume', 'coverLetter'];
    if (!allowedTypes.includes(fileType)) {
      return res.status(400).json({ 
        message: "Invalid file type. Allowed types: resume, coverLetter" 
      });
    }

    // Convert base64 to buffer
    const fileBuffer = Buffer.from(fileData.split(',')[1], 'base64');
    
    // Determine file extension and content type from base64 data
    const mimeMatch = fileData.match(/^data:([^;]+);base64,/);
    const contentType = mimeMatch ? mimeMatch[1] : 'application/pdf';
    const extension = contentType.includes('pdf') ? 'pdf' : 'doc';
    
    // Upload using unified storage service (automatically uses R2 or Cloudinary)
    const originalName = `${fileType}.${extension}`;
    const uploadResult = await uploadFile(fileBuffer, {
      folder: `flashfire-${fileType}s`,
      filename: originalName,
      contentType: contentType,
    });
    
    if (!uploadResult.success) {
      return res.status(500).json({ 
        message: "Failed to upload file",
        error: uploadResult.error 
      });
    }

    // Update profile with the new file URL
    const updateField = fileType === 'resume' ? 'resumeUrl' : 'coverLetterUrl';
    const updated = await ProfileModel.findOneAndUpdate(
      { email },
      { $set: { [updateField]: uploadResult.url } },
      { new: true }
    );

    if (!updated) {
      return res.status(404).json({ 
        message: "Profile not found" 
      });
    }

    return res.json({
      message: `${fileType} uploaded successfully`,
      url: uploadResult.url,
      storage: uploadResult.storage,
      profile: updated
    });

  } catch (error) {
    console.error("File upload error:", error);
    return res.status(500).json({ 
      message: "Failed to upload file",
      error: error.message 
    });
  }
}
