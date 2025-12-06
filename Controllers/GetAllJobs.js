import { JobModel } from "../Schema_Models/JobModel.js";
import { UserModel } from "../Schema_Models/UserModel.js";
import mongoose from "mongoose";

export default async function GetAllJobs(req, res) {
    try {
        // Check MongoDB connection status before proceeding
        if (mongoose.connection.readyState !== 1) {
            console.error("GetAllJobs error: MongoDB not connected. State:", mongoose.connection.readyState);
            return res.status(503).json({ 
                message: "Database connection unavailable. Please try again in a moment.",
                error: "Service temporarily unavailable"
            });
        }

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

        // Sort by updatedAt desc (most recently updated first) so moved jobs stay at top
        let cursor = JobModel.find(query)
            .select(projection)
            .sort({ updatedAt: -1, _id: -1 })
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
        
        // Handle specific MongoDB errors
        if (error.name === 'MongoNetworkTimeoutError' || error.name === 'MongoServerSelectionError') {
            return res.status(503).json({ 
                message: "Database connection timeout. Please try again in a moment.",
                error: "Service temporarily unavailable"
            });
        }
        
        if (error.name === 'MongoNetworkError') {
            return res.status(503).json({ 
                message: "Database network error. Please try again in a moment.",
                error: "Service temporarily unavailable"
            });
        }
        
        // Generic error response
        res.status(500).json({ 
            message: "Failed to fetch jobs",
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}