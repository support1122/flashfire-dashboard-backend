// controllers/StoreJobAndUserDetails.js
import { JobModel } from "../Schema_Models/JobModel.js";

export default async function StoreJobAndUserDetails(req, res) {
    try {
        const b = req.body || {};

        // --- STEP 1: LOG THE INCOMING REQUEST BODY ---
        console.log("------------------------------------------");
        console.log("✅ Received request on /storejobanduserdetails");
        // console.log("Request body:", b);
        console.log("------------------------------------------");

        // helper: return { value, key } for the first non-empty key found
        const pickKey = (obj, keys, fallback = "") => {
            for (const k of keys) {
                if (Object.prototype.hasOwnProperty.call(obj, k)) {
                    const v = obj[k];
                    if (v !== undefined && v !== null && String(v).trim() !== "") {
                        return { value: String(v), key: k };
                    }
                }
            }
            return { value: String(fallback), key: null };
        };

        // ---- normalize core fields (accept multiple header variants) ----
        // Updated to specifically look for the keys from your Apps Script payload
        const { value: userID } = pickKey(b, ["userID", "mappedEmail", "_editedBy"], "unknown@flashfirejobs.com");
        const { value: jobTitle } = pickKey(b, ["title"], "Untitled Job");
        const { value: companyName } = pickKey(b, ["companyName"], "unknown");
        const { value: joblink } = pickKey(b, ["applyUrl", "url"], "www.google.com");

        // --- FIX: Explicitly get the description from the request body ---
        const { value: jobDescriptionHtml } = pickKey(b, ["descriptionHtml"]);

        // --- STEP 2: LOG THE NORMALIZED VALUES ---
        // console.log("Normalized Values:");
        // console.log("userID:", userID);
        // console.log("jobTitle:", jobTitle);
        // console.log("companyName:", companyName);
        // console.log("joblink:", joblink);
        // console.log("jobDescription:", jobDescription); // <-- Log the new description value

        const existing = await JobModel.findOne({
            $or: [
                { userID, joblink },
            ]
        });
        if (existing) {
            console.log(`❌ Duplicate job found for user ${userID}. Skipping save.`);
            return res.status(200).json({ success: true, skipped: true, reason: "duplicate" });
        }

        const payload = {
            dateAdded: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
            createdAt: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
            userID,
            jobTitle,
            joblink,
            companyName,
            currentStatus: "saved",
            jobDescription: jobDescriptionHtml, // <-- Use the correctly picked description value
            timeline: ["Added"],
            attachments: []
        };

        // --- STEP 3: LOG THE FINAL PAYLOAD BEFORE CREATING THE DOCUMENT ---
        console.log("Final payload for MongoDB:", payload);

        await JobModel.create(payload);

        console.log("✅ Successfully saved job for user:", userID);
        return res.status(200).json({ success: true, message: "Job saved successfully" });

    } catch (error) {
        console.error("❌ Error in StoreJobAndUserDetails:", error);
        return res.status(500).json({ success: false, message: error.message, error_details: error.stack });
    }
}


export async function saveToDashboard(req, res) {
    try {
        const {
            company,
            description,
            position,
            selectedEmails,
            url
        } = req.body;

        // --- Input Validation (no changes here) ---
        if (!selectedEmails || !Array.isArray(selectedEmails) || selectedEmails.length === 0) {
            return res.status(400).json({
                success: false,
                message: "The 'selectedEmails' field is required and must be a non-empty array."
            });
        }
        if (!position || !company || !url) {
            return res.status(400).json({
                success: false,
                message: "Missing required job details: 'position', 'company', and 'url' are required."
            });
        }

        const summary = {
            saved: 0,
            skippedAsDuplicate: 0,
            failedWithError: 0,
            details: []
        };

        for (const email of selectedEmails) {
            const userEmail = email.trim();
            try {
                const existingJob = await JobModel.findOne({
                    userID: userEmail,
                    joblink: url,
                    jobTitle: position,
                    companyName: company
                });

                if (existingJob) {
                    // If a specific duplicate is found, log it and update the summary.
                    console.log(`⏩ Duplicate job found for user ${userEmail} (Same URL, Title, and Company). Skipping.`);
                    summary.skippedAsDuplicate++;
                    summary.details.push({
                        user: userEmail,
                        status: 'skipped_duplicate',
                        reason: 'An identical job (same URL, title, and company) already exists for this user.'
                    });
                    continue;
                }

                const payload = {
                    dateAdded: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
                    createdAt: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
                    userID: userEmail,
                    jobTitle: position,
                    joblink: url,
                    companyName: company,
                    currentStatus: "saved",
                    jobDescription: description || "",
                    timeline: ["Added"],
                    attachments: []
                };

                const newJob = await JobModel.create(payload);
                summary.saved++;
                summary.details.push({
                    user: userEmail,
                    status: 'saved',
                    jobId: newJob._id
                });

            } catch (error) {
                summary.failedWithError++;
                summary.details.push({
                    user: userEmail,
                    status: 'failed',
                    reason: error.message || 'An unknown error occurred.'
                });
                console.error(`❌ Failed to save job for ${userEmail}:`, error);
            }
        }

        console.log(`✅ Job saving process complete. Saved: ${summary.saved}, Skipped: ${summary.skippedAsDuplicate}, Failed: ${summary.failedWithError}`);

        return res.status(200).json({
            success: true,
            message: "Job saving process completed.",
            summary
        });

    } catch (error) {
        console.error("❌ Unhandled error in saveToDashboard controller:", error);
        return res.status(500).json({
            success: false,
            message: "An internal server error occurred.",
            errorDetails: error.message
        });
    }
}
