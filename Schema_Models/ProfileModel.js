// import mongoose, { trusted } from 'mongoose'
// import {JobModel, JobSchema} from "../Schema_Models/JobSchema.js";

// ////schema and models for profile....

// const profileSchema= new mongoose.Schema({
//     userID:{
//         type: String,
//         required : true,
//          default : ()=>new Date().getTime()
//     },
//     userType : {
//         type : String,
//         required : true,
//         enum : ['admin', 'user']
//     },
//     name : {
//         type: String,
//         required : true,
//     },
//     email: {
//         type: String,
//         required : true,
//         unique : true, 
//     },
//     userDetails : {
//         education : {
//             type : String,
//             required : false
//         },
//         skills : [String],
//         experience :{}
//     },
//     picture:{
//         type : String,
//         required : true,
//         default : 'https://media.istockphoto.com/id/1300845620/vector/user-icon-flat-isolated-on-white-background-user-symbol-vector-illustration.jpg?s=612x612&w=0&k=20&c=yBeyba0hUkh14_jgv1OKqIH0CCSWU_4ckRkAoy2p73o='
//     },
//     interests:{
//         type : [String]
//     }
// });


// export const ProfileModel = mongoose.model('profiles', profileSchema);
