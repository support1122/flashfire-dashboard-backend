// POST /extension/session-stat
// Body: {
//   operatorEmail, operatorName?, clientEmail, clientName?,
//   captures, linkedinSkipped, judged, picks, pushed, duplicates, blocked, errors,
//   startedAt?, endedAt?, extensionVersion?
// }
// Logs one extension session — called by the JR-direct extension's SW when
// the operator stops capture or runs flush. Idempotent insert (no upsert key
// since each session is its own row). Drives the "who is working" panel on
// the AI Summaries page.

import { ExtensionSessionStat } from "../Schema_Models/ExtensionSessionStat.js";

function num(v) {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

export default async function ExtensionSessionStatLog(req, res) {
    try {
        const b = req.body || {};
        const operatorEmail = String(b.operatorEmail || "").trim().toLowerCase();
        const operatorName = String(b.operatorName || "").trim().slice(0, 200);
        const clientEmail = String(b.clientEmail || "").trim().toLowerCase();
        if (!operatorName) {
            return res.status(400).json({ success: false, error: "BAD_INPUT", message: "operatorName required" });
        }
        if (!clientEmail || !clientEmail.includes("@")) {
            return res.status(400).json({ success: false, error: "BAD_INPUT", message: "clientEmail required" });
        }
        // Normalise the per-skipKind tallies. Accept both raw skipsByKind
        // (free-form) AND the canonical 7-key rollup the extension sends.
        const sb = (b.skipsByKind && typeof b.skipsByKind === "object") ? b.skipsByKind : {};
        const sr = b.skipsRollup || {};
        const doc = await ExtensionSessionStat.create({
            operatorEmail,
            operatorName,
            extensionCode: String(b.extensionCode || "").trim().slice(0, 64),
            clientEmail,
            clientName: String(b.clientName || "").slice(0, 200),
            captures: num(b.captures),
            linkedinSkipped: num(b.linkedinSkipped),
            judged: num(b.judged),
            picks: num(b.picks),
            pushed: num(b.pushed),
            duplicates: num(b.duplicates),
            blocked: num(b.blocked),
            errors: num(b.errors),
            skipsByKind: sb,
            skipsRollup: {
                roleMismatch:      num(sr.roleMismatch),
                seniorityMismatch: num(sr.seniorityMismatch),
                locationMismatch:  num(sr.locationMismatch),
                authMismatch:      num(sr.authMismatch),
                threshold:         num(sr.threshold),
                companyBlocked:    num(sr.companyBlocked),
                other:             num(sr.other),
            },
            startedAt: b.startedAt ? new Date(b.startedAt) : null,
            endedAt: b.endedAt ? new Date(b.endedAt) : new Date(),
            extensionVersion: String(b.extensionVersion || "").slice(0, 32),
        });
        return res.json({ success: true, id: doc._id });
    } catch (err) {
        console.error("ExtensionSessionStatLog error:", err);
        return res.status(500).json({ success: false, error: "INTERNAL", message: err.message });
    }
}
