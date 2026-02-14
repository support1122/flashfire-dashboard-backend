import express from "express";
import Login from "./Controllers/Login.js";
import Register from "./Controllers/Register.js";
import GoogleOAuth from "./Controllers/GoogleOAuth.js";
import { getAllClients } from './Controllers/ClientController.js';
import { getDashboardManagers, getDashboardManagerByName } from './Controllers/DashboardManagerController.js';
import Add_Update_Profile from "./Controllers/Add_Update_Profile.js";
import AddJob from "./Controllers/AddJob.js";
import GetAllJobs from "./Controllers/GetAllJobs.js";
import StoreJobAndUserDetails, { saveToDashboard } from "./Controllers/StoreJobAndUserDetails.js";
import UpdateChanges from "./Controllers/UpdateChanges.js";
import GetRemovalReason from "./Controllers/GetRemovalReason.js";
import PlanSelect from "./Controllers/PlanSelect.js";
import { uploadProfileFile, upload } from "./Controllers/UploadProfileFile.js";
import { uploadSingleFile, uploadBase64File, uploadOnboardingAttachment, upload as uploadMiddleware } from "./Controllers/UploadFile.js";
import { uploadClientDocument, getClientDocuments, updateClientOptimizationStatus, upload as internalUpload } from "./Controllers/InternalClientUpload.js";
import { serveCachedImage, getCacheStats, clearCache } from "./Controllers/ImageProxy.js";
import LocalTokenValidator from "./Middlewares/LocalTokenValidator.js";
import RegisterVerify from "./Middlewares/RegisterVerify.js";
import ProfileCheck from "./Middlewares/ProfileCheck.js";
import LoginVerify from "./Middlewares/LoginVerify.js";
import CheckForDuplicateJobs from "./Middlewares/CheckForDuplicateJobs.js";
import Tokenizer from "./Middlewares/Tokenizer.js";
import UpdateActionsVerifier from "./Middlewares/UpdateActionsVerifier.js";
import VerifyJobIDAndChanges from "./Middlewares/VerifyJobIDAndChanges.js";
import RefreshToken from "./Controllers/RefreshToken.js";
import { getJobById, getJobDescription, getJobDescriptionByUrl, saveChangedSession, testJobController, getOptimizedResume, getJobsWithOptimizedResumes, getOptimizedResumesForDocuments } from "./Controllers/Optimizer/jobController.js";
import { migrateResumeDataToR2, getMigrationStatus } from "./Controllers/Optimizer/migrateToR2.js";
import GetJobDescription, { GetJobDescriptionByUrl } from "./Controllers/GetJobDescription.js";
import { updateBaseResume } from "./Controllers/Admin/SetBaseResume.js";
import { assignUserToOperations } from "./Controllers/Admin/AssignUserToOperatios.js";
import { listOperations, removeManagedUser, removeOperationUser, listAllUsers, listAllOperations, updateOperation } from "./Controllers/Admin/ListOperations.js";
import AssignResumeToUser from "./Controllers/Admin/AssignResumeToUser.js";
import { OperationsLogin, OperationsRegister } from "./Controllers/operations/Login.js";
import { requestDashboardOtp, verifyDashboardOtp, validateOtpTrust } from "./Controllers/operations/OtpController.js";
import OperationsHandeling from "./Middlewares/OperationsHandeling.js";
import GetUserDetails from "./Controllers/operations/GetUserDetails.js";
import GetUserResumes from "./Controllers/operations/GetUserResumes.js";
import GetAllJobsOPS from "./Controllers/operations/GetAllJobs.js";
import { getClientOperations, updateClientOperations, checkLockPeriod } from "./Controllers/operations/ClientOperations.js";
import ForgotPassword from "./Controllers/ForgotPassword.js";
import ExtensionLogin from "./Controllers/Extensions/login.js";
import { ReciveData } from "./Controllers/Extensions/reciveData.js";
import { extractJobData } from "./Controllers/Extensions/extractJobData.js";
import ClientLogin from "./Controllers/Extensions/clientLogin.js";
import { ProfileModel } from "./Schema_Models/ProfileModel.js";
import { UserModel } from "./Schema_Models/UserModel.js";
import CheckProfile from "./Controllers/CheckProfile.js";
import GetProfile from "./Controllers/GetProfile.js";
import { generateSessionKey, listSessionKeys, revokeSession, revokeUserSessions, listActiveSessions, verifySessionKey } from "./Controllers/operations/SessionKeys.js";
import gmailRouter from "./Controllers/GmailRouter.js";
import { listGroups, createGroup, getGroup, updateGroup } from "./Controllers/RecruiterAutomation.js";
import { getWhatsAppGroups, linkUserToGroup, getUserGroupMapping, sendCustomNotification, checkNotificationCooldown } from "./Controllers/whatsapp/WhatsAppController.js";



const app = express.Router();

// Auth routes
app.post("/login", Login);
app.post("/google-oauth", GoogleOAuth);

