// controllers/StoreJobAndUserDetails.js
import { JobModel } from "../Schema_Models/JobModel.js";

export default async function StoreJobAndUserDetails(req, res) {
  try {
    const b = req.body || {};

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
    const { value: userID, key: userKey } = pickKey(b, ["userID", "mappedEmail", "_editedBy"], "unknown@flashfirejobs.com");
    const { value: jobTitle, key: titleKey } = pickKey(b, ["Title","job_title","jobTitle","position","name"], "Untitled Job");
    const { value: companyName, key: compKey } = pickKey(b, ["Company Name","company_name","companyName","employer","organization"]);
    const { value: joblink, key: linkKey } = pickKey(b, ["Apply Url","Job Url","job_url","jobUrl","url","job_posting_url","link"]);

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

    const { value: publishedAt, key: pubKey } = pickKey(b, ["Published at","published_at","listed_at","date_posted","posted_at"]);
    const when = publishedAt ? new Date(publishedAt) : new Date();

    // ---- build extras = everything except the core keys & obvious metadata ----
    const excludeKeys = new Set([
      userKey, titleKey, compKey, linkKey, pubKey,
      "userID", "mappedEmail", "_editedBy", "_editedAt", "_rowNumber", "_sheet",
      // add any others you don't want mirrored into extras
    ].filter(Boolean));

    const extras = {};
    for (const [k, v] of Object.entries(b)) {
      if (excludeKeys.has(k)) continue;
      // keep all fields as-is; if value is object/array it will be preserved by JSON.stringify below
      extras[k] = v;
    }

    // If for some reason extras is empty, keep at least a minimal wrapper
    const jobDescriptionStr = JSON.stringify(extras && Object.keys(extras).length ? extras : { note: "no extra fields" });

    // ---- de-dupe (prefer strong key: userID + joblink) ----
    const existing = await JobModel.findOne({
      $or: [
        { userID, joblink },
        { userID, jobTitle, companyName }
      ]
    });
    if (existing) {
      return res.status(200).json({ success: true, skipped: true, reason: "duplicate" });
    }

    // ---- payload for your current schema (jobDescription is String) ----
    const payload = {
      dateAdded: when.toISOString(),
      createdAt: when.toISOString(),
      userID,
      jobTitle,
      joblink,
      companyName,
      currentStatus: "saved",
      jobDescription: jobDescriptionStr, // <-- ALL other fields as a single string
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
