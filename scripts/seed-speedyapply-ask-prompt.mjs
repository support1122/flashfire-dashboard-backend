// Write the default SpeedyApply "Ask AI" prompt into Mongo so ops can edit it
// there (collection speedyapplyaiprompts, key "ask"). Without a document the
// backend already uses the same default from Utils/speedyApplyAsk.js, so this
// is only needed once you want to tune the wording without a deploy.
//
//   node scripts/seed-speedyapply-ask-prompt.mjs           # insert only if missing
//   node scripts/seed-speedyapply-ask-prompt.mjs --force   # overwrite with the code default
//
// The backend caches the prompt for 60 seconds, so an edit is live within a minute.

import "dotenv/config";
import mongoose from "mongoose";
import { SpeedyApplyAiPrompt } from "../Schema_Models/SpeedyApplyAiPrompt.js";
import { ASK_PROMPT_KEY, DEFAULT_ASK_PROMPT } from "../Utils/speedyApplyAsk.js";

const force = process.argv.includes("--force");
const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
if (!uri) {
  console.error("MONGODB_URI is not set.");
  process.exit(1);
}

await mongoose.connect(uri, { serverSelectionTimeoutMS: 20000 });
try {
  const existing = await SpeedyApplyAiPrompt.findOne({ key: ASK_PROMPT_KEY }).lean();
  if (existing && !force) {
    console.log(`Prompt "${ASK_PROMPT_KEY}" already exists (updated ${existing.updatedAt?.toISOString?.() || "?"}). Use --force to overwrite.`);
  } else {
    await SpeedyApplyAiPrompt.updateOne(
      { key: ASK_PROMPT_KEY },
      { $set: { systemPrompt: DEFAULT_ASK_PROMPT, model: "gpt-4o-mini", enabled: true, updatedBy: "seed-script", updatedAt: new Date() } },
      { upsert: true }
    );
    console.log(`Prompt "${ASK_PROMPT_KEY}" ${existing ? "overwritten" : "created"}.`);
  }
} finally {
  await mongoose.disconnect();
}
