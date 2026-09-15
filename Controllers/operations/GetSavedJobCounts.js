import { JobModel } from "../../Schema_Models/JobModel.js";

export default async function GetSavedJobCounts(req, res) {
    try {
        const emails = Array.isArray(req.body?.emails) ? req.body.emails : [];
        const userIDs = emails
            .map((email) => (email || '').toLowerCase())
            .filter(Boolean);

        if (userIDs.length === 0) {
            return res.status(200).json({ message: 'saved job counts', counts: {} });
        }

        const results = await JobModel.aggregate([
            { $match: { userID: { $in: userIDs }, currentStatus: 'saved' } },
            { $group: { _id: '$userID', count: { $sum: 1 } } },
        ]);

        const counts = Object.fromEntries(userIDs.map((id) => [id, 0]));
        results.forEach((r) => {
            counts[r._id] = r.count;
        });

        res.status(200).json({ message: 'saved job counts', counts });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: "Failed to fetch saved job counts" });
    }
}
