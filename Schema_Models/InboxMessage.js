import mongoose from "mongoose";

const InboxAttachmentSchema = new mongoose.Schema(
  {
    attachmentId: { type: String, required: true },
    filename: { type: String, default: "" },
    mimetype: { type: String, default: "application/octet-stream" },
    size: { type: Number, default: 0 },
    r2Key: { type: String, default: null }
  },
  { _id: false }
);

const InboxMessageSchema = new mongoose.Schema(
  {
    ownerEmail: { type: String, required: true, lowercase: true, index: true },
    gmailEmail: { type: String, required: true, lowercase: true, index: true },
    threadId: { type: String, required: true, index: true },
    messageId: { type: String, required: true, index: true },
    rfcMessageId: { type: String, default: "" },
    inReplyTo: { type: String, default: "" },
    referencesHeader: { type: String, default: "" },
    from: { type: String, default: "" },
    to: { type: [String], default: [] },
    cc: { type: [String], default: [] },
    bcc: { type: [String], default: [] },
    replyTo: { type: String, default: "" },
    subject: { type: String, default: "" },
    snippet: { type: String, default: "" },
    date: { type: Date, default: null, index: true },
    labels: { type: [String], default: [] },
    isUnread: { type: Boolean, default: false },
    bodyTextR2Key: { type: String, default: null },
    bodyHtmlR2Key: { type: String, default: null },
    bodyTextInline: { type: String, default: "" },
    attachments: { type: [InboxAttachmentSchema], default: [] }
  },
  { timestamps: true }
);

InboxMessageSchema.index({ ownerEmail: 1, gmailEmail: 1, messageId: 1 }, { unique: true });
InboxMessageSchema.index({ ownerEmail: 1, gmailEmail: 1, threadId: 1, date: 1 });

export const InboxMessage = mongoose.model("InboxMessage", InboxMessageSchema);
