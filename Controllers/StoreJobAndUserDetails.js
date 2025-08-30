// // controllers/StoreJobAndUserDetails.js
// import { JobModel } from "../Schema_Models/JobModel.js";

// export default async function StoreJobAndUserDetails(req, res) {
//   try {
//     const b = req.body || {};

//     // helper: return { value, key } for the first non-empty key found
//     const pickKey = (obj, keys, fallback = "") => {
//       for (const k of keys) {
//         if (Object.prototype.hasOwnProperty.call(obj, k)) {
//           const v = obj[k];
//           if (v !== undefined && v !== null && String(v).trim() !== "") {
//             return { value: String(v), key: k };
//           }
//         }
//       }
//       return { value: String(fallback), key: null };
//     };

//     // ---- normalize core fields (accept multiple header variants) ----
//     const { value: userID, key: userKey } = pickKey(b, ["userID", "mappedEmail", "_editedBy"], "unknown@flashfirejobs.com");
//     const { value: jobTitle, key: titleKey } = pickKey(b, ["Title","job_title","jobTitle","position","name"], "Untitled Job");
//     const { value: companyName, key: compKey } = pickKey(b, ["Company Name","company_name","companyName","employer","organization"]);
//     const { value: joblink, key: linkKey } = pickKey(b, ["Apply Url","Job Url","job_url","jobUrl","url","job_posting_url","link"]);

//     if (!companyName || !joblink) {
//       return res.status(400).json({
//         success: false,
//         message: "Missing required fields",
//         missing: [
//           !companyName ? "companyName" : null,
//           !joblink ? "joblink" : null
//         ].filter(Boolean),
//         gotKeys: Object.keys(b)
//       });
//     }

//     const { value: publishedAt, key: pubKey } = pickKey(b, ["Published at","published_at","listed_at","date_posted","posted_at"]);
//     const when = publishedAt ? new Date(publishedAt) : new Date();

//     // ---- build extras = everything except the core keys & obvious metadata ----
//     const excludeKeys = new Set([
//       userKey, titleKey, compKey, linkKey, pubKey,
//       "userID", "mappedEmail", "_editedBy", "_editedAt", "_rowNumber", "_sheet",
//       // add any others you don't want mirrored into extras
//     ].filter(Boolean));

//     const extras = {};
//     for (const [k, v] of Object.entries(b)) {
//       if (excludeKeys.has(k)) continue;
//       // keep all fields as-is; if value is object/array it will be preserved by JSON.stringify below
//       extras[k] = v;
//     }

//     // If for some reason extras is empty, keep at least a minimal wrapper
//     const jobDescriptionStr = JSON.stringify(extras && Object.keys(extras).length ? extras : { note: "no extra fields" });

//     // ---- de-dupe (prefer strong key: userID + joblink) ----
//     const existing = await JobModel.findOne({
//       $or: [
//         { userID, joblink },
//         { userID, jobTitle, companyName }
//       ]
//     });
//     if (existing) {
//       return res.status(200).json({ success: true, skipped: true, reason: "duplicate" });
//     }

//     // ---- payload for your current schema (jobDescription is String) ----
//     const payload = {
//       dateAdded: when.toISOString(),
//       createdAt: when.toISOString(),
//       userID,
//       jobTitle,
//       joblink,
//       companyName,
//       currentStatus: "saved",
//       jobDescription: jobDescriptionStr, // <-- ALL other fields as a single string
//       timeline: ["Added"],
//       attachments: []
//     };

//     await JobModel.create(payload);
//     return res.status(201).json({ success: true, created: true });
//   } catch (error) {
//     console.error(error);
//     return res.status(500).json({ success: false, message: error?.message || String(error) });
//   }
// }

// controllers/StoreJobAndUserDetails.js
import { JobModel } from "../Schema_Models/JobModel.js";

/**
 * Normalize object keys:
 * - lowercase
 * - trim
 * - replace spaces/dashes with underscores
 */
function normalizeKeys(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    const nk = String(k)
      .trim()
      .toLowerCase()
      .replace(/[\s\-]+/g, "_");
    out[nk] = v;
  }
  return out;
}

/** Return first non-empty value from a set of possible keys (after normalization). */
function pickFirst(obj, aliases, fallback = "") {
  for (const key of aliases) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const v = obj[key];
      if (v !== undefined && v !== null && String(v).trim() !== "") {
        return { value: String(v), key };
      }
    }
  }
  return { value: String(fallback), key: null };
}

