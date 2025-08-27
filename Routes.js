// Routes.js
import express from "express";
import Login from "./Controllers/Login.js";
import Register from "./Controllers/Register.js";
import GoogleOAuth from "./Controllers/GoogleOAuth.js";
import Add_Update_Profile from "./Controllers/Add_Update_Profile.js";
import StoreJobAndUserDetails from "./Controllers/StoreJobAndUserDetails.js";
import { validateRequestOtpBody, validateVerifyOtpBody } from "./Middlewares/ValidateOTPBodies.js";
import SendgridEmailExistance from "./Middlewares/SendgridEmailExistance.js";
import Tokenizer from "./Middlewares/Tokenizer.js";
import { otpLoginRespondController, requestOtpController, verifyOtpCore } from "./Controllers/SendgridOtpAuth.js";
import EnsureUserForOtp from "./Middlewares/EnsureUserForOtp.js";
import LocalTokenValidator from "./Middlewares/LocalTokenValidator.js";
import ProfileCheck from "./Middlewares/ProfileCheck.js";
import PlanSelect from "./Controllers/PlanSelect.js";
import VerifyJobIDAndChanges from "./Middlewares/VerifyJobIDAndChanges.js";
import UpdateChanges from "./Controllers/UpdateChanges.js";
import GetAllJobs from "./Controllers/GetAllJobs.js";
import CheckForDuplicateJobs from "./Middlewares/CheckForDuplicateJobs.js";
import AddJob from "./Controllers/AddJob.js";
import { uploadProfileFile, upload } from "./Controllers/UploadProfileFile.js";
import RegisterVerify from './Middlewares/RegisterVerify.js';
// export default function Routes(){
const router = express.Router();

//-----register route------------------
router.post('/flashregister', RegisterVerify, Register );

// ---- OTP ----
router.post(
  "/auth/request-otp",
  validateRequestOtpBody,
  SendgridEmailExistance,        // keep here if you must
  requestOtpController
);

router.post(
  "/auth/verify-otp",
  validateVerifyOtpBody,
  // ❌ Remove SendgridEmailExistance here — it can block new users
  verifyOtpCore,                 // check code first
  EnsureUserForOtp,              // create/fetch user
  Tokenizer,                     // mint token
  otpLoginRespondController      // respond
);

// ---- Profile ----
router.post("/setprofile", LocalTokenValidator, ProfileCheck, Add_Update_Profile);
router.post("/upload-profile-file", LocalTokenValidator, upload.single("file"), uploadProfileFile);

// ---- Jobs ----
router.post("/addjob", LocalTokenValidator, CheckForDuplicateJobs, AddJob);
router.get("/getalljobs", LocalTokenValidator, GetAllJobs);
router.post("/storejobanduserdetails", StoreJobAndUserDetails);
router.put("/updatechanges", LocalTokenValidator, VerifyJobIDAndChanges, UpdateChanges);

// ---- Plans ----
router.post("/api/plans/select", LocalTokenValidator, PlanSelect);
// }
export default router;   // <-- export the router object
