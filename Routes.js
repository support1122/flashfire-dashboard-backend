import express from "express";
import Login from "./Controllers/Login.js";
import Register from "./Controllers/Register.js";
import GoogleOAuth from "./Controllers/GoogleOAuth.js";
import Add_Update_Profile from "./Controllers/Add_Update_Profile.js";
import AddJob from "./Controllers/AddJob.js";
import GetAllJobs from "./Controllers/GetAllJobs.js";
import StoreJobAndUserDetails, { saveToDashboard } from "./Controllers/StoreJobAndUserDetails.js";
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
import RefreshToken from "./Controllers/RefreshToken.js";
import { getJobDescription, getJobDescriptionByUrl, saveChangedSession, testJobController } from "./Controllers/Optimizer/jobController.js";
import { updateBaseResume } from "./Controllers/Admin/SetBaseResume.js";
import { assignUserToOperations } from "./Controllers/Admin/AssignUserToOperatios.js";
import { listOperations, removeManagedUser, removeOperationUser, listAllUsers, listAllOperations } from "./Controllers/Admin/ListOperations.js";
import { OperationsLogin, OperationsRegister } from "./Controllers/operations/Login.js";
import OperationsHandeling from "./Middlewares/OperationsHandeling.js";
import GetUserDetails from "./Controllers/operations/GetUserDetails.js";
import GetAllJobsOPS from "./Controllers/operations/GetAllJobs.js";
import ForgotPassword from "./Controllers/ForgotPassword.js";
import ExtensionLogin from "./Controllers/Extensions/login.js";
import { ReciveData } from "./Controllers/Extensions/reciveData.js";
import ClientLogin from "./Controllers/Extensions/clientLogin.js";
import { ProfileModel } from "./Schema_Models/ProfileModel.js";



const app = express.Router();

// Auth routes
app.post("/login", Login);
app.post("/coreops", RegisterVerify, Register);
app.post("/google-oauth", GoogleOAuth);
app.post("/refresh-token", RefreshToken);

// Profile routes
app.post("/setprofile", LocalTokenValidator, ProfileCheck, Add_Update_Profile);
app.post("/upload-profile-file", LocalTokenValidator, upload.single('file'), uploadProfileFile);

// Job routes
app.post("/addjob", LocalTokenValidator, CheckForDuplicateJobs, AddJob);
app.get("/getalljobs", LocalTokenValidator, GetAllJobs);
app.post("/getalljobs", LocalTokenValidator, GetAllJobs);
app.post("/storejobanduserdetails", StoreJobAndUserDetails);
app.put("/updatechanges", LocalTokenValidator, VerifyJobIDAndChanges, UpdateChanges);

// Plan routes
app.post('/api/plans/select', PlanSelect);
app.post('/forgotpasswod', ForgotPassword)


app.post("/getJobDescription", getJobDescription);
app.get("/getJobDescription/:id", getJobDescriptionByUrl);
app.get("/testJobController/:id", testJobController);
app.post("/saveChangedSession", saveChangedSession);

// admin new dashboard routes
app.post("/admin/setBaseResume", updateBaseResume);
app.post("/admin/assignUserToOperations", assignUserToOperations);
app.get("/admin/operations", listOperations);
app.delete("/admin/operations/:opId/managedUsers/:userId", removeManagedUser);
app.delete("/admin/operations/:opId", removeOperationUser);
app.get("/admin/list/users", listAllUsers);
app.get("/admin/list/operations", listAllOperations);

// operations routes
// app.post("/operations/getAllJobs", GetAllJobsOPS)
app.post("/operations/login", OperationsLogin);
app.post("/operations/register", OperationsRegister);
app.post("/operations/getUserDetails", OperationsHandeling, GetUserDetails); // login does this for normal users
app.post('/operations/alljobs', GetAllJobsOPS);

app.post("/operations/getalljobs", GetAllJobs);
app.post('/operations/jobs', AddJob);
app.put('/operations/jobs', VerifyJobIDAndChanges, UpdateChanges);
app.post('/operations/plans/select', PlanSelect);

//extensions
app.post('/extension/login', ExtensionLogin);
app.post('/extension/sendData', ReciveData);
app.post('/extension/saveToDashboard', saveToDashboard);
app.post('/extension/clientLogin', ClientLogin);
app.get('/flash-fill', async (req, res) => {
    try {
      let profiles =await  ProfileModel.find().lean();
      res.status(200).json(profiles);
    } catch (error) {
      console.log(error);
    }
    
  })

//AI optimizer routes
// app.post("/saveChangedSession", saveChangedSession);

export default app;


