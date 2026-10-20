import mongoose from "mongoose";

// The merged label -> profile-field aliases every SpeedyApply extension pulls
// once a day. One document (key "global"), rebuilt by
// src/services/speedyApplyLearningWorker.js from all clients' learned maps.
// Holds label text and field names only, never a client's values or email.
const SpeedyApplySharedLearningSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, default: "global" },
    // { "what should we call you": { profileField, clients, agreement } }
    mappings: { type: mongoose.Schema.Types.Mixed, default: {} },
    // Changes only when the mappings change, so extensions can skip a download.
    version: { type: String, default: "" },
    stats: { type: mongoose.Schema.Types.Mixed, default: {} },
    builtAt: { type: Date, default: Date.now },
  },
  { collection: "speedyapplysharedlearning", minimize: false }
);

export const SpeedyApplySharedLearning = mongoose.model("SpeedyApplySharedLearning", SpeedyApplySharedLearningSchema);
