// vertexGeminiJudge — Vertex AI (Gemini) judge path for the JR-Direct
// extension pipeline. The extension routes a small slice (~10-15%) of its
// AI-judge batches here; the rest stay on OpenAI in the extension service
// worker. A Gemini failure here lets the extension fall back to OpenAI.
//
// Initialization mirrors gemini-resume-latest-main/backend/utils/gemini.js:
//   - Production (Render, etc.): GOOGLE_APPLICATION_CREDENTIALS_JSON holds
//     the full service-account JSON string. We write it to a temp file and
//     point GOOGLE_APPLICATION_CREDENTIALS at that file.
//   - Local: GOOGLE_APPLICATION_CREDENTIALS already points at a key file.
//   - Vertex needs a regional endpoint ("global" returns HTML error bodies).

// Load .env before the credential bootstrap below. ES-module imports are
// hoisted, so this module can evaluate before index.js calls dotenv.config()
// — without this line GOOGLE_APPLICATION_CREDENTIALS_JSON would be undefined
// at bootstrap time. dotenv.config() is idempotent, so a second call later
// is harmless.
import "dotenv/config";

import fs from "fs";
import path from "path";
import os from "os";
import { VertexAI } from "@google-cloud/vertexai";

if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    try {
        let rawCred = String(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON).trim();
        // Strip ONE layer of wrapping quotes. Common copy-paste mistake: the
        // value was lifted out of a .env file (where the JSON is single-quoted
        // as `KEY='{...}'`) and pasted into a host env-var UI, where the value
        // must be the raw unquoted JSON. Without this, JSON.parse chokes on
        // the leading quote and auth fails silently.
        if (
            (rawCred.startsWith("'") && rawCred.endsWith("'")) ||
            (rawCred.startsWith('"') && rawCred.endsWith('"') && !rawCred.startsWith('{"'))
        ) {
            rawCred = rawCred.slice(1, -1).trim();
        }
        const parsed = JSON.parse(rawCred); // throws → caught below
        const tmpPath = path.join(os.tmpdir(), `gcp-credentials-${process.pid}.json`);
        // Write the re-serialised JSON so the key file is always clean.
        fs.writeFileSync(tmpPath, JSON.stringify(parsed), "utf8");
        process.env.GOOGLE_APPLICATION_CREDENTIALS = tmpPath;
        console.log("[VertexJudge] Using Vertex AI credentials from GOOGLE_APPLICATION_CREDENTIALS_JSON (temp file)");
    } catch (err) {
        console.error(
            "[VertexJudge] GOOGLE_APPLICATION_CREDENTIALS_JSON is set but not valid JSON — "
            + "paste the RAW service-account JSON (starting with { ending with }), no surrounding quotes. Error:",
            err.message,
        );
    }
}

// Whether usable Gemini credentials are present. True only when a key file
// path is in place (set above from valid JSON, or pre-set as a file path).
// When false, google-auth would fall back to probing the GCE metadata server
// — which HANGS for ~tens of seconds on a non-GCP host until Cloudflare 502s.
// We detect that here and fail fast instead.
const HAS_GEMINI_CREDENTIALS = Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS);
if (!HAS_GEMINI_CREDENTIALS) {
    console.warn("[VertexJudge] No GCP credentials (GOOGLE_APPLICATION_CREDENTIALS_JSON / GOOGLE_APPLICATION_CREDENTIALS) — Gemini judge disabled; /extension/gemini-judge will fail fast and the extension falls back to OpenAI.");
}

// Hard ceiling on a single Vertex call. Even with credentials, a wedged
// Vertex request must never outlive this — the route returns fast and the
// extension falls back rather than the client hanging.
const VERTEX_CALL_TIMEOUT_MS = Number(process.env.GEMINI_JUDGE_TIMEOUT_MS) || 25000;

