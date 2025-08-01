import mongoose, { trusted } from 'mongoose'
//schema and models for users.....

export const userSchema= new mongoose.Schema({
    userID:{
        type : String,
        required : true,
        // unique : true,
        default : ()=>new Date().getTime()
    },
    name:{
        type : String,
        required : true,
        // default : 'NewUser'
    },
    email : {
        type : String,
        required : true,
        // default : 'newuseremail'
    },
    passwordHashed:{
        type : String,
        required : true,
        default : '--NO Password --/OAUTH'
    },
    resumeLink : {
        type : String,
        // required : true,
        default : null
    },
    planType : {
        type : String,
        required : true,
        default : 'Free Trial'
    },
    planLimit : {
        type : Number,
        // required : true,
        default : null
    },
    userType:{
        type : String,
        // required : true,
        default : 'User'
    },
    createdAt:{
        type : String,
        required : true,
        default : ()=>new Date().toLocaleString()
    }
    
});
export const UserModel = mongoose.model("users", userSchema);