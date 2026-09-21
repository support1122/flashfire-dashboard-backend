// ClientTrackingModel — read-only handle on the `DashboardTracking` collection
// owned by the applications-monitor backend (DASH/clients-tracking). Both
// backends share the same MongoDB URI, so we can query the same docs from
// here without an HTTP hop.
//
// Only the fields the dashboard-backend reads are declared (strict:false
// keeps unknown fields in lean() results). The applications-monitor backend
// remains the writer.

import mongoose from "mongoose";

const ClientTrackingSchema = new mongoose.Schema(
    {
        email: { type: String, lowercase: true, trim: true, index: true },
        planType: { type: String },
        // addons[] entries each have a NUMERIC `type` (string or number)
        // representing extra applications granted (e.g. "1000" / 500).
        // applications-monitor sums parseInt(a.type) for each entry.
        addons: { type: Array, default: [] },
    },
    { strict: false, collection: "DashboardTracking" },
);

// Avoid re-compile errors when this module is re-imported in test/dev.
export const ClientTrackingModel =
    mongoose.models.DashboardTracking ||
    mongoose.model("DashboardTracking", ClientTrackingSchema);

// computeAddonBonus(clientDoc) → integer ≥ 0. Sums parseInt(addons[i].type)
// (or .addonType for legacy entries). Mirrors applications-monitor's reducer
// at index.js:3428 so the cap and the tracker UI agree exactly.
export function computeAddonBonus(clientDoc) {
    const arr = Array.isArray(clientDoc?.addons) ? clientDoc.addons : [];
    let sum = 0;
    for (const a of arr) {
        const v = parseInt(a?.type ?? a?.addonType ?? 0, 10);
        if (Number.isFinite(v) && v > 0) sum += v;
    }
    return sum;
}
