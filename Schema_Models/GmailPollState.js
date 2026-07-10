import mongoose from "mongoose";

// Per-mailbox cursor + health for the hourly mail-poll worker.
//
// One doc per connected Gmail account (GmailUser.email). Holds:
//   • where the last poll stopped, so we only ask Gmail for new mail
//   • the running "this client got this many" counter shown in Discord
//   • auth-failure state + alert throttle, so a revoked token pings Discord
//     once every ALERT_THROTTLE window instead of once per tick
const GmailPollStateSchema = new mongoose.Schema(
  {
    ownerEmail: { type: String, required: true, lowercase: true, index: true },
    gmailEmail: { type: String, required: true, lowercase: true, unique: true },

    // Cursor. lastInternalDate is the Gmail internalDate (ms epoch) of the
    // newest message we have already processed. The next poll asks Gmail for
    // `after:<lastInternalDate seconds>`; Mongo's unique index on MailDigest
    // is the real dedupe guard, since Gmail's `after:` is second-granular.
    lastInternalDate: { type: Number, default: 0 },
    lastPolledAt: { type: Date, default: null },
    lastSuccessAt: { type: Date, default: null },

    // Lifetime count of mails we have summarized + pushed to Discord.
    totalNotified: { type: Number, default: 0 },

    // Auth health. authErrorAt is set when Gmail rejects our refresh token
    // (invalid_grant, revoked, insufficient scope). Cleared on the next
    // successful poll. lastAuthAlertAt throttles the Discord ping.
    authErrorAt: { type: Date, default: null },
    authErrorMessage: { type: String, default: "" },
    lastAuthAlertAt: { type: Date, default: null },

    // Non-auth failures (network, 5xx). Purely diagnostic.
    consecutiveFailures: { type: Number, default: 0 },
    lastErrorMessage: { type: String, default: "" }
  },
  { timestamps: true }
);

export const GmailPollState = mongoose.model("GmailPollState", GmailPollStateSchema);
