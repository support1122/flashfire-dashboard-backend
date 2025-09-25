// controllers/UpdateChanges.js
import { JobModel } from "../Schema_Models/JobModel.js";
import { DiscordConnect } from "../Utils/DiscordConnect.js";

export default async function UpdateChanges(req, res) {
  const { jobID, userDetails, action } = req.body;
  const userEmail = userDetails?.email;

  if (!jobID || !userEmail) {
    return res.status(400).json({ message: "jobID and userDetails.email are required" });
  }

  try {
    if (action === "UpdateStatus") {
      let currentStatus = await JobModel.findOne({ jobID, userID: userEmail });

      await JobModel.findOneAndUpdate(
        { jobID, userID: userEmail },
        {
          $set: {
            currentStatus: req.body?.status,
            updatedAt: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
          },
          $push: { timeline: req.body?.status },
        },
        { new: true, upsert: false }
      );
      const discordMessage =
  `📌 Job Update:
  Client: ${userDetails.name}
   Company: ${currentStatus.companyName}
   Job Title: ${currentStatus.jobTitle}
   Status: ${req.body?.status}
   Previous: ${currentStatus.currentStatus}`; 
      if(req.body.status !== 'deleted')await DiscordConnect(process.env.DISCORD_APPLICATION_TRACKING_CHANNEL,discordMessage);
      
  }
    

  else if (action === "edit") {
  const userEmail = userDetails?.email;

  // Accept single string or array and normalize
  const raw =
    req.body?.attachmentUrls ??
    req.body?.attachmentUrl ??
    req.body?.urls ??
    [];
  const attachmentUrls = (Array.isArray(raw) ? raw : [raw]).filter(Boolean);

  if (!jobID || !userEmail) {
    return res.status(400).json({ message: "jobID and userDetails.email are required" });
  }
  if (!attachmentUrls.length) {
    return res.status(400).json({ message: "No attachment URLs provided" });
  }

  // Fetch current status to decide whether to flip "saved" -> "applied"
  const existing = await JobModel.findOne(
    { jobID, userID: userEmail },
    { currentStatus: 1 }
  ).lean();

  if (!existing) {
    return res.status(404).json({ message: "Job not found for this user" });
  }
  const baseNextStatus = existing.currentStatus === "saved" ? "applied" : existing.currentStatus;
  const opsName = req.body?.role === "operations" ? (req.body?.userDetails?.name || null) : null;
  const nextStatus = opsName ? `${baseNextStatus} by ${opsName}` : baseNextStatus;

  const update = {
    $set: {
      updatedAt: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
      currentStatus: nextStatus,
    },
    $addToSet: { attachments: { $each: attachmentUrls }, timeline: nextStatus },
  };

  const updated = await JobModel.findOneAndUpdate(
    { jobID, userID: userEmail },
    update,
    { new: true, upsert: false }
  );

  if (!updated) {
    return res.status(404).json({ message: "Job not found for this user" });
  }
}

    else if (action === "delete") {
      await JobModel.findOneAndDelete({ jobID, userID: userEmail });
    }

    // Filter out any timeline entries like "saved by ..." from the response only
    const updatedJobs = await JobModel.find({ userID: userEmail })
      .sort({ createdAt: -1 })
      .lean();
    const sanitizedJobs = updatedJobs.map((job) => {
      const copy = { ...job };
      if (Array.isArray(copy.timeline)) {
        copy.timeline = copy.timeline.filter(
          (t) => !(typeof t === "string" && t.toLowerCase().startsWith("saved by"))
        );
      }
      return copy;
    });
    return res.status(200).json({ message: "Jobs updated successfully", updatedJobs: sanitizedJobs });
  } catch (error) {
    console.error("UpdateChanges error:", error);
    return res.status(500).json({ message: "Server error", error: String(error) });
  }
}
