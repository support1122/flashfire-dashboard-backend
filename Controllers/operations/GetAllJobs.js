import { JobModel } from "../../Schema_Models/JobModel.js";

export default async function GetAllJobsOPS(req,res) {
    let {email}= req.body;
    try {
        email = (email || '').toLowerCase();

        // Optional pagination
        const page = Math.max(parseInt(req.query?.page || req.body?.page || '1', 10), 1);
        const limit = Math.max(parseInt(req.query?.limit || req.body?.limit || '0', 10), 0);
        const skip = limit > 0 ? (page - 1) * limit : 0;

        const query = { userID: email };
        const projection = '-jobDescription -optimizedResume.resumeData';

        let cursor = JobModel.find(query)
            .select(projection)
            .sort({ _id: -1 })
            // .hint({ userID: 1, _id: -1 })
            .lean({ virtuals: false, getters: false });

        if (limit > 0) {
            cursor = cursor.skip(skip).limit(limit);
        }

        const allJobsRaw = await cursor;
        const allJobs = allJobsRaw.map(job => ({ ...job, _id: job._id.toString() }));
        
        res.status(200).json({
            message : 'all Jobs List',
            allJobs ,
        });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: "Failed to fetch jobs" });
    }
}