// SpeedyApply shared learning — daily merge.
//
// Every extension pushes its learned label aliases into its own
// SpeedyApplyProfile.learned (on change, and once a day at a fixed time). At
// 03:30 IST this worker merges all of them (Utils/speedyApplyLearning.js) into
// the single SpeedyApplySharedLearning document that extensions download.
//
// Env:
//   SPEEDYAPPLY_LEARNING_CRON   cron expression, default "30 3 * * *" (IST)
//   SPEEDYAPPLY_LEARNING_MIN_CLIENTS   default 3

import cron from "node-cron";
import crypto from "crypto";
import { SpeedyApplyProfile } from "../../Schema_Models/SpeedyApplyProfile.js";
import { SpeedyApplySharedLearning } from "../../Schema_Models/SpeedyApplySharedLearning.js";
import { mergeLearnedMaps } from "../../Utils/speedyApplyLearning.js";

let running = false;

// Stable hash of the mappings, so the version only moves when the content does.
function versionOf(mappings) {
  const keys = Object.keys(mappings).sort();
  const flat = keys.map((k) => `${k}=${mappings[k].profileField}`).join("\n");
  return crypto.createHash("sha1").update(flat).digest("hex").slice(0, 16);
}

export async function rebuildSharedLearning({ trigger = "manual" } = {}) {
  if (running) return { skipped: "already_running" };
  running = true;
  const startedAt = Date.now();
  try {
    const maps = [];
    const cursor = SpeedyApplyProfile.find({ learned: { $ne: null } }).select("learned").lean().cursor();
    for await (const doc of cursor) maps.push(doc.learned);

    const minClients = Number(process.env.SPEEDYAPPLY_LEARNING_MIN_CLIENTS) || undefined;
    const { mappings, stats } = mergeLearnedMaps(maps, minClients ? { minClients } : {});
    const version = versionOf(mappings);

    const prev = await SpeedyApplySharedLearning.findOne({ key: "global" }).select("version").lean();
    if (prev?.version === version) {
      await SpeedyApplySharedLearning.updateOne({ key: "global" }, { $set: { stats, builtAt: new Date() } });
    } else {
      await SpeedyApplySharedLearning.updateOne(
        { key: "global" },
        { $set: { mappings, version, stats, builtAt: new Date() } },
        { upsert: true }
      );
    }
    console.log(`[speedyapply-learning] ${trigger}: contributors=${stats.contributors} shared=${stats.shared} contested=${stats.contested} version=${version}${prev?.version === version ? " (unchanged)" : ""} ms=${Date.now() - startedAt}`);
    return { version, stats, changed: prev?.version !== version };
  } catch (err) {
    console.error("[speedyapply-learning] rebuild failed:", err?.message || err);
    return { error: err?.message || String(err) };
  } finally {
    running = false;
  }
}

let task = null;
export function startSpeedyApplyLearningWorker() {
  if (task) return task;
  // Under PM2 cluster mode every instance would run the job; the result is the
  // same document either way, but one run is enough.
  if (process.env.NODE_APP_INSTANCE && process.env.NODE_APP_INSTANCE !== "0") return null;
  const expr = process.env.SPEEDYAPPLY_LEARNING_CRON || "30 3 * * *";
  task = cron.schedule(expr, () => rebuildSharedLearning({ trigger: "cron" }), { timezone: "Asia/Kolkata" });
  console.log(`[speedyapply-learning] worker registered (cron='${expr}' IST)`);
  // First deploy: build once so extensions do not wait a day for the first map.
  setTimeout(async () => {
    try {
      const exists = await SpeedyApplySharedLearning.exists({ key: "global" });
      if (!exists) await rebuildSharedLearning({ trigger: "boot" });
    } catch (e) {
      console.warn("[speedyapply-learning] boot check failed:", e?.message || e);
    }
  }, 20000);
  return task;
}
