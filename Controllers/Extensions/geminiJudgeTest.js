// geminiJudgeTest — GET /test/gemini-for-scraping
//
// Diagnostic endpoint for the production milestone alert showing 100%
// gpt-4o-mini fallback. Reports:
//   - whether credential env vars are present + parseable
//   - whether the Vertex SA file got written
//   - the result of a real one-batch judgeBatchViaGemini call w/ canned input
//
// Idempotent + safe to call repeatedly. Never mutates state. Returns 200
// even on Vertex failure so the JSON body holds the diagnostic — callers
// (curl, ops UI) don't have to handle non-2xx.

import { judgeBatchViaGemini, GEMINI_JUDGE_MODEL } from "../../Utils/vertexGeminiJudge.js";
import fs from "fs";

const SAMPLE_SYSTEM = `You are a hiring-fit grader. Reply with ONLY a JSON object matching the schema {"decisions":[{"id":string,"pick":boolean,"score":number,"reason":string}]}. Score 0-100.`;

const SAMPLE_USER = `Candidate: senior backend engineer, 6yr Python, AWS, ML pipelines.
Jobs:
[{"id":"j1","title":"Senior Backend Engineer (Python)","company":"Acme","location":"Remote"},
 {"id":"j2","title":"Junior Frontend Designer","company":"Beta","location":"NY"}]
Return the JSON.`;

function inspectCredentials() {
    const hasJson = Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
    const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || "";
    const hasPath = Boolean(credPath);
    let jsonParse = null;
    let parseError = null;
    if (hasJson) {
        try {
            let raw = String(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON).trim();
            if ((raw.startsWith("'") && raw.endsWith("'"))
                || (raw.startsWith('"') && raw.endsWith('"') && !raw.startsWith('{"'))) {
                raw = raw.slice(1, -1).trim();
            }
            const parsed = JSON.parse(raw);
            jsonParse = {
                ok: true,
                project_id: parsed.project_id || null,
                client_email: parsed.client_email
                    ? `${parsed.client_email.split("@")[0]}@...${parsed.client_email.split("@")[1]?.split(".").pop() || ""}`
                    : null,
                type: parsed.type || null,
            };
        } catch (err) {
            parseError = err.message;
            jsonParse = { ok: false };
        }
    }
    let credFile = null;
    if (hasPath) {
        try {
            const st = fs.statSync(credPath);
            credFile = { exists: true, size: st.size, path: credPath };
        } catch (err) {
            credFile = { exists: false, path: credPath, error: err.message };
        }
    }
    return {
        env: {
            GOOGLE_APPLICATION_CREDENTIALS_JSON: hasJson ? "set" : "missing",
            GOOGLE_APPLICATION_CREDENTIALS: hasPath ? credPath : "missing",
            GOOGLE_PROJECT_ID: process.env.GOOGLE_PROJECT_ID || "(default flashfire-466710)",
            GOOGLE_LOCATION: process.env.GOOGLE_LOCATION || "(default us-central1)",
            GEMINI_JUDGE_MODEL: GEMINI_JUDGE_MODEL,
        },
        jsonParse,
        parseError,
        credFile,
    };
}

export async function GeminiForScrapingTest(req, res) {
    const t0 = Date.now();
    const creds = inspectCredentials();
    let call = null;
    try {
        const result = await judgeBatchViaGemini({
            system: SAMPLE_SYSTEM,
            user: SAMPLE_USER,
            temperature: 0,
        });
        call = result;
    } catch (err) {
        call = { ok: false, error: "THREW", message: err?.message || String(err) };
    }
    return res.status(200).json({
        ok: Boolean(call?.ok),
        durationMs: Date.now() - t0,
        credentials: creds,
        call,
        hint: call?.ok
            ? "Gemini is reachable — milestone fallback to OpenAI is not a credentials issue. Inspect extension SW logs for HTTP/timeout errors on /extension/gemini-judge."
            : (creds.env.GOOGLE_APPLICATION_CREDENTIALS_JSON === "missing"
                ? "Set GOOGLE_APPLICATION_CREDENTIALS_JSON on production host (raw service-account JSON, no wrapping quotes). Restart node."
                : (creds.jsonParse?.ok === false
                    ? "Credential JSON is set but not valid JSON. Remove wrapping quotes / fix escaping. Restart."
                    : "Credentials look loaded; Vertex itself rejected the call. See call.message and call.error for the upstream reason.")),
    });
}

export default GeminiForScrapingTest;
