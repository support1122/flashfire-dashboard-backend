// SpeedyApply "Ask AI" — answers application questions with gpt-4o-mini.
//
//   GET  /extension/speedyapply/ai-config   (ExtensionAuth)
//        200 { ok, ready, model, prompt: { key, version, text }, candidate: { name, hasSummary, hasProfile } }
//   POST /extension/speedyapply/ask         (ExtensionAuth)
//        body { question, notes?, job?: { title, company, description, url } }
//        200 { ok, answer, model, durationMs }
//        400 question_required · 429 rate_limited · 503 no_openai_key / ai_disabled
//        502 openai_<status> / empty_response · 504 timeout · 500 server_error
//
// The OpenAI key is the backend env var `auto_fill_chatgpt_API`; it never
// reaches the browser. The client is the email in the extension JWT, so a
// client only ever gets answers built from their own data.

import "dotenv/config";
import { SpeedyApplyProfile } from "../../Schema_Models/SpeedyApplyProfile.js";
import { ProfileModel } from "../../Schema_Models/ProfileModel.js";
import { SpeedyApplyAiPrompt } from "../../Schema_Models/SpeedyApplyAiPrompt.js";
import { recordAiUsage, AI_USAGE_SOURCES } from "../../Utils/aiUsage.js";
import {
    ASK_PROMPT_KEY,
    DEFAULT_ASK_PROMPT,
    parseAskInput,
    buildCandidateContext,
    buildAskMessages,
    cleanAnswer,
} from "../../Utils/speedyApplyAsk.js";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_MODEL = "gpt-4o-mini";
const TIMEOUT_MS = 30000;
const PROMPT_CACHE_MS = 60 * 1000;

// Per-client limit: generous for real use (a long application has maybe a
// dozen open questions), tight enough that a stuck retry loop cannot run up
// the bill. In-memory is fine for one PM2 process; it resets on restart.
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 40;
const rateHits = new Map();

function rateLimited(email, now = Date.now()) {
    const hits = (rateHits.get(email) || []).filter((t) => now - t < RATE_WINDOW_MS);
    if (hits.length >= RATE_MAX) {
        rateHits.set(email, hits);
        return Math.ceil((RATE_WINDOW_MS - (now - hits[0])) / 1000);
    }
    hits.push(now);
    rateHits.set(email, hits);
    return 0;
}

const openAiKey = () => String(process.env.auto_fill_chatgpt_API || "").trim();

let promptCache = { at: 0, value: null };

// Active prompt config: the Mongo document when present, else the code default.
// A DB failure falls back to the default so answers keep working.
async function loadPromptConfig() {
    if (promptCache.value && Date.now() - promptCache.at < PROMPT_CACHE_MS) return promptCache.value;
    let doc = null;
    try {
        doc = await SpeedyApplyAiPrompt.findOne({ key: ASK_PROMPT_KEY }).lean();
    } catch (err) {
        console.warn("[speedyapply-ask] prompt load failed, using default:", err?.message || err);
    }
    const value = {
        key: ASK_PROMPT_KEY,
        text: doc?.systemPrompt?.trim() || DEFAULT_ASK_PROMPT,
        model: doc?.model || DEFAULT_MODEL,
        temperature: Number.isFinite(doc?.temperature) ? doc.temperature : 0.6,
        maxTokens: Number.isFinite(doc?.maxTokens) ? doc.maxTokens : 700,
        enabled: doc ? doc.enabled !== false : true,
        version: doc?.updatedAt ? new Date(doc.updatedAt).toISOString() : "default",
    };
    promptCache = { at: Date.now(), value };
    return value;
}

async function loadCandidate(email) {
    const [sa, dash] = await Promise.all([
        SpeedyApplyProfile.findOne({ clientEmail: email }).select("profile").lean(),
        ProfileModel.findOne({ email })
            .select("firstName lastName visaStatus yearsOfExperience preferredRoles bachelorsUniDegree mastersUniDegree aiSummary")
            .lean(),
    ]);
    return { profile: sa?.profile || null, dash: dash || null };
}

export async function getSpeedyApplyAiConfig(req, res) {
    try {
        const email = String(req.user?.email || "").toLowerCase();
        const [config, { profile, dash }] = await Promise.all([loadPromptConfig(), loadCandidate(email)]);
        const name = [profile?.firstName || dash?.firstName, profile?.lastName || dash?.lastName].filter(Boolean).join(" ");
        return res.status(200).json({
            ok: true,
            ready: !!openAiKey() && config.enabled,
            model: config.model,
            prompt: { key: config.key, version: config.version, text: config.text },
            candidate: { name, hasProfile: !!profile, hasSummary: !!dash?.aiSummary },
        });
    } catch (err) {
        console.error("[speedyapply-ask] config error:", err?.message || err);
        return res.status(500).json({ ok: false, error: "server_error" });
    }
}

export async function askSpeedyApplyAi(req, res) {
    const startedAt = Date.now();
    try {
        const email = String(req.user?.email || "").toLowerCase();
        const input = parseAskInput(req.body);
        if (!input.ok) return res.status(400).json({ ok: false, error: input.error });

        const apiKey = openAiKey();
        if (!apiKey) return res.status(503).json({ ok: false, error: "no_openai_key" });

        const config = await loadPromptConfig();
        if (!config.enabled) return res.status(503).json({ ok: false, error: "ai_disabled" });

        const retryAfter = rateLimited(email);
        if (retryAfter) {
            res.set("Retry-After", String(retryAfter));
            return res.status(429).json({ ok: false, error: "rate_limited", retryAfter });
        }

        const { profile, dash } = await loadCandidate(email);
        const messages = buildAskMessages({
            systemPrompt: config.text,
            question: input.value.question,
            notes: input.value.notes,
            job: input.value.job,
            candidate: buildCandidateContext(profile, dash),
        });

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
        let upstream;
        try {
            upstream = await fetch(OPENAI_URL, {
                method: "POST",
                signal: controller.signal,
                headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
                body: JSON.stringify({
                    model: config.model,
                    messages,
                    temperature: config.temperature,
                    max_tokens: config.maxTokens,
                }),
            });
        } catch (err) {
            const timedOut = err?.name === "AbortError";
            console.warn("[speedyapply-ask] OpenAI request failed:", err?.message || err);
            return res.status(timedOut ? 504 : 502).json({ ok: false, error: timedOut ? "timeout" : "network" });
        } finally {
            clearTimeout(timer);
        }

        if (!upstream.ok) {
            const txt = await upstream.text().catch(() => "");
            console.warn(`[speedyapply-ask] OpenAI ${upstream.status}:`, txt.slice(0, 300));
            return res.status(502).json({ ok: false, error: `openai_${upstream.status}` });
        }

        const data = await upstream.json();
        recordAiUsage({ source: AI_USAGE_SOURCES.SPEEDYAPPLY_ASK, model: data?.model || config.model, usage: data?.usage });
        const answer = cleanAnswer(data?.choices?.[0]?.message?.content);
        if (!answer) return res.status(502).json({ ok: false, error: "empty_response" });

        return res.status(200).json({ ok: true, answer, model: data?.model || config.model, durationMs: Date.now() - startedAt });
    } catch (err) {
        console.error("[speedyapply-ask] handler error:", err?.message || err);
        return res.status(500).json({ ok: false, error: "server_error" });
    }
}
