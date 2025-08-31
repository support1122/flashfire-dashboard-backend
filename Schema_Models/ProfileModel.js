import mongoose from "mongoose";

// Schema for undergraduate transcript (similar to resume structure)
const undergraduateTranscriptSchema = new mongoose.Schema({
  url: { type: String, required: true }, // Cloudinary URL
  uploadedAt: { type: Date, default: Date.now },
  fileName: { type: String, default: "" }
}, { _id: false });

export const profileSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
  },
  contactEmail: {
    type: String,
    required: false,
  },
  firstName: {
    type: String,
    required: true,
  },
  lastName: {
    type: String,
    required: true,
  },
  contactNumber: {
    type: String,
    required: true,
  },
  dob: {
    type: String,
    required: true,
  },
  address: {
    type: String,
    required: true,
  },
  visaStatus: {
    type: String,
    enum: ["CPT", "F1", "F1 OPT", "F1 STEM OPT", "H1B", "Green Card", "U.S. Citizen", "Other"],
    required: true,
  },
  bachelorsUniDegree: {
    type: String,
    required: true,
  },
  bachelorsGradMonthYear: {
    type: String,
    required: true,
  },
  mastersUniDegree: {
    type: String,
    required: true,
  },
  mastersGradMonthYear: {
    type: String,
    required: true,
  },
  // New fields for GPA and transcript
  gpa: { 
    type: Number, 
    required: true,
    min: 0,
    max: 4,
    validate: {
      validator: function(v) {
        return v >= 0 && v <= 4;
      },
      message: 'GPA must be between 0 and 4'
    }
  },
  undergraduateTranscript: { type: undergraduateTranscriptSchema, default: null }, // PDF file storage
  preferredRoles: {
    type: [String],
    required: true,
  },
  experienceLevel: {
    type: String,
    enum: ["Entry level", "0-2 Years", "0-3 Years", "0-4 Years", "0-5 Years", "0-6 Years", "0-7 Years", "Other"],
    required: true,
  },
  expectedSalaryRange: {
    type: String,
    enum: ["60k-100k", "100k-150k", "150k-200k", "Other"],
    required: true,
  },
  preferredLocations: {
    type: [String],
    required: true,
  },
  targetCompanies: {
    type: [String],
    required: true,
  },
  reasonForLeaving: {
    type: String,
    required: true,
  },
  joinTime: {
    type: String,
    enum: ["in 1 week", "in 2 week", "in 3 week", "in 4 week", "in 6-7 week"],
    required: true,
    default: "in 1 week"
  },
  linkedinUrl: {
    type: String,
    required: false,
  },
  githubUrl: {
    type: String,
    required: false,
  },
  portfolioUrl: {
    type: String,
    required: false,
  },
  resumeUrl: {
    type: String,
    required: false,
  },
  coverLetterUrl: {
    type: String,
    required: false,
  },
  portfolioFileUrl: {
    type: String,
    required: false,
  },
  confirmAccuracy: {
    type: Boolean,
    required: true,
  },
  agreeTos: {
    type: Boolean,
    required: true,
  },
  ssn: {
    type: String,
    validate: {
      validator: function(v) {
        return v === "" || /^\d{9}$/.test(v);
      },
      message: "SSN must be the last 3 digits or left blank."
    },
    required: false,
  },
}, {
  timestamps: true
});

export const ProfileModel = mongoose.model("Profile", profileSchema);
