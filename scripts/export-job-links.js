// Exports up to 50 saved job links from the JobDB collection into links.md.
//
// Usage (from the backend root):
//   node scripts/export-job-links.js            # newest 50 with a non-empty joblink
//   LIMIT=100 node scripts/export-job-links.js  # override the count
//
// Reads MONGODB_URI from .env (same connection the API uses). Read-only.

import mongoose from "mongoose";
import dotenv from "dotenv";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { JobModel } from "../Schema_Models/JobModel.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LIMIT = Number(process.env.LIMIT) || 50;
const OUT_FILE = path.resolve(__dirname, "..", "links.md");

async function main() {
  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI is not set (check .env).");
  }

  await mongoose.connect(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 10000,
    maxPoolSize: 5,
  });
  console.log("Connected to MongoDB.");

  // Newest first, only rows that actually carry a link.
  const jobs = await JobModel.find({
    joblink: { $exists: true, $nin: [null, ""] },
  })
    .sort({ _id: -1 })
    .limit(LIMIT)
    .select("joblink jobTitle companyName currentStatus dateAdded")
    .lean();

  console.log(`Fetched ${jobs.length} job(s) with a link.`);

  const lines = [
    `# Job Links (${jobs.length})`,
    "",
    `Exported ${new Date().toISOString()} from JobDB — newest first.`,
    "",
    ...jobs.map((j, i) => {
      const label =
        [j.jobTitle, j.companyName].filter(Boolean).join(" @ ") || "job";
      return `${i + 1}. [${label}](${j.joblink})`;
    }),
    "",
  ];

  await writeFile(OUT_FILE, lines.join("\n"), "utf8");
  console.log(`Wrote ${jobs.length} link(s) to ${OUT_FILE}`);
}

main()
  .catch((err) => {
    console.error("Export failed:", err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
