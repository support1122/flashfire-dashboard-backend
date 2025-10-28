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

const getActorName = (role, userDetails) => {
  return isOperationsUser(role) ? (userDetails?.name || 'operations') : 'user';
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

const checkRemovalLimit = async (userEmail, status, role) => {
  if (status === "deleted" && !isOperationsUser(role)) {
    const user = await UserModel.findOne({ email: userEmail }).select('removedJobsCount').lean();
    if (user && user.removedJobsCount >= REMOVAL_LIMIT) {
      throw {
        status: 400,
        message: "Removal limit exceeded",
        error: `You have reached the maximum limit of ${REMOVAL_LIMIT} job removals. Please contact support if you need to remove more jobs.`
      };
    }
  }
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
  if (status === "deleted" && !isOperationsUser(role)) {
    await UserModel.findOneAndUpdate(
      { email: userEmail },
      { $inc: { removedJobsCount: 1 } },
      { new: true }
    ).lean();
  }
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
    if (newStatus.toLowerCase().includes('deleted')) return;

    let clientName = userDetails.name;
    
    // For operations users, fetch the actual client name
    if (isOperationsUser(role)) {
      const clientUser = await UserModel.findOne({ email: userEmail })
        .select('name')
        .lean();
      clientName = clientUser?.name || userEmail;
    }

    const discordMessage = buildDiscordMessage(clientName, job, newStatus, oldStatus);
    await DiscordConnect(process.env.DISCORD_APPLICATION_TRACKING_CHANNEL, discordMessage);
  } catch (error) {
    console.error('Discord notification failed:', error);
  }
};

// Action Handlers
const handleUpdateStatus = async (req, res, jobID, userEmail, userDetails) => {
  const { status: baseStatus = '', role } = req.body;
  const trimmedStatus = String(baseStatus).trim();

  // Validate removal limit before any database operations
  await checkRemovalLimit(userEmail, trimmedStatus, role);

  // Fetch current job
  const currentJob = await JobModel.findOne({ jobID, userID: userEmail })
    .select('currentStatus companyName jobTitle')
    .lean();

  if (!currentJob) {
    throw { status: 404, message: "Job not found for this user" };
  }

  const actorName = getActorName(role, userDetails);
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
    console.log('🔄 Operations tracking triggered - UpdateStatus action');
    console.log('📊 Operations user:', updateFields.operatorName);
    console.log('📧 Operations email:', updateFields.operatorEmail);
  }

  // Update job
  await JobModel.findOneAndUpdate(
    { jobID, userID: userEmail },
    {
      $set: updateFields,
      $push: { timeline: statusToSet }
    },
    { new: true }
  ).lean();

  // Increment removal count if applicable
  await incrementRemovalCount(userEmail, trimmedStatus, role);

  // Send Discord notification
  await sendDiscordNotification(
    userDetails,
    currentJob,
    statusToSet,
    currentJob.currentStatus,
    role,
    userEmail
  );
};

const handleEdit = async (req, res, jobID, userEmail, userDetails) => {
  const { role, status } = req.body;
  const attachmentUrls = normalizeAttachmentUrls(req.body);

  // Validate inputs
  validateAttachmentUrls(attachmentUrls);
  await checkRemovalLimit(userEmail, status, role);

  // Fetch existing job
  const existingJob = await JobModel.findOne({ jobID, userID: userEmail })
    .select('currentStatus companyName jobTitle')
    .lean();

  if (!existingJob) {
    throw { status: 404, message: "Job not found for this user" };
  }

  // Determine next status
  const baseNextStatus = existingJob.currentStatus === "saved" 
    ? "applied" 
    : existingJob.currentStatus;
  
  const opsName = isOperationsUser(role) ? (userDetails?.name || null) : null;
  const nextStatus = opsName
    ? `${baseNextStatus} by ${opsName}`
    : (existingJob.currentStatus === "saved" ? "applied by user" : baseNextStatus);

  // Build update fields
  const updateFields = {
    updatedAt: getCurrentISTTime(),
    currentStatus: nextStatus,
    ...buildOperatorFields(role, req.body, userDetails)
  };

  // Set appliedDate if transitioning from saved to applied
  if (shouldSetAppliedDate(existingJob.currentStatus, nextStatus)) {
    updateFields.appliedDate = getCurrentISTTime();
    console.log('🔄 Operations tracking triggered - edit action');
    console.log('📊 Operations user:', updateFields.operatorName);
    console.log('📧 Operations email:', updateFields.operatorEmail);
  }

  // Update job with attachments
  const updatedJob = await JobModel.findOneAndUpdate(
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

  if (!updatedJob) {
    throw { status: 404, message: "Job not found for this user" };
  }

  // Increment removal count if applicable
  await incrementRemovalCount(userEmail, status, role);

  // Send Discord notification if status changed to important status
  const isImportantChange = IMPORTANT_STATUSES.some(s => 
    String(nextStatus).toLowerCase().includes(s)
  );

  if (isImportantChange && existingJob.currentStatus !== nextStatus) {
    await sendDiscordNotification(
      userDetails,
      updatedJob,
      nextStatus,
      existingJob.currentStatus,
      role,
      userEmail
    );
  }
};

const handleDelete = async (req, res, jobID, userEmail) => {
  await JobModel.findOneAndDelete({ jobID, userID: userEmail }).lean();
};

// Main Controller
export default async function UpdateChanges(req, res) {
  const { jobID, userDetails, action } = req.body;
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

    // Fetch and return updated jobs
    const updatedJobs = await JobModel.find({ userID: userEmail })
      .sort({ createdAt: -1 })
      .lean();

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