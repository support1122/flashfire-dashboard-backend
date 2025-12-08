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
            .lean({ virtuals: false, getters: false });

        if (limit > 0) {
            cursor = cursor.skip(skip).limit(limit);
        }

        const allJobsRaw = await cursor;
        
        const parseDateAdded = (dateString) => {
            if (!dateString) return 0;
            try {
                if (/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(dateString)) {
                    return new Date(dateString).getTime();
                }
                
                const parts = dateString.trim().split(",");
                if (parts.length === 2) {
                    const datePart = parts[0].trim();
                    const timePart = parts[1].trim();
                    const dateNumbers = datePart.split("/").map(p => parseInt(p.trim()));
                    
                    if (dateNumbers.length === 3) {
                        let mm, dd, yyyy;
                        
                        if (dateNumbers[0] > 12) {
                            // DD/MM/YYYY format (createdAt)
                            dd = dateNumbers[0];
                            mm = dateNumbers[1];
                            yyyy = dateNumbers[2];
                        } else {
                            // MM/DD/YYYY format (dateAdded)
                            mm = dateNumbers[0];
                            dd = dateNumbers[1];
                            yyyy = dateNumbers[2];
                        }
                        
                        if (dd && mm && yyyy) {
                            if (yyyy < 100) yyyy += 2000;
                            
                            const timeMatch = timePart.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)/i);
                            if (timeMatch) {
                                let hour = parseInt(timeMatch[1]);
                                const minute = parseInt(timeMatch[2]);
                                const second = timeMatch[3] ? parseInt(timeMatch[3]) : 0;
                                const meridian = (timeMatch[4] || "").toLowerCase();
                                
                                if (!isNaN(hour) && !isNaN(minute)) {
                                    // Convert to 24-hour format
                                    if (meridian === "pm" && hour !== 12) hour += 12;
                                    if (meridian === "am" && hour === 12) hour = 0;
                                    
                                    // IST offset is +05:30 => 330 minutes
                                    const istOffsetMinutes = 330;
                                    const utcMs = Date.UTC(yyyy, mm - 1, dd, hour, minute, second) - istOffsetMinutes * 60 * 1000;
                                    const d = new Date(utcMs);
                                    if (!isNaN(d.getTime())) {
                                        return d.getTime();
                                    }
                                }
                            }
                        }
                    }
                }
                
               const native = new Date(dateString);
                if (!isNaN(native.getTime())) return native.getTime();
            } catch (error) {
                console.warn("Failed to parse dateAdded:", dateString, error);
            }
            return 0;
        };
        
        const allJobsSorted = allJobsRaw.sort((a, b) => {
            const timeA = parseDateAdded(a.dateAdded || a.createdAt);
            const timeB = parseDateAdded(b.dateAdded || b.createdAt);
            if (timeB !== timeA) return timeB - timeA;
            return b._id.toString().localeCompare(a._id.toString());
        });
        
        const allJobs = allJobsSorted.map(job => ({ ...job, _id: job._id.toString() }));

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