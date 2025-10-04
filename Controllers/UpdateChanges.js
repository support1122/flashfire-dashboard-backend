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

      // Check if operations user is moving job from saved to applied
      let updateFields = {
        currentStatus: statusToSet,
        updatedAt: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
      };

      // Track operations when moving from saved to applied
      if (req.body?.role === "operations" && current?.currentStatus === "saved" && statusToSet.includes("applied")) {
        console.log("🔄 Operations tracking triggered - UpdateStatus action");
        console.log("📊 Operations user:", req.body?.operationsName || userDetails?.name || 'operations');
        console.log("Operations email:", req.body?.operationsEmail || 'operations@flashfirehq');
        
        // Set operatorName and operatorEmail to operations user details
        updateFields.operatorName = req.body?.operationsName || userDetails?.name || 'operations';
        updateFields.operatorEmail = req.body?.operationsEmail || 'operations@flashfirehq';
      } else if (req.body?.role !== "operations") {
        // If not operations user, set to 'user'
        updateFields.operatorName = 'user';
        updateFields.operatorEmail = 'user@flashfirehq';
      }

      await JobModel.findOneAndUpdate(
        { jobID, userID: userEmail },
        {
          $set: updateFields,
          $push: { timeline: statusToSet },
        },
        { new: true, upsert: false }
      );
      const discordMessage =
  `📌 Job Update:
  Client: ${userDetails.name}
   Company: ${current?.companyName}
   Job Title: ${current?.jobTitle}
   Status: ${statusToSet}
   Previous: ${current?.currentStatus}`; 
      if(baseStatus !== 'deleted') await DiscordConnect(process.env.DISCORD_APPLICATION_TRACKING_CHANNEL,discordMessage);
      
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

  // Check if operations user is moving job from saved to applied
  let updateFields = {
    updatedAt: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
    currentStatus: nextStatus,
  };

  // Track operations when moving from saved to applied
  if (req.body?.role === "operations" && existing.currentStatus === "saved" && nextStatus.includes("applied")) {
    console.log("🔄 Operations tracking triggered - edit action");
    console.log("📊 Operations user:", req.body?.operationsName || userDetails?.name || 'operations');
    console.log("📧 Operations email:", req.body?.operationsEmail || 'operations@flashfirehq');
    
    // Set operatorName and operatorEmail to operations user details
    updateFields.operatorName = req.body?.operationsName || userDetails?.name || 'operations';
    updateFields.operatorEmail = req.body?.operationsEmail || 'operations@flashfirehq';
  } else if (req.body?.role !== "operations") {
    // If not operations user, set to 'user'
    updateFields.operatorName = 'user';
    updateFields.operatorEmail = 'user@flashfirehq';
  }

  const update = {
    $set: updateFields,
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

    const updatedJobs = await JobModel.find({ userID: userEmail }).sort({ createdAt: -1 });
    return res.status(200).json({ message: "Jobs updated successfully", updatedJobs });
  } catch (error) {
    console.error("UpdateChanges error:", error);
    return res.status(500).json({ message: "Server error", error: String(error) });
  }
}

