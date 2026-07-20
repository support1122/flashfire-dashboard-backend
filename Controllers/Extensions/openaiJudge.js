// openaiJudge — POST /extension/openai-judge
//
// Backend-proxied gpt-4o-mini judge call. The JR-Direct extension service
// worker now routes ALL OpenAI judge batches through here so the
// OPENAI_API_KEY never lives in the browser. Gemini stays the primary
// judge (see /extension/gemini-judge); this endpoint only fires when the
// extension's Gemini call returns !ok.
//
// Request:  { system?: string, user: string, temperature?: number }
// Response: 200 { ok:true, content, usage, model, durationMs }
//           400 BAD_INPUT
//           502 OPENAI_<status> on upstream HTTP failure
//           503 NO_OPENAI_KEY when env not configured
//           504 TIMEOUT on hung upstream

import "dotenv/config";
import { recordAiUsage, AI_USAGE_SOURCES } from "../../Utils/aiUsage.js";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL = process.env.OPENAI_JUDGE_MODEL || "gpt-4o-mini";
const OPENAI_TIMEOUT_MS = Number(process.env.OPENAI_JUDGE_TIMEOUT_MS) || 25000;

function withTimeout(promise, ms, label) {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export async function OpenAiJudge(req, res) {
    const startedAt = Date.now();
    try {
        const { system, user, temperature } = req.body || {};
        if (!user || typeof user !== "string") {
            return res.status(400).json({ ok: false, error: "BAD_INPUT", message: "user prompt required" });
        }
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            return res.status(503).json({ ok: false, error: "NO_OPENAI_KEY", message: "OPENAI_API_KEY not configured on backend" });
        }
        const messages = [];
        if (typeof system === "string" && system.length > 0) {
            messages.push({ role: "system", content: system });
        }
        messages.push({ role: "user", content: user });
        const body = {
            model: OPENAI_MODEL,
            messages,
            response_format: { type: "json_object" },
            temperature: Number.isFinite(Number(temperature)) ? Number(temperature) : 0,
        };
        let upstream;
        try {
            upstream = await withTimeout(
                fetch(OPENAI_URL, {
                    method: "POST",
                    headers: {
                        "content-type": "application/json",
                        authorization: `Bearer ${apiKey}`,
                    },
                    body: JSON.stringify(body),
                }),
                OPENAI_TIMEOUT_MS,
                "OpenAI chat.completions",
            );
        } catch (err) {
            const isTimeout = String(err?.message || "").includes("timed out");
            return res.status(isTimeout ? 504 : 502).json({
                ok: false,
                error: isTimeout ? "TIMEOUT" : "NETWORK",
                message: err?.message || String(err),
                durationMs: Date.now() - startedAt,
            });
        }
        if (!upstream.ok) {
            const txt = await upstream.text().catch(() => "");
            return res.status(502).json({
                ok: false,
                error: `OPENAI_${upstream.status}`,
                message: txt.slice(0, 600),
                durationMs: Date.now() - startedAt,
            });
        }
        const data = await upstream.json();
        recordAiUsage({
            source: AI_USAGE_SOURCES.FIRST_JUDGE,
            model: data?.model || OPENAI_MODEL,
            usage: data?.usage,
        });
        const content = data?.choices?.[0]?.message?.content;
        if (typeof content !== "string") {
            return res.status(502).json({ ok: false, error: "EMPTY_RESPONSE", message: "OpenAI returned no content", durationMs: Date.now() - startedAt });
        }
        return res.status(200).json({
            ok: true,
            content,
            usage: data?.usage || {},
            model: data?.model || OPENAI_MODEL,
            durationMs: Date.now() - startedAt,
        });
    } catch (err) {
        console.error("[OpenAiJudge] handler error:", err?.message || err);
        return res.status(500).json({ ok: false, error: "SERVER_ERROR", message: err?.message || String(err) });
    }
}

export default OpenAiJudge;