function withTimeout(promise, ms, label) {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// gemini-2.5-flash-lite — cheapest Gemini 2.5 tier, used for the judge slice.
const GEMINI_JUDGE_MODEL = process.env.GEMINI_JUDGE_MODEL || "gemini-2.5-flash-lite";

function resolveVertexLocation() {
    const raw = (process.env.GOOGLE_LOCATION || process.env.VERTEX_LOCATION || "us-central1").trim();
    if (!raw || /^global$/i.test(raw)) return "us-central1";
    return raw;
}

const vertexAi = new VertexAI({
    project: process.env.GOOGLE_PROJECT_ID || process.env.GCLOUD_PROJECT || "flashfire-466710",
    location: resolveVertexLocation(),
});

// extractVertexUsage — pull token counts out of a Vertex response so the
// caller (and the milestone cost notifier) can price the call accurately.
export function extractVertexUsage(vertexResponse) {
    const u = vertexResponse?.response?.usageMetadata;
    if (!u) return { promptTokenCount: 0, candidatesTokenCount: 0, totalTokenCount: 0 };
    const prompt = Number(u.promptTokenCount) || 0;
    const cand = Number(u.candidatesTokenCount) || 0;
    const total = u.totalTokenCount != null ? Number(u.totalTokenCount) : prompt + cand;
    return { promptTokenCount: prompt, candidatesTokenCount: cand, totalTokenCount: total };
}

// judgeBatchViaGemini — run one judge batch on Gemini.
// Input:  { system, user, temperature } — same prompts the extension builds
//         for OpenAI (system + user message strings).
// Output: { ok:true, content, usage, model, durationMs }
//         { ok:false, error } on any Vertex / parsing failure.
export async function judgeBatchViaGemini({ system, user, temperature = 0 }) {
    if (!user || typeof user !== "string") {
        return { ok: false, error: "BAD_INPUT", message: "user prompt required" };
    }
    // Fail fast when this host has no GCP credentials — never let the call
    // hang on a metadata-server probe.
    if (!HAS_GEMINI_CREDENTIALS) {
        return {
            ok: false,
            error: "NO_CREDENTIALS",
            message: "GCP credentials not configured on this host (set GOOGLE_APPLICATION_CREDENTIALS_JSON).",
        };
    }
    const startedAt = Date.now();
    try {
        const model = vertexAi.getGenerativeModel({
            model: GEMINI_JUDGE_MODEL,
            systemInstruction: system
                ? { role: "system", parts: [{ text: String(system) }] }
                : undefined,
            generationConfig: {
                temperature,
                responseMimeType: "application/json",
            },
        });

        const resp = await withTimeout(
            model.generateContent({
                contents: [{ role: "user", parts: [{ text: user }] }],
            }),
            VERTEX_CALL_TIMEOUT_MS,
            "Vertex generateContent",
        );

        const content = resp?.response?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!content) {
            return { ok: false, error: "EMPTY_RESPONSE", message: "Vertex returned no content" };
        }
        return {
            ok: true,
            content,
            usage: extractVertexUsage(resp),
            model: GEMINI_JUDGE_MODEL,
            durationMs: Date.now() - startedAt,
        };
    } catch (err) {
        return {
            ok: false,
            error: "VERTEX_ERROR",
            message: err?.message || String(err),
            durationMs: Date.now() - startedAt,
        };
    }
}

// callGemini — generic Gemini completion. Same plumbing as judgeBatchViaGemini
// but lets callers ask for plain text output (json=false) so non-judge flows
// (e.g. AI summary builder) can share the Vertex client + credentials check.
export async function callGemini({ system, user, temperature = 0.2, json = false, model, timeoutMs }) {
    if (!user || typeof user !== "string") {
        return { ok: false, error: "BAD_INPUT", message: "user prompt required" };
    }
    if (!HAS_GEMINI_CREDENTIALS) {
        return { ok: false, error: "NO_CREDENTIALS", message: "GCP credentials not configured" };
    }
    const startedAt = Date.now();
    try {
        const generationConfig = { temperature };
        if (json) generationConfig.responseMimeType = "application/json";
        const m = vertexAi.getGenerativeModel({
            model: model || GEMINI_JUDGE_MODEL,
            systemInstruction: system
                ? { role: "system", parts: [{ text: String(system) }] }
                : undefined,
            generationConfig,
        });
        const resp = await withTimeout(
            m.generateContent({ contents: [{ role: "user", parts: [{ text: user }] }] }),
            timeoutMs || VERTEX_CALL_TIMEOUT_MS,
            "Vertex generateContent",
        );
        const content = resp?.response?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!content) return { ok: false, error: "EMPTY_RESPONSE", message: "Vertex returned no content" };
        return {
            ok: true,
            content,
            usage: extractVertexUsage(resp),
            model: model || GEMINI_JUDGE_MODEL,
            durationMs: Date.now() - startedAt,
        };
    } catch (err) {
        return {
            ok: false,
            error: "VERTEX_ERROR",
            message: err?.message || String(err),
            durationMs: Date.now() - startedAt,
        };
    }
}

export { GEMINI_JUDGE_MODEL, HAS_GEMINI_CREDENTIALS };
