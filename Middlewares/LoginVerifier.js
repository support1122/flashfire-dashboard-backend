// import { AdminModel } from "../Schema_Models/AdminModel";
// import { UserModel } from "../Schema_Models/UserModel";

// export default async function (req, res, next){
//     try {
//         let checkUserExistance = await UserModel.findOne({email : req.body.email});
//         let checkAdminExistance = await AdminModel.findOne({adminEmail : req.body.email})
//         if(!checkUserExistance && !checkAdminExistance){
//             return res.return(403).json({message : 'No User Exist With This Email. Please Sign up '});
//         }
//         else if(checkAdminExistance && checkUserExistance){
//             return res.status(403).json({message : 'Duplicate User Detected !.'})
//         }   
//         else if(checkAdminExistance && !checkUserExistance){
//             req.body.userType = 'admin';
//             next();
//         }
//         else if(!checkAdminExistance && checkUserExistance){
//             req.body.userType = 'user';
//             next();
//         }       
//     } catch (error) {
//         console.log(error);
//     }
    

    
    
// }