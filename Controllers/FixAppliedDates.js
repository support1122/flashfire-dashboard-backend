import { JobModel } from "../Schema_Models/JobModel.js";

/**
 * Parses a locale date string stored in the DB (handles both en-IN DD/MM/YYYY
 * and en-US MM/DD/YYYY formats) and returns a Date object in IST.
 * Returns null if unparseable.
 */
function parseStoredDate(dateString) {
    if (!dateString || typeof dateString !== "string") return null;

    try {
        // ISO format
        if (/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(dateString)) {
            const d = new Date(dateString);
            return isNaN(d.getTime()) ? null : d;
        }

        const parts = dateString.trim().split(",");
        if (parts.length !== 2) return null;

        const datePart = parts[0].trim();
        const timePart = parts[1].trim();
        const dateNumbers = datePart.split("/").map(p => parseInt(p.trim(), 10));
        if (dateNumbers.length !== 3 || dateNumbers.some(isNaN)) return null;

        let dd, mm, yyyy;
        if (dateNumbers[0] > 12) {
            // First number > 12 → must be DD/MM/YYYY (en-IN)
            dd = dateNumbers[0];
            mm = dateNumbers[1];
            yyyy = dateNumbers[2];
        } else {
            // Ambiguous or MM/DD/YYYY (en-US): treat as MM/DD/YYYY to match backend logic
            // For jobs where day <= 12, en-US interpretation is used (consistent with backend sort)
            mm = dateNumbers[0];
            dd = dateNumbers[1];
            yyyy = dateNumbers[2];
        }

        if (yyyy < 100) yyyy += 2000;
        if (!dd || !mm || !yyyy || mm > 12 || dd > 31) return null;

        const timeMatch = timePart.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)/i);
        let hour = 0, minute = 0, second = 0;
        if (timeMatch) {
            hour = parseInt(timeMatch[1], 10);
            minute = parseInt(timeMatch[2], 10);
            second = timeMatch[3] ? parseInt(timeMatch[3], 10) : 0;
            const mer = (timeMatch[4] || "").toLowerCase();
            if (mer === "pm" && hour !== 12) hour += 12;
            if (mer === "am" && hour === 12) hour = 0;
        }

        // IST = UTC+05:30
        const istOffsetMs = 330 * 60 * 1000;
        const utcMs = Date.UTC(yyyy, mm - 1, dd, hour, minute, second) - istOffsetMs;
        const d = new Date(utcMs);
        return isNaN(d.getTime()) ? null : d;
    } catch {
        return null;
    }
}

/**
 * Format a Date as en-IN locale string in IST (matching how the rest of the system stores dates).
 */
function toISTLocaleString(date) {
    return date.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
}

/**
 * POST /fix/applied
 *
 * One-time data fix: for jobs that are in "applied" status and were added in
 * February or March 2026, sets appliedDate = dateAdded + 1 day.
 *
 * This corrects records where appliedDate was previously set to an attachment
 * upload time (making old jobs appear at the top of the Applied column).
 *
 * Returns { fixed: N, skipped: N, errors: N, details: [...] }
 */
export const fixAppliedDates = async (req, res) => {
    try {
        // Fetch all "applied" jobs (status can be "applied", "applied by operations", etc.)
        const allAppliedJobs = await JobModel.find({
            currentStatus: { $regex: /applied/i }
        })
            .select("jobID userID jobTitle companyName dateAdded createdAt appliedDate currentStatus")
            .lean();

        let fixed = 0;
        let skipped = 0;
        let errors = 0;
        const details = [];

        const bulkOps = [];

        for (const job of allAppliedJobs) {
            const rawDate = job.dateAdded || job.createdAt;
            const addedDate = parseStoredDate(rawDate);

            if (!addedDate) {
                errors++;
                details.push({ jobID: job.jobID, reason: "unparseable dateAdded", raw: rawDate });
                continue;
            }

            const month = addedDate.getMonth() + 1; // 1-indexed
            const year = addedDate.getFullYear();

            // Only fix jobs added in Feb (2) or March (3) 2026
            if (!(year === 2026 && (month === 2 || month === 3))) {
                skipped++;
                continue;
            }

            // appliedDate = dateAdded + 1 day
            const appliedDateMs = addedDate.getTime() + 24 * 60 * 60 * 1000;
            const newAppliedDate = toISTLocaleString(new Date(appliedDateMs));

            bulkOps.push({
                updateOne: {
                    filter: { jobID: job.jobID, userID: job.userID },
                    update: { $set: { appliedDate: newAppliedDate } }
                }
            });

            fixed++;
            details.push({
                jobID: job.jobID,
                userID: job.userID,
                jobTitle: job.jobTitle,
                companyName: job.companyName,
                oldAppliedDate: job.appliedDate || null,
                newAppliedDate,
                dateAdded: rawDate
            });
        }

        if (bulkOps.length > 0) {
            await JobModel.bulkWrite(bulkOps);
        }

        return res.status(200).json({
            success: true,
            fixed,
            skipped,
            errors,
            details
        });
    } catch (err) {
        console.error("fixAppliedDates error:", err);
        return res.status(500).json({ success: false, error: err.message });
    }
};
