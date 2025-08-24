// controllers/StoreJobAndUserDetails.js
import { JobModel } from "../Schema_Models/JobModel.js";

export default async function StoreJobAndUserDetails(req, res) {
  try {
    const b = req.body || {};

    // Helpers
    const pick = (obj, keys, fallback = "") => {
      for (const k of keys) {
        const v = obj?.[k];
        if (v !== undefined && v !== null && String(v).trim() !== "") return String(v);
      }
      return fallback;
    };
    const toBullets = (val) => {
      if (Array.isArray(val)) return val.map(x => String(x).trim()).filter(Boolean);
      const text = String(val || "").replace(/\r/g, "").trim();
      if (!text) return [];
      return text
        .split(/\n+/)
        .map(line => line.replace(/^[\s\-–—•●*]+/, "").trim())
        .filter(Boolean);
    };

    // Core fields (normalize multiple possible keys)
    const userID  = pick(b, ["userID", "mappedEmail", "_editedBy"], "unknown@flashfirejobs.com");
    const jobTitle = pick(b, ["Title","job_title","jobTitle","position","name"], "Untitled Job");
    const companyName = pick(b, ["Company Name","company_name","companyName","employer","organization"], "");
    const joblink = pick(b, ["Apply Url","Job Url","job_url","jobUrl","url","job_posting_url","link"], "");

    if (!companyName || !joblink) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields",
        missing: [
          !companyName ? "companyName" : null,
          !joblink ? "joblink" : null
        ].filter(Boolean),
        gotKeys: Object.keys(b)
      });
    }

    // Dates
    const publishedAt = pick(b, ["Published at","published_at","listed_at","date_posted","posted_at"], "");
    const when = publishedAt ? new Date(publishedAt) : new Date();

    // Meta
    const employmentType = pick(b, ["Employment Type","employment_type","type"]);
    const jobFunctions   = pick(b, ["Job Functions","job_functions"]);
    const industries     = pick(b, ["Industries","industry","industries"]);
    const salary         = pick(b, ["Salary","salary","compensation","pay_range"]);
    const seniority      = pick(b, ["seniority","seniority_level","experience_level"]);
    const location       = pick(b, ["Location","job_location","location","city","region"]);
    const workplace      = pick(b, ["workplace_type","on_site_remote","remote_type"]);

    // Text sections
    const descMain = pick(b, ["Description","description","job_description","details","about_job"]);
    const descMore = pick(b, ["show_more_description","full_description"]);
    const responsibilities = toBullets(b["responsibilities"] || b["job_responsibilities"] || b["description_bullets"] || b["job_description_bullets"]);
    const requirements     = toBullets(b["REQUIREMENTS AND QUALIFICATIONS"] || b["requirements"] || b["job_requirements"] || b["qualifications"] || b["basic_qualifications"] || b["preferred_qualifications"]);
    const skills           = toBullets(b["skills"] || b["skills_required"] || b["tech_stack"]);
    const benefits         = toBullets(b["benefits"] || b["perks_benefits"] || b["perks"]);

    const applyAlt   = pick(b, ["apply_url","application_link"]);
    const companyUrl = pick(b, ["company_url","company_website","company_site"]);

    // Build rich object for jobDescription
    const jobDescriptionObj = {
      summary: descMain || "",
      more: descMore || "",
      responsibilities,
      requirements,
      skills,
      benefits,
      meta: {
        employmentType,
        jobFunctions,
        industries,
        salary,
        seniority,
        location,
        workplace
      },
      links: {
        job: joblink,
        apply: applyAlt || joblink,
        company: companyUrl || ""
      },
      source: { observedKeys: Object.keys(b) }
    };

    // De-dupe (primary: userID + joblink; secondary: title+company)
    const existing = await JobModel.findOne({
      $or: [
        { userID, joblink },
        { userID, jobTitle, companyName }
      ]
    });

    if (existing) {
      return res.status(200).json({ success: true, skipped: true, reason: "duplicate" });
    }

    // Build payload based on your schema (string or object, see Section 2)
    const payload = {
      userID,
      jobTitle,
      joblink,
      companyName,
      // If your schema keeps a string:
      jobDescription: JSON.stringify(jobDescriptionObj),
      // If you migrate schema to Mixed/Object: jobDescription: jobDescriptionObj,
      currentStatus: "saved",
      dateAdded: when.toISOString(),
      createdAt: when.toISOString(),
      timeline: ["Added"],
      attachments: []
    };

    await JobModel.create(payload);
    return res.status(201).json({ success: true, created: true });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: error?.message || String(error) });
  }
}
