import mongoose from "mongoose";

// A request to scrape one client, queued from the Client Tracking portal.
//
// Why a queue instead of the portal calling the autopilot directly:
//
//   1. The portal is served over HTTPS. The autopilot listens on plain HTTP at
//      167.86.93.77, so a browser blocks the call outright as mixed content.
//      No amount of CORS configuration fixes that.
//   2. That box's inbound network drops roughly half of all TCP connections
//      (measured 2026-09-08; see extension-autopilot/CONTABO-SUPPORT-TICKET.md),
//      so even server-to-server calls into it fail often.
//   3. Calling it directly would put the autopilot's UI token in a browser
//      bundle.
//
// Polling inverts all three: the autopilot opens the connection, retries cost
// nothing, and no inbound reachability or shared token is needed. A scrape
// takes ~20 minutes, so nothing here could have been a synchronous request
// anyway.
//
// Lifecycle: queued -> claimed -> done | failed, or cancelled while queued.
// "claimed" exists so a request is never picked up twice if two autopilot
// instances ever poll the same backend.
const AutopilotRunRequestSchema = new mongoose.Schema(
  {
    clientEmail: { type: String, required: true, lowercase: true, trim: true },
    clientName: { type: String, default: "" },
    // Null means "use the client's saved maxJobs". Never defaulted to 30 here:
    // that would silently override a client deliberately set lower.
    maxJobs: { type: Number, default: null, min: 1, max: 30 },

    status: {
      type: String,
      enum: ["queued", "claimed", "done", "failed", "cancelled"],
      default: "queued",
      index: true
    },
    requestedBy: { type: String, default: "" },
    claimedBy: { type: String, default: "" },
    claimedAt: { type: Date },
    finishedAt: { type: Date },
    // Copied off the finished run so the portal can show the result without a
    // second lookup.
    outcome: { type: String, default: "" },
    outcomeLabel: { type: String, default: "" },
    message: { type: String, default: "" },
    runId: { type: mongoose.Schema.Types.ObjectId, ref: "AutopilotRun", default: null }
  },
  { timestamps: true, collection: "autopilotrunrequests" }
);

// The autopilot's poll: oldest queued first, so a queue is served in order.
AutopilotRunRequestSchema.index({ status: 1, createdAt: 1 });

// One live request per client. An operator double-clicking Scrape, or two
// admins queueing the same client, must not start two browsers for one person
// - they would fight over the same Chrome profile directory. The unique index
// makes that impossible in the database rather than hoping the UI prevents it.
AutopilotRunRequestSchema.index(
  { clientEmail: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ["queued", "claimed"] } },
    name: "one_live_request_per_client"
  }
);

export const AutopilotRunRequest = mongoose.model("AutopilotRunRequest", AutopilotRunRequestSchema);
