/**
 * One-time migration: set skipThreshold = true for all RecruiterEmailAutomation
 * docs that currently have skipThreshold = false (or the field absent).
 *
 * These are the ~40+ users who have never sent a single recruiter email because
 * the 200-application pipeline threshold gate was silently blocking them.
 *
 * Run once:
 *   NODE_ENV=production node migrations/fix-recruiter-skip-threshold.js
 */

import dotenv from "dotenv";
import mongoose from "mongoose";
import connectDB from "../Utils/ConnectDB.js";
import { RecruiterEmailAutomation } from "../Schema_Models/RecruiterEmailAutomation.js";

dotenv.config();

(async () => {
  try {
    await connectDB();
    console.log("✅ DB connected");

    // Find all docs where skipThreshold is false or missing
    const stuck = await RecruiterEmailAutomation.find({
      $or: [{ skipThreshold: false }, { skipThreshold: { $exists: false } }]
    }).select("ownerEmail enabled dailyLimit lastRunAt sentTo skipThreshold");

    console.log(`\nFound ${stuck.length} automation(s) with skipThreshold=false:\n`);
    stuck.forEach(a => {
      const neverSent = !a.lastRunAt;
      console.log(`  ${a.ownerEmail} | enabled:${a.enabled} | sentToCount:${a.sentTo?.length ?? 0} | lastRunAt:${a.lastRunAt ?? "NEVER"} ${neverSent ? "← BLOCKED" : ""}`);
    });

    if (!stuck.length) {
      console.log("Nothing to update.");
      process.exit(0);
    }

    const ids = stuck.map(a => a._id);
    const result = await RecruiterEmailAutomation.updateMany(
      { _id: { $in: ids } },
      { $set: { skipThreshold: true } }
    );

    console.log(`\n✅ Updated ${result.modifiedCount} documents — skipThreshold set to true.`);
    console.log("These users will now send recruiter emails at the next 11 PM IST cron run.\n");

    await mongoose.connection.close();
    process.exit(0);
  } catch (err) {
    console.error("Migration failed:", err);
    process.exit(1);
  }
})();
