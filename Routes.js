
// import CheckJobExistance from "./Middlewares/CheckJobExistance.js";
// import AddJobs from "./Controllers/AddJobs.js";
// import AdminDashBoard from "./Controllers/AdminDashBoard.js";
import AddJob from "./Controllers/AddJob.js";
import CheckForDuplicateJobs from "./Middlewares/CheckForDuplicateJobs.js";
//import UpdateActionsVerifier from "./Middlewares/UpdateActionsVerifier.js";
// import UpdateJobDataForUser from "./Controllers/UpdateJobDataForUser.js";
import VerifyJobIDAndChanges from "./Middlewares/VerifyJobIDAndChanges.js";
import UpdateChanges from "./Controllers/UpdateChanges.js";
import GetAllJobs from "./Controllers/GetAllJobs.js";
import RegisterVerify from './Middlewares/RegisterVerify.js'
import Register from './Controllers/Register.js'
import LoginVerify from './Middlewares/LoginVerify.js'
import Login from './Controllers/Login.js'
import Tokenizer from './Middlewares/Tokenizer.js'
import LocalTokenValidator from './Middlewares/LocalTokenValidator.js'
import GoogleAuth from './Controllers/GoogleOAuth.js'
import PlanSelect from './Controllers/PlanSelect.js'

export default function Routes(app){
  //login routes and registration routes and job adding by admin routes....
  app.post('/register', RegisterVerify, Register);
  app.post('/googleOAuth', GoogleAuth);
  app.post('/login', LoginVerify, Tokenizer, Login);
  app.post('/api/alljobs', LocalTokenValidator, GetAllJobs);
  app.post('/api/jobs',LocalTokenValidator,  CheckForDuplicateJobs, AddJob );
  app.put('/api/jobs', LocalTokenValidator, VerifyJobIDAndChanges, UpdateChanges);
  app.post('/api/plans/select',PlanSelect)
  // app.delete()
  //  app.post('/user/dashboard/',UpdateActionsVerifier, UpdateJobDataForUser)
   //app.post('/admin/addjobs', CheckJobExistance , AddJobs );
  //  app.get('/admin/dashboard',   AdminDashBoard);

}

// LoginVerifier, LocalTokenValidator
// LoginVerifier, LocalTokenValidator