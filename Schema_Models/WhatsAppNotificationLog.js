import mongoose from "mongoose";

const WhatsAppNotificationLogSchema = new mongoose.Schema({
  userEmail: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    index: true
  },
  lastNotificationSent: {
    type: Date,
    required: true,
    default: Date.now
  },
  sentBy: {
    type: String,
    required: false,
    default: ""
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: false
});

WhatsAppNotificationLogSchema.index({ userEmail: 1 });
WhatsAppNotificationLogSchema.index({ lastNotificationSent: 1 });

export const WhatsAppNotificationLogModel = mongoose.models.WhatsAppNotificationLog || mongoose.model('WhatsAppNotificationLog', WhatsAppNotificationLogSchema);
