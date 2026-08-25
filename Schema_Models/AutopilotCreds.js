import mongoose from "mongoose";

// Per-client login credentials for the Flashfire Autopilot desktop app, so
// operators never type passwords: the app pulls these and performs the
// JobRight login and the extension-panel login by itself.
//
//   jrEmail / jrPassword   - the client's jobright.ai account
//   extEmail / extPassword - the client's FlashFire dashboard login (what the
//                            extension panel's sign-in form takes)
//   extCode                - the 5-digit operator code the panel asks for
//
// Storage is PLAINTEXT, deliberately matching the existing precedent in the
// scraper service (scraper_client_settings.jrPassword, operator direction
// 2026-04-27): Mongo runs on a private cluster and the read/write routes are
// gated by the x-ops-key shared secret (Middlewares/RequireOpsKey.js). If that
// posture ever changes, encrypt here and in the scraper together.
const AutopilotCredsSchema = new mongoose.Schema(
  {
    clientEmail: { type: String, required: true, unique: true, lowercase: true, trim: true },
    jrEmail: { type: String, default: "" },
    jrPassword: { type: String, default: "" },
    extEmail: { type: String, default: "" },
    extPassword: { type: String, default: "" },
    extCode: { type: String, default: "" },
    updatedBy: { type: String, default: "" }
  },
  { timestamps: true, collection: "autopilotcreds" }
);

export const AutopilotCreds = mongoose.model("AutopilotCreds", AutopilotCredsSchema);
