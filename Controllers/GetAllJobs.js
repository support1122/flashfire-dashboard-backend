import { JobModel } from "../Schema_Models/JobModel.js";
import { UserModel } from "../Schema_Models/UserModel.js";

export default async function GetAllJobs(req, res) {
    try {
        const userEmail = (req.body?.email || req.body?.userDetails?.email || req.email || '').toLowerCase();

        if (!userEmail) {
            return res.status(400).json({ message: "User email not found" });
        }

        // Optional pagination (defaults preserve old behavior if not provided)
        const page = Math.max(parseInt(req.query?.page || req.body?.page || '1', 10), 1);
        const limit = Math.max(parseInt(req.query?.limit || req.body?.limit || '0', 10), 0); // 0 means no limit
        const skip = limit > 0 ? (page - 1) * limit : 0;

        // Fields: exclude heavy payloads explicitly
        const query = { userID: userEmail };
        const projection = '-jobDescription -optimizedResume.resumeData';

        // Use index with hint and sort by _id desc (recent first)
        let cursor = JobModel.find(query)
            .select(projection)
            .sort({ _id: -1 })
            .hint({ userID: 1, _id: -1 })
            .lean({ virtuals: false, getters: false });

        if (limit > 0) {
            cursor = cursor.skip(skip).limit(limit);
        }

        const allJobsRaw = await cursor;
        const allJobs = allJobsRaw.map(job => ({ ...job, _id: job._id.toString() }));

        res.status(200).json({
            message: 'All Jobs List',
            allJobs,
            count: allJobs.length,
            userEmail
        });
    } catch (error) {
        console.error("GetAllJobs error:", error);
        res.status(500).json({ message: "Failed to fetch jobs" });
    }
}