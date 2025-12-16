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

        // Remove the assignment
        user.assignedResumeId = null;
        await user.save();

        // Note: Ideally we should also call the Resume API to clear the userEmail from the resume document
        // similar to how AssignResumeToUser does it. However, since the primary view for management 
        // is the dashboard which relies on UserModel, this is sufficient for the immediate requirement.

        res.json({
            success: true,
            message: "Resume unassigned successfully"
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
