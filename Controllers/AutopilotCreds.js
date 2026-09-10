import mongoose from "mongoose";
import { AutopilotCreds } from "../Schema_Models/AutopilotCreds.js";
import { ProfileModel } from "../Schema_Models/ProfileModel.js";
import { JobModel } from "../Schema_Models/JobModel.js";
import { checkCap, DEFAULT_DAILY_CAP, startOfTodayIST } from "../Utils/dailyCapGuard.js";

// Standard JobRight password for client accounts; a stored per-client
// password always wins over it.
const DEFAULT_JR_PASSWORD = "Jobhunt@2026";

// Autopilot credential store - see Schema_Models/AutopilotCreds.js for what
// lives here and why it is plaintext. Every route below is mounted behind
// requireOpsKey (x-ops-key header); the list route still never returns secrets.
//
// THE CAP.
// There is exactly one cap that matters and it is ProfileModel.targetJobCount:
// the per-day limit /addjob enforces, shared by manual operator pushes and the
// autopilot alike, resetting at 22:00 IST. AutopilotCreds.maxJobs used to hold
// a second, separate number, which meant the autopilot could show "cap 30"
// while the server was really allowing 23 - and a run would open a browser,
// log in and immediately be refused. That field is now legacy: never read,
// never written. Read and write the real one here instead.
//
// The upper bound is deliberately generous (matching /update-target-jobs)
// because live data already has clients at 40 and 80. Clamping to 30 here
// would silently misreport their cap.
const MAX_DAILY_CAP = 10000;

