import mongoose from "mongoose";

const WhatsAppGroupMappingSchema = new mongoose.Schema({
  userEmail: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    index: true
  },
  groupId: {
    type: String,
    required: true,
    trim: true
  },
  groupName: {
    type: String,
    required: false,
    trim: true
  },
  linkedAt: {
    type: String,
    default: () => new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
  },
  linkedBy: {
    type: String,
    required: false,
    default: ""
  }
}, {
  timestamps: false
});

WhatsAppGroupMappingSchema.index({ userEmail: 1 });

export const WhatsAppGroupMappingModel = mongoose.models.WhatsAppGroupMapping || mongoose.model('WhatsAppGroupMapping', WhatsAppGroupMappingSchema);