// Client management routes
app.post("/api/clients/register", RegisterVerify, Register);
app.get("/api/clients/all", getAllClients);
app.get("/api/dashboard-managers", getDashboardManagers);
app.post("/refresh-token", RefreshToken);
app.post('/get-updated-user', async (req, res) => {
  try {
    const existanceOfUser = await UserModel.findOne({ email: req.body.email });
    res.status(200).json({
      name: existanceOfUser?.name,
      email: existanceOfUser?.email,
      planType: existanceOfUser?.planType,
      userType: existanceOfUser?.userType,
      planLimit: existanceOfUser?.planLimit,
      resumeLink: existanceOfUser?.resumeLink,
      coverLetters: existanceOfUser?.coverLetters,
      optimizedResumes: existanceOfUser?.optimizedResumes,
      transcript: existanceOfUser?.transcript,
      dashboardManager: existanceOfUser?.dashboardManager
    })
  } catch (error) {
    console.log(error)
  }
})

// Return how many jobs a user has removed (UserModel.removedJobsCount)
app.post('/get-removed-jobs-count', async (req, res) => {
  try {
    const { email } = req.body || {};

    if (!email) {
      return res.status(400).json({
        success: false,
        error: "Email is required",
        message: "Please provide a user email to fetch removed jobs count"
      });
    }

    const user = await UserModel.findOne({ email }).select('name email removedJobsCount');
    if (!user) {
      return res.status(404).json({
        success: false,
        error: "User not found",
        message: "No user found with the provided email"
      });
    }

    return res.status(200).json({
      success: true,
      name: user.name,
      email: user.email,
      removedJobsCount: user.removedJobsCount ?? 0
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      success: false,
      error: "Server error",
      message: "Failed to fetch removed jobs count"
    });
  }
});

// Get referral stats for a user
app.post('/get-referral-stats', async (req, res) => {
  try {
    const { email } = req.body || {};

    if (!email) {
      return res.status(400).json({
        success: false,
        error: "Email is required",
        message: "Please provide a user email to fetch referral stats"
      });
    }

    // Use case-insensitive email search
    const emailLower = email.toLowerCase().trim();
    const user = await UserModel.findOne({ 
      email: { $regex: new RegExp(`^${emailLower}$`, 'i') }
    }).select('email referralStatus referrals');
    
    if (!user) {
      console.log(`User not found for email: ${emailLower}`);
      return res.status(404).json({
        success: false,
        error: "User not found",
        message: "No user found with the provided email"
      });
    }

    console.log(`Found user: ${user.email}, referralStatus: ${user.referralStatus}`);

    // Calculate referral applications based on referrals or legacy referralStatus
    let referralApplicationsAdded = 0;
    const referralsArray = Array.isArray(user.referrals) ? user.referrals : [];

    if (referralsArray.length > 0) {
      referralsArray.forEach((ref) => {
        if (ref?.plan === 'Professional') {
          referralApplicationsAdded += 200;
        } else if (ref?.plan === 'Executive') {
          referralApplicationsAdded += 300;
        }
      });
    } else {
      if (user.referralStatus === 'Professional') {
        referralApplicationsAdded = 200;
      } else if (user.referralStatus === 'Executive') {
        referralApplicationsAdded = 300;
      }
    }

    console.log(`Calculated referralApplicationsAdded: ${referralApplicationsAdded} for status: ${user.referralStatus}`);

    return res.status(200).json({
      success: true,
      email: user.email,
      referralStatus: user.referralStatus || null,
      referrals: referralsArray,
      referralApplicationsAdded
    });
  } catch (error) {
    console.error('Error fetching referral stats:', error);
    return res.status(500).json({
      success: false,
      error: "Server error",
      message: "Failed to fetch referral stats"
    });
  }
});

// Profile routes
app.get("/get-profile", GetProfile);
app.post("/check-profile", CheckProfile);
app.post("/setprofile", ProfileCheck, Add_Update_Profile);
app.post("/upload-profile-file", upload.single('file'), uploadProfileFile);

// Generic file upload routes (supports both Cloudinary and R2)
// No authentication required - trusted users only
app.post("/upload-file", uploadMiddleware.single('file'), uploadSingleFile);
app.post("/upload-base64", uploadBase64File);
app.post("/api/upload/onboarding-attachment", uploadMiddleware.single('file'), uploadOnboardingAttachment);

// Internal client upload routes (for clients-tracking service)
// These endpoints upload files and sync with ProfileModel/UserModel
app.post("/api/internal/upload-client-document", internalUpload.single('file'), uploadClientDocument);
app.get("/api/internal/client-documents/:email", getClientDocuments);
app.put("/api/internal/client-optimization/:email", updateClientOptimizationStatus);

// Image caching and proxy routes
app.get("/image-proxy", serveCachedImage);
app.get("/cache-stats", getCacheStats);
app.post("/clear-cache", clearCache);


