// GET /extension/speedyapply/shared-learning?version=<what the extension has>
// (ExtensionAuth)
//
// The merged label -> profile-field aliases (see Utils/speedyApplyLearning.js).
// 200 { ok, version, builtAt, changed, mappings }
//   changed:false and mappings:{} when the caller already has this version, so
//   the daily pull costs almost nothing when nothing moved.
//   mappings is { label: profileField }.
// 500 { ok:false, error:"server_error" }

import { SpeedyApplySharedLearning } from "../../Schema_Models/SpeedyApplySharedLearning.js";

export async function getSpeedyApplySharedLearning(req, res) {
    try {
        const have = String(req.query?.version || "");
        const doc = await SpeedyApplySharedLearning.findOne({ key: "global" }).lean();
        const version = doc?.version || "";
        const builtAt = doc?.builtAt || null;
        if (!doc || (have && have === version)) {
            return res.status(200).json({ ok: true, version, builtAt, changed: false, mappings: {} });
        }
        const mappings = {};
        for (const [label, entry] of Object.entries(doc.mappings || {})) {
            if (entry?.profileField) mappings[label] = entry.profileField;
        }
        return res.status(200).json({ ok: true, version, builtAt, changed: true, mappings });
    } catch (err) {
        console.error("[speedyapply-learning] read error:", err?.message || err);
        return res.status(500).json({ ok: false, error: "server_error" });
    }
}
