// controllers/UpdateChanges.js
import { JobModel } from "../Schema_Models/JobModel.js";
import { UserModel } from "../Schema_Models/UserModel.js";
import { DiscordConnect } from "../Utils/DiscordConnect.js";

const REMOVAL_LIMIT = 100;
const OPERATIONS_EMAIL_DOMAIN = 'operations@flashfirehq';
const USER_EMAIL_DOMAIN = 'user@flashfirehq';
const TIMEZONE = 'Asia/Kolkata';
const IMPORTANT_STATUSES = ['saved', 'applied', 'interviewing', 'offer', 'rejected', 'deleted'];

const getCurrentISTTime = () => new Date().toLocaleString('en-IN', { timeZone: TIMEZONE });

const isOperationsUser = (role) => role === 'operations';

const shouldAttributeStatus = (baseStatus) => {
  return baseStatus !== '' && !/\sby\s/i.test(baseStatus);
};

const formatStatusWithAttribution = (baseStatus, actorName) => {
  if (!shouldAttributeStatus(baseStatus)) return baseStatus;
  return `${baseStatus} by ${actorName}`;
};

const getActorName = (role, userDetails, body) => {
  if (isOperationsUser(role)) {
    return body?.operationsName || userDetails?.name || 'operations';
  }
  return 'user';
};

const normalizeAttachmentUrls = (body) => {
  const raw = body?.attachmentUrls ?? body?.attachmentUrl ?? body?.urls ?? [];
  return (Array.isArray(raw) ? raw : [raw]).filter(Boolean);
};

const validateRequiredFields = (jobID, userEmail) => {
  if (!jobID || !userEmail) {
    throw { status: 400, message: "jobID and userDetails.email are required" };
  }
};

const validateAttachmentUrls = (urls) => {
  if (!urls.length) {
    throw { status: 400, message: "No attachment URLs provided" };
  }
};

const isRemovalStatus = (status) => {
  if (!status) return false;
  const s = String(status).toLowerCase().trim();
  return s.startsWith('deleted') || s.startsWith('removed');
};

const checkRemovalLimit = async (userEmail, status, role) => {
  if (isRemovalStatus(status) && !isOperationsUser(role)) {
    const user = await UserModel.findOne({ email: userEmail }).select('removedJobsCount').lean();
    if (user && user.removedJobsCount >= REMOVAL_LIMIT) {
      throw {
        status: 400,
        message: "Removal limit exceeded",
        error: `You have reached the maximum limit of ${REMOVAL_LIMIT} job removals. Please contact support if you need to remove more jobs.`
      };
    }
    return user;
  }
  return null;
};

const buildOperatorFields = (role, body, userDetails) => {
  const fields = {};

  if (isOperationsUser(role)) {
    fields.operatorName = body?.operationsName || userDetails?.name || 'operations';
    fields.operatorEmail = body?.operationsEmail || OPERATIONS_EMAIL_DOMAIN;
  } else {
    fields.operatorName = 'user';
    fields.operatorEmail = USER_EMAIL_DOMAIN;
  }

  return fields;
};

const shouldSetAppliedDate = (currentStatus, newStatus) => {
  return currentStatus === "saved" &&
    (newStatus.includes("applied") || newStatus === "applied");
};

const incrementRemovalCount = async (userEmail, status, role) => {
  if (isRemovalStatus(status) && !isOperationsUser(role)) {
    return UserModel.findOneAndUpdate(
      { email: userEmail },
      { $inc: { removedJobsCount: 1 } },
      { new: true }
    ).lean();
  }
  return Promise.resolve(null);
};

const buildDiscordMessage = (clientName, job, newStatus, oldStatus) => {
  return `📌 Job Update:
  Client: ${clientName}
  Company: ${job?.companyName || 'N/A'}
  Job Title: ${job?.jobTitle || 'N/A'}
  Status: ${newStatus}
  Previous: ${oldStatus}`;
};

const sendDiscordNotification = async (userDetails, job, newStatus, oldStatus, role, userEmail) => {
  try {
    // Don't send notification for deleted status
    if (isRemovalStatus(newStatus)) return;

    let clientName = userDetails.name;

    // For operations users, fetch the actual client name (with timeout)
    if (isOperationsUser(role)) {
      try {
        const clientUser = await Promise.race([
          UserModel.findOne({ email: userEmail }).select('name').lean(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 500))
        ]);
        clientName = clientUser?.name || userEmail;
      } catch (err) {
        // If fetch fails or times out, use email as fallback
        clientName = userEmail;
      }
    }

    const discordMessage = buildDiscordMessage(clientName, job, newStatus, oldStatus);
    await Promise.race([
      DiscordConnect(process.env.DISCORD_APPLICATION_TRACKING_CHANNEL, discordMessage),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Discord timeout')), 2000))
    ]);
  } catch (error) {
    // Silently fail - don't block the main request
    console.error('Discord notification failed (non-blocking):', error.message);
  }
};

