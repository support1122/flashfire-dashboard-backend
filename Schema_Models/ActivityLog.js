import mongoose from "mongoose";

const ActorSchema = new mongoose.Schema(
  {
    email: { type: String, default: "" },
    name: { type: String, default: "" },
    role: { type: String, default: "" },
    source: { type: String, default: "" }, // "optimizer" | "dashboard" | "extension" | "system"
  },
  { _id: false }
);

const ActivityLogSchema = new mongoose.Schema(
  {
    actor: { type: ActorSchema, default: () => ({}) },
    action: { type: String, required: true, index: true },
    category: { type: String, default: "system", index: true },
    targetType: { type: String, default: "", index: true },
    targetId: { type: String, default: "" },
    targetLabel: { type: String, default: "" },
    summary: { type: String, default: "" },
    diff: { type: mongoose.Schema.Types.Mixed, default: null },
    context: { type: mongoose.Schema.Types.Mixed, default: null },
    ip: { type: String, default: "" },
    userAgent: { type: String, default: "" },
    severity: { type: String, default: "info", enum: ["info", "warning", "critical"] },
    createdAt: { type: Date, default: Date.now, index: true },
  },
  { collection: "activity_logs", versionKey: false }
);

ActivityLogSchema.index({ createdAt: -1, _id: -1 });
ActivityLogSchema.index({ "actor.email": 1, createdAt: -1 });
ActivityLogSchema.index({ category: 1, createdAt: -1 });
ActivityLogSchema.index({ targetType: 1, targetId: 1, createdAt: -1 });

export const ActivityLog =
  mongoose.models.ActivityLog || mongoose.model("ActivityLog", ActivityLogSchema);
