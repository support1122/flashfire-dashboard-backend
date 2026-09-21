// GET /admin/pricing-info
// Output:
//   {
//     success,
//     openai: { model, inputPerMTok, outputPerMTok, currency, asOf },
//     fx:     { base, quote, rate, fetchedAt, source },
//     sample: { tokens: {input, output}, costUSD, costINR }
//   }
//
// Powers the "Daily AI cost" tile on the Clients-Tracking AI Summaries
// page. Couples OpenAI's gpt-4o-mini token rates (kept here as a hardcoded
// rate card — OpenAI has no public pricing API) with a live USD→INR
// exchange-rate lookup (open.er-api.com — free, no key). FX result is
// cached in-memory for 1 hour to avoid hammering the upstream.

import axios from "axios";

// Hardcoded gpt-4o-mini + gpt-4o rate card. Update this block when
// OpenAI changes pricing. `asOf` is what the UI surfaces so ops can see
// data freshness. Source: https://openai.com/api/pricing/
const OPENAI_RATES = {
    "gpt-4o-mini": {
        model: "gpt-4o-mini",
        inputPerMTok: 0.15,    // USD per 1M input tokens
        outputPerMTok: 0.60,   // USD per 1M output tokens
        currency: "USD",
        asOf: "2025-04-01",
    },
    "gpt-4o": {
        model: "gpt-4o",
        inputPerMTok: 2.50,
        outputPerMTok: 10.00,
        currency: "USD",
        asOf: "2025-04-01",
    },
};

const FX_URL = "https://open.er-api.com/v6/latest/USD";
const FX_TTL_MS = 60 * 60 * 1000; // 1h
let _fxCache = { rate: null, fetchedAt: 0, error: null };

async function getUsdInr() {
    const now = Date.now();
    if (_fxCache.rate && now - _fxCache.fetchedAt < FX_TTL_MS) {
        return { rate: _fxCache.rate, fetchedAt: _fxCache.fetchedAt, source: FX_URL, cached: true };
    }
    try {
        const r = await axios.get(FX_URL, { timeout: 8000 });
        const rate = Number(r.data?.rates?.INR);
        if (!Number.isFinite(rate) || rate <= 0) {
            throw new Error("FX response missing INR rate");
        }
        _fxCache = { rate, fetchedAt: now, error: null };
        return { rate, fetchedAt: now, source: FX_URL, cached: false };
    } catch (err) {
        // Soft fallback: keep a sensible default so the UI degrades gracefully.
        const fallback = _fxCache.rate || 83.5;
        _fxCache.error = err.message;
        return {
            rate: fallback,
            fetchedAt: _fxCache.fetchedAt || now,
            source: FX_URL,
            cached: !!_fxCache.fetchedAt,
            error: err.message,
            stale: true,
        };
    }
}

export default async function PricingInfo(req, res) {
    try {
        const modelKey = String(req.query.model || "gpt-4o-mini").toLowerCase();
        const openai = OPENAI_RATES[modelKey] || OPENAI_RATES["gpt-4o-mini"];
        const fx = await getUsdInr();
        // Sample calc: typical AI-summary build uses ~2k input + 0.5k output.
        // Lets the UI render "≈ ₹X per build" without operator math.
        const sampleInput = 2000;
        const sampleOutput = 500;
        const costUSD =
            (sampleInput / 1_000_000) * openai.inputPerMTok
            + (sampleOutput / 1_000_000) * openai.outputPerMTok;
        const costINR = costUSD * fx.rate;

        return res.json({
            success: true,
            openai,
            allModels: OPENAI_RATES,
            fx: {
                base: "USD",
                quote: "INR",
                rate: fx.rate,
                fetchedAt: fx.fetchedAt ? new Date(fx.fetchedAt).toISOString() : null,
                source: fx.source,
                cached: fx.cached || false,
                stale: fx.stale || false,
                error: fx.error || null,
            },
            sample: {
                tokens: { input: sampleInput, output: sampleOutput },
                costUSD: Number(costUSD.toFixed(6)),
                costINR: Number(costINR.toFixed(4)),
            },
        });
    } catch (err) {
        console.error("PricingInfo error:", err);
        return res.status(500).json({ success: false, error: "INTERNAL", message: err.message });
    }
}