// Action Handlers
const handleUpdateStatus = async (req, res, jobID, userEmail, userDetails) => {
  const { status: baseStatus = '', role, removalReason } = req.body;
  const trimmedStatus = String(baseStatus).trim();

  // Parallelize validation and job fetch
  const [_, currentJob] = await Promise.all([
    checkRemovalLimit(userEmail, trimmedStatus, role),
    JobModel.findOne({ jobID, userID: userEmail })
      .select('currentStatus companyName jobTitle')
      .lean()
  ]);

  if (!currentJob) {
    throw { status: 404, message: "Job not found for this user" };
  }

  const actorName = getActorName(role, userDetails, req.body);
  const statusToSet = formatStatusWithAttribution(trimmedStatus, actorName);

  // Build update fields
  const updateFields = {
    currentStatus: statusToSet,
    updatedAt: getCurrentISTTime(),
    ...buildOperatorFields(role, req.body, userDetails)
  };

  // Set appliedDate if transitioning from saved to applied
  if (shouldSetAppliedDate(currentJob.currentStatus, statusToSet)) {
    updateFields.appliedDate = getCurrentISTTime();
  }

  // Save removal reason if job is being moved to deleted
  if (isRemovalStatus(trimmedStatus) && removalReason) {
    const removedByName = isOperationsUser(role) 
      ? (req.body?.operationsName  || 'operations')
      : 'user';
    updateFields.removalReason = removalReason;
    updateFields.removalDate = getCurrentISTTime();
    updateFields.removedBy = removedByName;
  }

  // Update job and increment removal count in parallel (if needed)
  const updatePromise = JobModel.findOneAndUpdate(
    { jobID, userID: userEmail },
    {
      $set: updateFields,
      $push: { timeline: statusToSet }
    },
    { new: true }
  ).lean();

  const incrementPromise = incrementRemovalCount(userEmail, trimmedStatus, role);

  await Promise.all([updatePromise, incrementPromise]);

  // Send Discord notification asynchronously (non-blocking)
  sendDiscordNotification(
    userDetails,
    currentJob,
    statusToSet,
    currentJob.currentStatus,
    role,
    userEmail
  ).catch(err => console.error('Discord notification error (non-blocking):', err));
};

const handleEdit = async (req, res, jobID, userEmail, userDetails) => {
  const { role, status } = req.body;
  const attachmentUrls = normalizeAttachmentUrls(req.body);

  // Validate inputs
  validateAttachmentUrls(attachmentUrls);

  // Parallelize removal check and job fetch
  const [_, existingJob] = await Promise.all([
    checkRemovalLimit(userEmail, status, role),
    JobModel.findOne({ jobID, userID: userEmail })
      .select('currentStatus companyName jobTitle')
      .lean()
  ]);

  if (!existingJob) {
    throw { status: 404, message: "Job not found for this user" };
  }

  let nextStatus;
  
  if (status && status.trim() !== '') {
    const trimmedStatus = String(status).trim();
    const actorName = getActorName(role, userDetails, req.body);
    nextStatus = formatStatusWithAttribution(trimmedStatus, actorName);
  } else {
    nextStatus = existingJob.currentStatus;
  }

  // Build update fields
  const updateFields = {
    updatedAt: getCurrentISTTime(),
    currentStatus: nextStatus,
    ...buildOperatorFields(role, req.body, userDetails)
  };

  // Set appliedDate if transitioning from saved to applied
  if (shouldSetAppliedDate(existingJob.currentStatus, nextStatus)) {
    updateFields.appliedDate = getCurrentISTTime();
  }

  // Update job and increment removal count in parallel (if needed)
  const updatePromise = JobModel.findOneAndUpdate(
    { jobID, userID: userEmail },
    {
      $set: updateFields,
      $addToSet: {
        attachments: { $each: attachmentUrls },
        timeline: nextStatus
      }
    },
    { new: true }
  ).lean();

  const incrementPromise = incrementRemovalCount(userEmail, status, role);

  const [updatedJob] = await Promise.all([updatePromise, incrementPromise]);

  if (!updatedJob) {
    throw { status: 404, message: "Job not found for this user" };
  }

  // Send Discord notification asynchronously (non-blocking)
  const isImportantChange = IMPORTANT_STATUSES.some(s =>
    String(nextStatus).toLowerCase().includes(s)
  );

  if (isImportantChange && existingJob.currentStatus !== nextStatus) {
    sendDiscordNotification(
      userDetails,
      updatedJob,
      nextStatus,
      existingJob.currentStatus,
      role,
      userEmail
    ).catch(err => console.error('Discord notification error (non-blocking):', err));
  }
};

const handleDelete = async (req, res, jobID, userEmail) => {
  await JobModel.findOneAndDelete({ jobID, userID: userEmail }).lean();
};

// Main Controller
export default async function UpdateChanges(req, res) {
  const { jobID, userDetails, action, returnUpdatedJobs = true } = req.body;
  const userEmail = userDetails?.email;

  try {
    // Validate required fields
    validateRequiredFields(jobID, userEmail);

    // Route to appropriate handler
    switch (action) {
      case "UpdateStatus":
        await handleUpdateStatus(req, res, jobID, userEmail, userDetails);
        break;

      case "edit":
        await handleEdit(req, res, jobID, userEmail, userDetails);
        break;

      case "delete":
        await handleDelete(req, res, jobID, userEmail);
        break;

      default:
        throw { status: 400, message: "Invalid action specified" };
    }

    // Only fetch updated jobs if requested (optional optimization)
    // Use selective projection to reduce data transfer
    // Sort by updatedAt DESC so most recently moved jobs appear first
    const updatedJobs = returnUpdatedJobs !== false
      ? await JobModel.find({ userID: userEmail })
        .select('jobID jobTitle companyName currentStatus createdAt updatedAt joblink dateAdded appliedDate attachments')
        .sort({ updatedAt: -1 })
        .lean()
      : [];

    return res.status(200).json({
      message: "Jobs updated successfully",
      updatedJobs
    });

  } catch (error) {
    console.error("UpdateChanges error:", error);

    const status = error.status || 500;
    const message = error.message || "Server error";
    const errorDetail = error.error || String(error);

    return res.status(status).json({
      message,
      ...(error.error && { error: errorDetail })
    });
  }
}
