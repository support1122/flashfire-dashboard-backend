import mongoose from "mongoose";
import { JobModel } from "../Schema_Models/JobModel.js";

export default async function Get24HourJobs(req, res) {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({
        success: false,
        message: "Database connection unavailable",
      });
    }

    const emailRaw = req.query?.email || req.body?.email || "";
    const email = String(emailRaw).trim().toLowerCase();
    if (!email) {
      return res.status(400).json({
        success: false,
        message: "email query param required",
      });
    }

    const hoursParam = parseInt(req.query?.hours || "24", 10);
    const hours = Number.isFinite(hoursParam) && hoursParam > 0 ? hoursParam : 24;

    const sinceMs = Date.now() - hours * 60 * 60 * 1000;
    const sinceObjectId = mongoose.Types.ObjectId.createFromTime(
      Math.floor(sinceMs / 1000)
    );

    const jobs = await JobModel.find({
      userID: email,
      _id: { $gte: sinceObjectId },
    })
      .select("companyName joblink jobTitle createdAt _id")
      .sort({ _id: -1 })
      .lean();

    const rows = jobs.map((j) => ({
      companyName: j.companyName || "",
      url: j.joblink || "",
      position: j.jobTitle || "",
      createdAt: j.createdAt || "",
    }));

    return res.status(200).json({
      success: true,
      email,
      hours,
      count: rows.length,
      jobs: rows,
    });
  } catch (err) {
    console.error("Get24HourJobs error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch jobs",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
}
