import mongoose from "mongoose";

// Per-client login credentials for the Flashfire Autopilot desktop app, so
// operators never type passwords: the app pulls these and performs the
// JobRight login and the extension-panel login by itself.
//
//   jrEmail / jrPassword   - the client's jobright.ai account. jrPassword
//                            defaults to the standard team password; a
//                            client whose account differs just stores theirs.
//   extEmail / extPassword - the client's FlashFire dashboard login (what the
//                            extension panel's sign-in form takes)
//   extCode                - the 5-digit operator code the panel asks for
//   maxJobs                - LEGACY, no longer read or written. It used to be
//                            a second cap living beside the real one, so the
//                            autopilot could show "cap 30" while /addjob was
//                            really allowing 23 - a run would open a browser,
//                            log in and be refused on its third push. The one
//                            cap that counts is ProfileModel.targetJobCount:
//                            per day, shared by manual operator pushes and the
//                            autopilot, resetting at 22:00 IST. Controllers/
//                            AutopilotCreds.js reads and writes that instead.
//                            Left on the schema so existing documents still
//                            load; delete once no old build is in service.
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
    jrPassword: { type: String, default: "Jobhunt@2026" },
    extEmail: { type: String, default: "" },
    extPassword: { type: String, default: "" },
    extCode: { type: String, default: "" },
    maxJobs: { type: Number, default: 30, min: 1, max: 30 }, // legacy, unread
    updatedBy: { type: String, default: "" }
  },
  { timestamps: true, collection: "autopilotcreds" }
);

export const AutopilotCreds = mongoose.model("AutopilotCreds", AutopilotCredsSchema);
