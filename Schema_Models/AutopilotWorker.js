import mongoose from "mongoose";

// A "profile" in the autopilot's own words: one machine's share of the client
// roster. The Contabo server is one, each operator's laptop is another.
//
// Why this exists: the server drops roughly half its outbound connections
// (measured 2026-09-08, see extension-autopilot/CONTABO-SUPPORT-TICKET.md), so
// runs there time out that would succeed on a laptop. Splitting the roster
// across machines gets the work done while that stays broken, and gets it done
// faster afterwards.
//
// NAMING: the ops-facing word is "profile", but this codebase already uses
// "profile" for a per-client Chrome profile directory (config.profilesDir,
// slug(email)). Those are unrelated and easy to confuse, so everything in code
// says "worker" and only the UI says "Profile".
//
// There is deliberately no password. Choosing a worker is a dropdown, admin
// included - the team asked for zero friction, and the app already sits behind
// its own UI token.
const AutopilotWorkerSchema = new mongoose.Schema(
  {
    // Stable id used in URLs, config.json and heartbeats. Derived from the
    // display name once and then never changed, so renaming a worker cannot
    // orphan its assignments.
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    note: { type: String, default: "" },
    createdBy: { type: String, default: "" },

    // Live state, refreshed by the running app's heartbeat. Kept on the worker
    // rather than in a separate collection because it is strictly one row per
    // worker and every reader wants both halves at once.
    host: { type: String, default: "" },
    lastSeenAt: { type: Date, default: null },
    running: { type: [String], default: [] },   // client emails scraping right now
    queued: { type: [String], default: [] },    // client emails waiting in its lanes
    lanes: { type: Number, default: 0 },        // parallel limit it is using
    appVersion: { type: String, default: "" }
  },
  { timestamps: true, collection: "autopilotworkers" }
);

// How long after its last heartbeat a worker is still considered online. The
// app beats every 20s; three missed beats is a machine that was closed, lost
// its network, or crashed. Deliberately generous because this VPS's packet
// loss makes a single missed beat meaningless.
export const WORKER_ONLINE_SECONDS = 70;

export const AutopilotWorker = mongoose.model("AutopilotWorker", AutopilotWorkerSchema);