// GET /autopilot/creds - which clients have credentials on file (no secrets),
// each with its live daily-cap picture.
//
// The autopilot shows a "cap 21/23" chip on every row of its roster. Calling
// checkCap() per client would be ~300 round trips on every refresh, so the
// same arithmetic is done here in two queries: one for the caps, one grouped
// count of today's operator pushes. The per-client GET below still uses
// checkCap() directly, so the number a run actually acts on always comes from
// the function /addjob itself gates on.
export const listAutopilotCreds = async (_req, res) => {
  try {
    const docs = await AutopilotCreds.find({}).select("clientEmail updatedAt").lean();
    const emails = docs.map((d) => d.clientEmail).filter(Boolean);

    const capByEmail = new Map();
    const usedByEmail = new Map();
    if (emails.length) {
      const [profiles, counts] = await Promise.all([
        ProfileModel.find({ email: { $in: emails } }, { email: 1, targetJobCount: 1 }).lean(),
        (async () => {
          // Mirrors dailyCapGuard.countOpsToday: operator-created jobs in the
          // current window, excluding removed ones (a removal frees its slot).
          const since = startOfTodayIST();
          const hex = Math.floor(since.getTime() / 1000).toString(16).padStart(8, "0") + "0000000000000000";
          return JobModel.aggregate([
            {
              $match: {
                userID: { $in: emails },
                createdByRole: "operations",
                _id: { $gte: new mongoose.Types.ObjectId(hex) },
                $or: [
                  { currentStatus: { $exists: false } },
                  { currentStatus: null },
                  { currentStatus: { $not: /^(deleted|removed)/i } }
                ]
              }
            },
            { $group: { _id: "$userID", n: { $sum: 1 } } }
          ]);
        })()
      ]);
      for (const p of profiles) {
        const raw = Number(p.targetJobCount);
        capByEmail.set(p.email, Number.isFinite(raw) && raw > 0 ? raw : null);
      }
      for (const c of counts) usedByEmail.set(c._id, c.n);
    }

    res.status(200).json({
      success: true,
      count: docs.length,
      data: docs.map((d) => {
        const explicit = capByEmail.get(d.clientEmail) ?? null;
        const dailyCap = explicit ?? DEFAULT_DAILY_CAP;
        const usedToday = usedByEmail.get(d.clientEmail) || 0;
        return {
          clientEmail: d.clientEmail,
          updatedAt: d.updatedAt,
          dailyCap,
          usedToday,
          remaining: Math.max(0, dailyCap - usedToday),
          capIsDefault: explicit == null
        };
      })
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /autopilot/creds/:email - full record for one client (the app uses it
// to run the JobRight + panel logins) plus the live daily-cap picture.
export const getAutopilotCreds = async (req, res) => {
  try {
    const email = String(req.params.email || "").toLowerCase().trim();
    if (!email.includes("@")) return res.status(400).json({ success: false, message: "bad email" });
    const doc = await AutopilotCreds.findOne({ clientEmail: email }).lean();
    if (!doc) return res.status(404).json({ success: false, message: "no credentials on file" });

    // checkCap is the same function /addjob gates on, so these numbers cannot
    // drift from what the server will actually allow. If it throws (DB
    // trouble) report the default rather than failing the whole credential
    // fetch - the autopilot can still log in, and the server still enforces
    // the real cap on every push.
    let cap = { cap: DEFAULT_DAILY_CAP, count: 0, remaining: DEFAULT_DAILY_CAP, isDefault: true };
    try {
      cap = await checkCap(email);
    } catch (e) {
      console.warn(`getAutopilotCreds: cap lookup failed for ${email}: ${e.message}`);
    }

    res.status(200).json({
      success: true,
      data: {
        clientEmail: doc.clientEmail,
        jrEmail: doc.jrEmail || "",
        jrPassword: doc.jrPassword || DEFAULT_JR_PASSWORD,
        extEmail: doc.extEmail || "",
        extPassword: doc.extPassword || "",
        extCode: doc.extCode || "",

        // The real per-day cap and where the client stands against it today.
        dailyCap: cap.cap,
        usedToday: cap.count,
        remaining: cap.remaining,
        capIsDefault: cap.isDefault,
        windowResetsAt: "22:00 Asia/Kolkata",

        // Legacy alias. An autopilot that has not been upgraded reads maxJobs
        // as its run target, and "how many this client may still receive
        // today" is exactly the right number for that - so an old build gets
        // safer behaviour from this change, not broken behaviour.
        maxJobs: cap.remaining
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// PUT /autopilot/creds/:email - upsert. Only provided fields are changed, so
// an operator can update just the JobRight password without retyping the rest.
//
// maxJobs / dailyCap here writes ProfileModel.targetJobCount - the same field
// the dashboard's own admin tab edits - so changing the cap from the autopilot
// changes it everywhere at once.
export const putAutopilotCreds = async (req, res) => {
  try {
    const email = String(req.params.email || "").toLowerCase().trim();
    if (!email.includes("@")) return res.status(400).json({ success: false, message: "bad email" });
    const allowed = ["jrEmail", "jrPassword", "extEmail", "extPassword", "extCode", "updatedBy"];
    const set = {};
    for (const k of allowed) {
      if (typeof req.body?.[k] === "string") set[k] = req.body[k].trim();
    }

    // dailyCap is the name that means what it does; maxJobs is accepted so an
    // older autopilot build can still save. Numeric, so it cannot ride the
    // string loop above - and an empty string must leave the stored value
    // alone rather than reset it.
    const rawCap = req.body?.dailyCap !== undefined ? req.body.dailyCap : req.body?.maxJobs;
    let capWritten = null;
    if (rawCap !== undefined && rawCap !== "" && rawCap !== null) {
      // Number(), not parseInt(): parseInt("2.5") is 2, silently accepting a
      // fractional cap as though the operator had asked for 2.
      const n = typeof rawCap === "number" ? rawCap : Number(String(rawCap).trim());
      if (!Number.isInteger(n) || n < 1 || n > MAX_DAILY_CAP) {
        return res.status(400).json({
          success: false,
          message: `daily cap must be a whole number between 1 and ${MAX_DAILY_CAP}`
        });
      }
      const profile = await ProfileModel.findOneAndUpdate(
        { email },
        { $set: { targetJobCount: n } },
        { new: true, lean: true, projection: { targetJobCount: 1 } }
      );
      if (!profile) {
        return res.status(404).json({
          success: false,
          message: `no dashboard profile for ${email} - the cap lives on the profile, so it cannot be set until one exists`
        });
      }
      capWritten = profile.targetJobCount;
    }

    if (Object.keys(set).length) {
      await AutopilotCreds.updateOne({ clientEmail: email }, { $set: set }, { upsert: true });
    } else if (capWritten === null) {
      return res.status(400).json({ success: false, message: "no credential fields in body" });
    }

    res.status(200).json({ success: true, dailyCap: capWritten });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
