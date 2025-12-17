import { UserModel } from "../../Schema_Models/UserModel.js";

export default async function UnassignResume(req, res) {
    try {
        const { userEmail } = req.body;

        if (!userEmail) {
            return res.status(400).json({ error: "User email is required" });
        }

        const user = await UserModel.findOne({ email: userEmail });

        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }

        const previousResumeId = user.assignedResumeId || null;

        user.assignedResumeId = null;
        await user.save();

        if (previousResumeId) {
            const resumeApiUrl = process.env.RESUME_API_URL || "http://localhost:5000";
            try {
                const updateRes = await fetch(`${resumeApiUrl}/api/update-resume-user-email`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ resumeId: previousResumeId, userEmail: null })
                });
                if (!updateRes.ok) {
                    console.error("Failed to clear ResumeIndex userEmail during unassign");
                }
            } catch (err) {
                console.error("Error clearing ResumeIndex userEmail during unassign:", err);
            }
        }

        res.json({
            success: true,
            message: "Resume unassigned successfully",
            previousResumeId
        });

    } catch (error) {
        console.error("Error unassigning resume:", error);
        res.status(500).json({
            success: false,
            message: "Failed to unassign resume",
            error: error.message
        });
    }
}
