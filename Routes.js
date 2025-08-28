import express from "express";
import Login from "./Controllers/Login.js";
import Register from "./Controllers/Register.js";
import GoogleOAuth from "./Controllers/GoogleOAuth.js";
import Add_Update_Profile from "./Controllers/Add_Update_Profile.js";
import AddJob from "./Controllers/AddJob.js";
import GetAllJobs from "./Controllers/GetAllJobs.js";
import StoreJobAndUserDetails from "./Controllers/StoreJobAndUserDetails.js";
import UpdateChanges from "./Controllers/UpdateChanges.js";
import PlanSelect from "./Controllers/PlanSelect.js";
import { uploadProfileFile, upload } from "./Controllers/UploadProfileFile.js";
import LocalTokenValidator from "./Middlewares/LocalTokenValidator.js";
import RegisterVerify from "./Middlewares/RegisterVerify.js";
import ProfileCheck from "./Middlewares/ProfileCheck.js";
import LoginVerify from "./Middlewares/LoginVerify.js";
import CheckForDuplicateJobs from "./Middlewares/CheckForDuplicateJobs.js";
import Tokenizer from "./Middlewares/Tokenizer.js";
import UpdateActionsVerifier from "./Middlewares/UpdateActionsVerifier.js";
import VerifyJobIDAndChanges from "./Middlewares/VerifyJobIDAndChanges.js";

const app = express.Router();

// Auth routes
app.post("/login", Login);
app.post("/register", RegisterVerify, Register);
app.post("/google-oauth", GoogleOAuth);

// Profile routes
app.post("/setprofile", LocalTokenValidator, ProfileCheck, Add_Update_Profile);
app.post("/upload-profile-file", LocalTokenValidator, upload.single('file'), uploadProfileFile);

// Job routes
app.post("/addjob", LocalTokenValidator, CheckForDuplicateJobs, AddJob);
app.get("/getalljobs", LocalTokenValidator, GetAllJobs);
app.post("/storejobanduserdetails", StoreJobAndUserDetails);
app.put("/updatechanges", LocalTokenValidator, VerifyJobIDAndChanges, UpdateChanges);

// Plan routes
app.post("/api/plans/select", LocalTokenValidator, PlanSelect);

export default app;


