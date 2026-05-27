// GetBaseResumeData — POST /get-base-resume-data { email }
//
// Returns the user's BASE resume as structured JSON in the SAME shape the
// frontend's ResumePreview component already consumes for optimized
// resumes. Proxies to gemini-resume-latest-main's /api/resume-by-email
// (parsed JSON lives there; dashboard only stores the Cloudinary PDF link).
//
// Response (matches what fetchResumeDataFromJob expects):
//   { success: true,
//     resumeData: { personalInfo, workExperience, projects, leadership,
//                   skills, education, summary, publications, ... },
//     showSummary, showProjects, showLeadership, showPublications,
//     sectionOrder, version: 0, resumeId, V, firstName, lastName }
//
// Errors are mapped:
//   400 BAD_INPUT          — missing/invalid email
//   404 NO_RESUME          — gemini-resume has no parsed resume for this user
//                            (upload via gemini-resume first)
//   502 RESUME_API_DOWN    — upstream unreachable / 5xx
//   500 INTERNAL           — anything else

import axios from "axios";

const RESUME_API_URL = process.env.RESUME_API_URL || "http://localhost:5000";

export default async function GetBaseResumeData(req, res) {
    try {
        const email = (req.body?.email || "").toString().trim().toLowerCase();
        if (!email || !email.includes("@")) {
            return res.status(400).json({ success: false, error: "BAD_INPUT", message: "email is required" });
        }

        let upstream;
        try {
            upstream = await axios.post(
                `${RESUME_API_URL}/api/resume-by-email`,
                { email },
                { timeout: 15_000, headers: { "content-type": "application/json" } },
            );
        } catch (err) {
            const status = err.response?.status;
            if (status === 404) {
                return res.status(404).json({
                    success: false,
                    error: "NO_RESUME",
                    message: err.response?.data?.error || "No base resume parsed for this user yet.",
                });
            }
            return res.status(502).json({
                success: false,
                error: "RESUME_API_DOWN",
                message: err.response?.data?.error || err.message || "resume API unreachable",
                step: "fetch-resume-by-email",
            });
        }

        const u = upstream.data || {};
        // gemini-resume returns checkboxStates as { showSummary, showProjects,
        // showLeadership } — older docs may not have showPublications, default
        // to false to match optimized-resume conventions.
        const cb = u.checkboxStates || {};
        const sectionOrder = Array.isArray(u.sectionOrder) && u.sectionOrder.length
            ? u.sectionOrder
            : ["personalInfo", "summary", "workExperience", "projects", "leadership", "skills", "education", "publications"];

        // Strip the meta keys we promote to siblings so resumeData itself is
        // pure structured content. ResumePreview reads data.personalInfo
        // directly, etc.
        const {
            checkboxStates: _cb,
            sectionOrder: _so,
            V: _v,
            resumeId: _rid,
            firstName: _fn,
            lastName: _ln,
            ...resumeData
        } = u;

        return res.json({
            success: true,
            resumeData,
            showSummary: cb.showSummary !== false,
            showProjects: !!cb.showProjects,
            showLeadership: !!cb.showLeadership,
            showPublications: !!cb.showPublications,
            sectionOrder,
            version: 0,
            resumeId: u.resumeId || null,
            V: u.V ?? null,
            firstName: u.firstName || "",
            lastName: u.lastName || "",
        });
    } catch (err) {
        console.error("GetBaseResumeData fatal:", err);
        return res.status(500).json({ success: false, error: "INTERNAL", message: err.message });
    }
}
