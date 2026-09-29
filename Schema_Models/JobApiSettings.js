import mongoose from "mongoose";

// Per-client search settings for the job-API sources (Adzuna today).
//
// The autopilot's "Scrape from Job APIs" mode shows the same client list as
// the portal mode, and each row's pencil opens these fields. They are saved
// here so the next run just needs the button: the operator sets a client's
// search up once.
//
// WHY THIS IS NOT ON AutopilotCreds
// AutopilotCreds holds secrets (JobRight and panel logins) and is read by the
// desktop app over an ops-key gated route. These are not secrets - they are a
// saved search - and the API run happens on the SERVER, not in the browser.
// Keeping them apart means the settings can be read by the UI without the
// credential store being involved at all.
//
// The Adzuna account itself is FlashFire's, one for the whole company, so its
// app_id/app_key live in the backend environment - never per client and never
// in this document.
const JobApiSettingsSchema = new mongoose.Schema(
  {
    clientEmail: { type: String, required: true, lowercase: true, trim: true, index: true },
    // Which API these settings are for. One document per client per provider,
    // so adding a second provider later does not disturb Adzuna.
    provider: { type: String, required: true, default: "adzuna", enum: ["adzuna"] },

    enabled: { type: Boolean, default: true },

    // ---- the search itself -------------------------------------------
    // Every field maps to a real Adzuna query parameter, verified against
    // their live API on 2026-09-29. Blank means "do not send it", which is
    // not the same as sending an empty value - Adzuna treats an empty
    // `what` as a match-nothing rather than a match-everything.
    country: { type: String, default: "au", lowercase: true, trim: true },  // ISO code in the path
    what: { type: String, default: "" },            // keywords, any of them
    whatPhrase: { type: String, default: "" },      // exact phrase
    whatExclude: { type: String, default: "" },     // keywords to exclude
    titleOnly: { type: String, default: "" },       // keywords, title field only
    where: { type: String, default: "" },           // place name or postcode
    distance: { type: Number, default: null },      // km from `where`
    category: { type: String, default: "" },        // Adzuna category tag
    salaryMin: { type: Number, default: null },
    salaryMax: { type: Number, default: null },
    // Adzuna sends these as the string "1" when on, and omits them when off.
    fullTime: { type: Boolean, default: false },
    partTime: { type: Boolean, default: false },
    permanent: { type: Boolean, default: false },
    contract: { type: Boolean, default: false },
    sortBy: { type: String, default: "date" },      // date | relevance | salary
    // How far back to look. 1 = the last 24 hours, which is the default
    // because a client should see today's jobs, not last month's. Measured
    // live: "nurse" in AU returns 17,758 all-time against 807 at one day.
    maxDaysOld: { type: Number, default: 1 },

    // ---- run limits ---------------------------------------------------
    // Adzuna caps results_per_page at 50 (measured: asking 100 fails, 50
    // returns 50). maxPages bounds one run; the client's own daily cap
    // normally stops it long before this does.
    resultsPerPage: { type: Number, default: 50, min: 1, max: 50 },
    maxPages: { type: Number, default: 5, min: 1, max: 20 },

    updatedBy: { type: String, default: "" },
    lastRunAt: { type: Date },
  },
  { timestamps: true, collection: "jobapisettings" },
);

JobApiSettingsSchema.index({ clientEmail: 1, provider: 1 }, { unique: true });

export const JobApiSettings = mongoose.model("JobApiSettings", JobApiSettingsSchema);
