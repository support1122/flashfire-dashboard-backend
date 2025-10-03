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
      const current = await JobModel.findOne({ jobID, userID: userEmail });

      const baseStatus = String(req.body?.status || "").trim();
      const alreadyAttributed = /\sby\s/i.test(baseStatus);
      const actorName = req.body?.role === 'operations' ? (userDetails?.name || 'operations') : 'user';
      const statusToSet = alreadyAttributed || baseStatus === ''
        ? baseStatus
        : `${baseStatus} by ${actorName}`;

      await JobModel.findOneAndUpdate(
        { jobID, userID: userEmail },
        {
          $set: {
            currentStatus: statusToSet,
            updatedAt: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
          },
          $push: { timeline: statusToSet },
        },
        { new: true, upsert: false }
      );
      // Only send Discord notification when moving TO an important status
      const importantStatuses = ['saved', 'applied', 'interviewing', 'offer', 'rejected', 'deleted'];
      const isImportantChange = importantStatuses.some(status => 
        statusToSet.toLowerCase().includes(status)
      );
      
      if (isImportantChange) {
        const discordMessage =
    `📌 Job Update:
    Client: ${userDetails.name}
     Company: ${current?.companyName}
     Job Title: ${current?.jobTitle}
     Status: ${statusToSet}
     Previous: ${current?.currentStatus}`; 
        await DiscordConnect(process.env.DISCORD_APPLICATION_TRACKING_CHANNEL,discordMessage);
      }
      
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
  const nextStatus = opsName
    ? `${baseNextStatus} by ${opsName}`
    : (existing.currentStatus === "saved" ? "applied by user" : baseNextStatus);

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

  // Send Discord notification if status changed to an important status
  const importantStatuses = ['saved', 'applied', 'interviewing', 'offer', 'rejected', 'deleted'];
  const isImportantChange = importantStatuses.some(status => 
    nextStatus.toLowerCase().includes(status)
  );
  
  if (isImportantChange && existing.currentStatus !== nextStatus) {
    // Get the actual client's name from the job record, not the operations user
    let clientName = userDetails.name;
    
    if (req.body?.role === "operations") {
      // For operations users, get the client's name from the job's userID (client email)
      const { UserModel } = await import("../Schema_Models/UserModel.js");
      const clientUser = await UserModel.findOne({ email: userEmail }).select('name');
      clientName = clientUser?.name || userEmail;
    }
    
    const discordMessage =
      `📌 Job Update:
      Client: ${clientName}
       Company: ${updated.companyName}
       Job Title: ${updated.jobTitle}
       Status: ${nextStatus}
       Previous: ${existing.currentStatus}`;
    await DiscordConnect(process.env.DISCORD_APPLICATION_TRACKING_CHANNEL, discordMessage);
  }
}

    else if (action === "delete") {
      await JobModel.findOneAndDelete({ jobID, userID: userEmail });
    }

    const updatedJobs = await JobModel.find({ userID: userEmail }).sort({ createdAt: -1 });
    return res.status(200).json({ message: "Jobs updated successfully", updatedJobs });
  } catch (error) {
    console.error("UpdateChanges error:", error);
    return res.status(500).json({ message: "Server error", error: String(error) });
  }
}

