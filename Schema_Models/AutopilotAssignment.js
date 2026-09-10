import mongoose from "mongoose";

// Which worker ("profile") owns a client. One row per assigned client.
//
// A client belongs to exactly one worker, enforced by the unique key on
// clientEmail rather than by hoping the UI behaves. That exclusivity is the
// whole safety mechanism: two machines running the same client would drive two
// Chrome sessions against one JobRight account and race each other's pushes
// against the same daily cap.
//
// Unassigned clients have NO row here. They show up only in the admin's
// Unassigned bucket, so a client nobody has handed out is never scraped by
// accident - the trade-off being that a forgotten client is silently never
// worked, which is why the admin view counts them prominently.
const AutopilotAssignmentSchema = new mongoose.Schema(
  {
    clientEmail: { type: String, required: true, unique: true, lowercase: true, trim: true },
    // AutopilotWorker.slug. Not a ref: deleting a worker must not cascade-
    // delete assignments silently, and the controller reconciles orphans by
    // reporting them as unassigned.
    worker: { type: String, required: true, lowercase: true, trim: true, index: true },
    assignedBy: { type: String, default: "" }
  },
  { timestamps: true, collection: "autopilotassignments" }
);

export const AutopilotAssignment = mongoose.model("AutopilotAssignment", AutopilotAssignmentSchema);
