import mongoose from "mongoose";

// Prompts the SpeedyApply extension's AI features run with, keyed by feature
// ("ask" = the sidebar's Ask AI box). Stored here instead of in the extension
// so ops can tune the wording without shipping a new build; the extension
// fetches the active version when the sidebar loads, and the server always
// answers with its own copy (a client can never send its own system prompt).
//
// When no document exists the code default in Utils/speedyApplyAsk.js is used.
// scripts/seed-speedyapply-ask-prompt.mjs writes that default as a starting point.
const SpeedyApplyAiPromptSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, trim: true },
    systemPrompt: { type: String, required: true },
    model: { type: String, default: "gpt-4o-mini" },
    temperature: { type: Number, default: 0.6, min: 0, max: 1.5 },
    maxTokens: { type: Number, default: 700, min: 100, max: 2000 },
    enabled: { type: Boolean, default: true },
    updatedBy: { type: String, default: "" },
    updatedAt: { type: Date, default: Date.now },
  },
  { collection: "speedyapplyaiprompts" }
);

export const SpeedyApplyAiPrompt = mongoose.model("SpeedyApplyAiPrompt", SpeedyApplyAiPromptSchema);
