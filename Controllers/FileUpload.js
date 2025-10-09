import { uploadToCloudinary } from "../Utils/cloudinary.js";
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
    
    // Upload to Cloudinary
    const folder = fileType === 'resume' ? 'flashfire-resumes' : 'flashfire-cover-letters';
    const uploadResult = await uploadToCloudinary(fileBuffer, folder);
    
    if (!uploadResult.success) {
      return res.status(500).json({ 
        message: "Failed to upload file to Cloudinary",
        error: uploadResult.error 
      });
    }

    // Update profile with the new file URL
    const updateField = fileType === 'resume' ? 'resumeUrl' : 'coverLetterUrl';
    const fileUrl = uploadResult.url;
    const updated = await ProfileModel.findOneAndUpdate(
      { email },
      { $set: { [updateField]: fileUrl } },
      { new: true }
    );

    if (!updated) {
      return res.status(404).json({ 
        message: "Profile not found" 
      });
    }

    return res.json({
      message: `${fileType} uploaded successfully`,
      url: fileUrl,
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
