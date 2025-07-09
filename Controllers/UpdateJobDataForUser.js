// import mongoose from "mongoose";
// import { UserModel } from "../Schema_Models/UserModel.js";
// import { JobModel } from "../Schema_Models/JobModel.js";

// export default async function UpdateJobDataForUser(req, res) {
//     let {email,jobID,action} = req.body;
//     try {
//         let findJob = await JobModel.findOne({jobID})
//         let checkUserExistance = await UserModel.findOne({email});
//         if(!checkUserExistance){
//             await UserModel.create({email})
//             // return res.status(404).json({message : 'user Doesnot exist'})
//         }
//         let savedCheck = checkUserExistance?.dashboard?.saved?.filter((items)=>items?.job?.jobID == jobID);
//         let appliedCheck = checkUserExistance?.dashboard?.saved?.filter((items)=>items?.job?.jobID == jobID);
//         let deletedCheck = checkUserExistance?.dashboard?.saved?.filter((items)=>items?.job?.jobID == jobID);
//         let interviewingCheck = checkUserExistance?.dashboard?.saved?.filter((items)=>items?.job?.jobID == jobID);
//         let offersCheck = checkUserExistance?.dashboard?.saved?.filter((items)=>items?.job?.jobID == jobID);
//         let rejectedCheck = checkUserExistance?.dashboard?.saved?.filter((items)=>items?.job?.jobID == jobID);
//         if(savedCheck.length>0 || appliedCheck.length>0 || deletedCheck.length>0 || interviewingCheck.length>0 || offersCheck.length>0 || rejectedCheck.length>0 ){
//             return res.status(402).json({message : 'the user is already engaged in this job '})
//         }
//         await UserModel.findOneAndUpdate({ email },{ 
//                                         $push: { "dashboard.saved": {job:findJob} } 
//                                     });
//         let newDashBoard = await UserModel.findOne({email});
//         return res.status(201).json({message : 'details updated succesfully',newDashBoard});
        
//     } catch (error) {
//         console.log(error)
//     }
// }