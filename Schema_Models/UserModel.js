import mongoose from 'mongoose';

export const userSchema = new mongoose.Schema({
  userID: {
    type: String,
    required: true,
    default: () => new Date().getTime()
  },
  name: {
    type: String,
    required: true,
  },
  email: {
    type: String,
    required: true,
  },
  passwordHashed: {
    type: String,
    required: true,
    default: '--NO Password --/OAUTH'
  },

  // 🔽 Updated to handle both resumes
  resumeLink: {
    type: String,
    default: null,
  },
  optimizedResumeLink: {
    type: String,
    default: null,
  },

  planType: {
    type: String,
    required: true,
    default: 'Free Trial'
  },
  planLimit: {
    type: Number,
    default: null
  },
  userType: {
    type: String,
    default: 'User'
  },
  createdAt: {
    type: String,
    required: true,
    default: () => new Date().toLocaleString()
  }
});

export const UserModel = mongoose.model("users", userSchema);