export default async function StoreJobAndUserDetails(req, res) {
  try {
    // Payload expected from Apps Script:
    // {
    //   sheetId, sheetName, rowIndex,
    //   headers: [...], row: {headerName: value, ...},
    //   userID, source
    // }
    const b = req.body || {};
    const rowRaw = b.row || {};
    const row = normalizeKeys(rowRaw);     // <-- robust to source differences
    const bodyNorm = normalizeKeys(b);     // also normalize top-level for fallbacks

    // ---- Alias lists for core fields (broad to handle Indeed/LinkedIn/Glassdoor) ----
    const USER_ALIASES = ["userid", "owneremail", "mappedemail", "_editedby"];
    const TITLE_ALIASES = ["title", "job_title", "jobtitle", "position", "name", "role"];
    const COMPANY_ALIASES = [
      "company_name", "company", "companyname", "employer", "organization", "hiring_company"
    ];
    const LINK_ALIASES = [
      "apply_url", "job_url", "joburl", "url", "job_posting_url", "link", "apply_link"
    ];
    // controllers/StoreJobAndUserDetails.js

// ...
const PUBLISHED_ALIASES = [
  "published_at",
  "listed_at",
  "date_posted",
  "job_posted_date",   // 👈 add this
  "posted_at",
  "date",
  "created_at",
];
// ...

    const STATUS_ALIASES = ["status", "currentstatus"];

    // NOTE: We also keep the original `userID` sent by Apps Script as a hard fallback
    const { value: userID, key: userKey } = pickFirst(
      row,
      USER_ALIASES,
      b.userID || "unknown@flashfirejobs.com"
    );
    const { value: jobTitle, key: titleKey } = pickFirst(
      row,
      TITLE_ALIASES,
      "Untitled Job"
    );
    const { value: companyName, key: compKey } = pickFirst(
      row,
      COMPANY_ALIASES,
      ""
    );
    const { value: joblink, key: linkKey } = pickFirst(
      row,
      LINK_ALIASES,
      ""
    );
    const { value: publishedAt, key: pubKey } = pickFirst(
      row,
      PUBLISHED_ALIASES,
      ""
    );
    const { value: statusVal } = pickFirst(
      row,
      STATUS_ALIASES,
      "saved"
    );

    if (!companyName || !joblink) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields",
        missing: [
          !companyName ? "companyName" : null,
          !joblink ? "joblink" : null,
        ].filter(Boolean),
        gotKeys: Object.keys(rowRaw),
      });
    }

    // Parse date (best effort)
    const when = publishedAt ? new Date(publishedAt) : new Date();

    // ---- Build extras = everything except core keys + checkbox + boilerplate ----
    const exclude = new Set(
      [
        userKey,
        titleKey,
        compKey,
        linkKey,
        pubKey,
        "done",              // checkbox column
        "userid",            // already captured from aliases
        "owneremail",
        "mappedemail",
        "_editedby",
        "_editedat",
        "_rownumber",
        "_sheet",
      ].filter(Boolean)
    );

    const extras = {};
    for (const [k, v] of Object.entries(row)) {
      if (exclude.has(k)) continue;
      extras[k] = v;
    }

    const jobDescriptionStr = JSON.stringify(
      Object.keys(extras).length ? extras : { note: "no extra fields" }
    );

    // ---- De-dup: prefer (userID + joblink), fallback (userID + jobTitle + companyName)
    const existing = await JobModel.findOne({
      $or: [{ userID, joblink }, { userID, jobTitle, companyName }],
    });

    if (existing) {
      // Optional: update status/timeline if they tick again
      existing.currentStatus = statusVal || existing.currentStatus || "saved";
      if (!Array.isArray(existing.timeline)) existing.timeline = [];
      existing.timeline.push("Ticked");
      existing.updatedAt = new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
      await existing.save();
      return res.status(200).json({ success: true, skipped: true, reason: "duplicate-updated" });
    }

    // ---- Create new record (matches your schema types) ----
    const nowIso = when.toISOString();
    const payload = {
      dateAdded: nowIso,
      createdAt: nowIso,
      updatedAt: new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }),
      userID,
      jobTitle,
      joblink,
      companyName,
      currentStatus: statusVal || "saved",
      jobDescription: jobDescriptionStr,
      timeline: ["Added"],
      attachments: [],
      // (jobID default comes from schema)
    };

    await JobModel.create(payload);
    return res.status(201).json({ success: true, created: true });
  } catch (error) {
    console.error("StoreJobAndUserDetails error:", error);
    return res.status(500).json({ success: false, message: error?.message || String(error) });
  }
}

