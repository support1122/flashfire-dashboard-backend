// geminiJudge — POST /extension/gemini-judge
//
// The JR-Direct extension service worker cannot run Vertex AI (no Node, no
// google-auth-library, service-account keys must not ship in a browser). So
// for the ~10-15% of judge batches it routes to Gemini, it calls this
// endpoint with the SAME system + user prompts it would have sent to OpenAI.
// The extension falls back to OpenAI in-worker if this returns a non-ok body.

import { judgeBatchViaGemini } from "../../Utils/vertexGeminiJudge.js";

export async function GeminiJudge(req, res) {
    try {
        const { system, user, temperature } = req.body || {};
        if (!user || typeof user !== "string") {
            return res.status(400).json({ ok: false, error: "BAD_INPUT", message: "user prompt required" });
        }

        const result = await judgeBatchViaGemini({
            system: typeof system === "string" ? system : "",
            user,
            temperature: Number.isFinite(Number(temperature)) ? Number(temperature) : 0,
        });

        if (!result.ok) {
            // 502 — upstream (Vertex) failed. Extension reads this and falls
            // back to OpenAI for the batch, counting one Gemini error.
            return res.status(502).json(result);
        }

        return res.status(200).json({
            ok: true,
            content: result.content,
            usage: result.usage,
            model: result.model,
            durationMs: result.durationMs,
        });
    } catch (err) {
        console.error("[GeminiJudge] handler error:", err?.message || err);
        return res.status(500).json({ ok: false, error: "SERVER_ERROR", message: err?.message || String(err) });
    }
}

export default GeminiJudge;
