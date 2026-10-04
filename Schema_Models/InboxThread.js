import mongoose from "mongoose";

const InboxThreadSchema = new mongoose.Schema(
  {
    ownerEmail: { type: String, required: true, lowercase: true, index: true },
    gmailEmail: { type: String, required: true, lowercase: true, index: true },
    threadId: { type: String, required: true, index: true },
    historyId: { type: String, default: null },
    subject: { type: String, default: "" },
    snippet: { type: String, default: "" },
    participants: { type: [String], default: [] },
    fromLatest: { type: String, default: "" },
    lastMessageAt: { type: Date, default: null, index: true },
    messageCount: { type: Number, default: 0 },
    unreadCount: { type: Number, default: 0 },
    labels: { type: [String], default: [] },
    hasAttachments: { type: Boolean, default: false },
    // Flashfire-only state (read/star/archive/trash). Never written to Gmail:
    // the app holds no gmail.modify scope. Applied on top of Gmail's labels at sync.
    localAdd: { type: [String], default: [] },
    localRemove: { type: [String], default: [] },
    localReadMessageCount: { type: Number, default: 0 },
    lastSyncedAt: { type: Date, default: () => new Date() }
  },
  { timestamps: true }
);

InboxThreadSchema.index({ ownerEmail: 1, gmailEmail: 1, threadId: 1 }, { unique: true });
InboxThreadSchema.index({ ownerEmail: 1, gmailEmail: 1, lastMessageAt: -1 });

export const InboxThread = mongoose.model("InboxThread", InboxThreadSchema);
