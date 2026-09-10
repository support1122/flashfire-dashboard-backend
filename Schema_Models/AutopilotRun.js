import mongoose from "mongoose";

// One document per finished Flashfire Autopilot run, for one client.
//
// The autopilot already knew all of this - it just printed it to a terminal on
// a VPS nobody watches. Persisting it is what lets the Client Tracking portal
// answer "how did last night's scrape go for this client" without anyone
// SSHing anywhere.
//
// The three numbers ops actually asks for:
//   captured - job cards the extension pulled off JobRight (panel "#count")
//   pushed   - of those, how many reached the client's dashboard
//   rejected - captured minus pushed: AI skips, duplicates, blocked and errors
//              rolled together. The breakdown lives in dupes/blocked/errors.
//
// captured is stored under its own name rather than "total" because "total" in
// a report table reads as "total jobs", which it is not.
//
// outcome is the machine key ("list-exhausted"); outcomeLabel and why are the
// plain-English pair the autopilot already computes in describe_outcome(), and
// severity ("good"/"warn"/"bad") is what drives the colour in the UI. Storing
// all three means the portal never has to re-implement that mapping and the
// two surfaces can never drift apart.
const AutopilotRunSchema = new mongoose.Schema(
  {
    clientEmail: { type: String, required: true, lowercase: true, trim: true, index: true },
    clientName: { type: String, default: "" },
    profile: { type: String, default: "" },

    captured: { type: Number, default: 0, min: 0 },
    pushed: { type: Number, default: 0, min: 0 },
    rejected: { type: Number, default: 0, min: 0 },
    picks: { type: Number, default: 0, min: 0 },
    dupes: { type: Number, default: 0, min: 0 },
    blocked: { type: Number, default: 0, min: 0 },
    // Named errorCount, not errors: `errors` is a reserved Mongoose document
    // property (validation state) and shadowing it breaks doc.validate().
    errorCount: { type: Number, default: 0, min: 0 },

    cap: { type: Number, default: 0, min: 0 },
    minutes: { type: Number, default: 0, min: 0 },
    attempts: { type: Number, default: 1, min: 1 },

    outcome: { type: String, default: "" },
    outcomeLabel: { type: String, default: "" },
    why: { type: String, default: "" },
    severity: { type: String, enum: ["good", "warn", "bad", ""], default: "" },
    errorText: { type: String, default: "" },

    // Which machine produced it. With the autopilot running on one VPS today
    // and possibly two later, a run with no host is unattributable.
    host: { type: String, default: "" },
    // "schedule" (nightly), "manual" (someone pressed Scrape in the autopilot
    // UI) or "portal" (the Scrape button in Client Tracking).
    trigger: { type: String, default: "manual" },
    requestedBy: { type: String, default: "" },

    startedAt: { type: Date },
    finishedAt: { type: Date, required: true, index: true }
  },
  { timestamps: true, collection: "autopilotruns" }
);

// The report's two access patterns: "latest runs overall" and "this client's
// history". Both sort newest-first, so the index carries the sort as well.
AutopilotRunSchema.index({ clientEmail: 1, finishedAt: -1 });
AutopilotRunSchema.index({ finishedAt: -1 });

export const AutopilotRun = mongoose.model("AutopilotRun", AutopilotRunSchema);
