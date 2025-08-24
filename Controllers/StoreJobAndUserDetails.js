import { JobModel } from "../Schema_Models/JobModel.js";
import { UserModel } from "../Schema_Models/UserModel.js";

export default async function StoreJobAndUserDetails(req, res) {
  try {
    const b = req.body || {};

    // Helper to pick the first present, non-empty value
    const pick = (obj, keys, fallback = "") => {
      for (const k of keys) {
        const v = obj?.[k];
        if (v !== undefined && v !== null && String(v).trim() !== "") return String(v);
      }
      return fallback;
    };

    // --- Normalize ALL the fields you use ---
    const jobTitle = pick(b, ["Title", "job_title", "jobTitle", "position", "name"], "Untitled Job");

    const companyName = pick(b, [
      "Company Name",
      "company_name",
      "companyName",
      "employer",
      "organization",
      "org"
    ]);

    const joblink = pick(b, [
      "Apply Url",
      "Job Url",
      "job_url",
      "jobUrl",
      "url",
      "job_posting_url",
      "link"
    ]);

    const publishedAt = pick(b, [
      "Published at",
      "published_at",
      "listed_at",
      "date_posted",
      "posted_at"
    ]);

    const employmentType = pick(b, ["Employment Type", "employment_type"]);
    const jobFunctions   = pick(b, ["Job Functions", "job_functions"]);
    const industries     = pick(b, ["Industries", "industry", "industries"]);
    const description    = pick(b, ["Description", "description"]);
    const requirements   = pick(b, ["REQUIREMENTS AND QUALIFICATIONS", "requirements"]);
    const salary         = pick(b, ["Salary", "salary", "compensation"]);

    // --- Validate requireds BEFORE hitting Mongoose ---
    const missing = [];
    if (!companyName) missing.push("companyName");
    if (!joblink)     missing.push("joblink");
    if (missing.length) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields",
        missing,
        gotKeys: Object.keys(b)
      });
    }

    const when = publishedAt ? new Date(publishedAt) : new Date();

    const payload = {
      dateAdded: when,
      createdAt: when,         // keep if your schema doesn’t have timestamps
      userID: b.userID || null,
      jobTitle,
      jobDescription: JSON.stringify({
        employmentType,
        jobFunctions,
        industries,
        description,
        requirements,
        salary
      }),
      joblink,
      companyName
    };

    // --- De-dupe check uses the normalized values ---
    const existance = await JobModel.findOne({
      jobTitle,
      userID: payload.userID,
      companyName,
      joblink
    });

    if (existance) {
      return res.status(200).json({ success: true, skipped: true, reason: "duplicate" });
    }

    await JobModel.create(payload);
    return res.status(201).json({ success: true, created: true });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: error?.message || String(error) });
  }
}