// Job routes
app.post("/addjob", CheckForDuplicateJobs, AddJob);
app.get("/getalljobs", LocalTokenValidator, GetAllJobs);
app.post("/getalljobs", GetAllJobs);
app.post("/storejobanduserdetails", StoreJobAndUserDetails);
app.put("/updatechanges", VerifyJobIDAndChanges, UpdateChanges);
app.post("/get-removal-reason", GetRemovalReason);

// Plan routes
app.post('/api/plans/select', PlanSelect);
app.post('/forgotpasswod', ForgotPassword)


app.post("/getJobDescription", GetJobDescription);
app.get("/getJobDescription/:id", GetJobDescriptionByUrl);
app.get("/testJobController/:id", testJobController);
app.post("/saveChangedSession", saveChangedSession);
app.post("/getJobById", getJobById);
app.get("/getOptimizedResume/:jobId", getOptimizedResume);
app.post("/getJobsWithOptimizedResumes", getJobsWithOptimizedResumes);
app.post("/getOptimizedResumesForDocuments", getOptimizedResumesForDocuments);

// Migration routes - for Postman use (no authentication required but should be secured in production)
app.post("/api/migrate-resume-data-to-r2", migrateResumeDataToR2);
app.get("/api/migration-status", getMigrationStatus);

// admin new dashboard routes
app.post("/admin/setBaseResume", updateBaseResume);
app.post("/admin/assignUserToOperations", assignUserToOperations);
app.get("/admin/operations", listOperations);
app.patch("/admin/operations/:opId", updateOperation);
app.delete("/admin/operations/:opId/managedUsers/:userId", removeManagedUser);
app.delete("/admin/operations/:opId", removeOperationUser);
app.get("/admin/list/users", listAllUsers);
app.get("/admin/list/operations", listAllOperations);
import UnassignResume from "./Controllers/Admin/UnassignResume.js";
import { resumeDownloaded } from "./Controllers/resumeController.js";


app.post("/admin/assign-resume-to-user", AssignResumeToUser); // keep existing
app.post("/admin/unassign-resume", UnassignResume); // add new

// operations routes
// app.post("/operations/getAllJobs", GetAllJobsOPS)
app.post("/operations/login", OperationsLogin);
app.post("/operations/register", OperationsRegister);
app.post("/operations/request-otp", requestDashboardOtp);
app.post("/operations/verify-otp", verifyDashboardOtp);
app.post("/operations/validate-otp-trust", validateOtpTrust);
app.post("/operations/verify-session-key", verifySessionKey);
app.post("/operations/getUserDetails", OperationsHandeling, GetUserDetails); // login does this for normal users
app.post("/operations/user-resumes", GetUserResumes);
app.post('/operations/alljobs', GetAllJobsOPS);

app.post("/operations/getalljobs", GetAllJobs);
app.post('/operations/jobs', AddJob);
app.put('/operations/jobs', VerifyJobIDAndChanges, UpdateChanges);
app.post('/operations/plans/select', PlanSelect);

// Client operations management routes
app.post('/operations/client-operations', getClientOperations);
app.put('/operations/client-operations', updateClientOperations);
app.post('/operations/check-lock-period', checkLockPeriod);

//extensions
app.post('/extension/login', ExtensionLogin);
app.post('/extension/sendData', ReciveData);
app.post('/extension/extractJobData', extractJobData);
app.post('/extension/saveToDashboard', saveToDashboard);
app.post('/extension/clientLogin', ClientLogin);

// Session management routes for admin dashboard
app.post('/api/sessions/generate-session-key', generateSessionKey);
app.get('/api/sessions/session-keys', listSessionKeys);
app.get('/api/sessions/active-sessions', listActiveSessions);
app.post('/api/sessions/revoke-session', revokeSession);
app.post('/api/sessions/revoke-user-sessions', revokeUserSessions);

app.get("/admin/recruiter-groups", listGroups);
app.post("/admin/recruiter-groups", createGroup);
app.get("/admin/recruiter-groups/:id", getGroup);
app.put("/admin/recruiter-groups/:id", updateGroup);

app.use("/gmail", gmailRouter);

app.get("/api/whatsapp/groups", getWhatsAppGroups);
app.post("/api/whatsapp/link-user", linkUserToGroup);
app.post("/api/whatsapp/user-mapping", getUserGroupMapping);
app.post("/api/whatsapp/send-notification", sendCustomNotification);
app.post("/api/whatsapp/check-cooldown", checkNotificationCooldown);

// Dashboard Manager routes
app.get('/dashboard-managers', getDashboardManagers);
app.get('/dashboard-managers/:name', getDashboardManagerByName);
app.get('/flash-fill', async (req, res) => {
  try {
    let profiles = await ProfileModel.find().lean();
    res.status(200).json(profiles);
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Internal server error" });
  }

})

app.post("/downloaded", resumeDownloaded);

//AI optimizer routes
// app.post("/saveChangedSession", saveChangedSession);

export default app;


