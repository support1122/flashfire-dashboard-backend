import mongoose from "mongoose";

export const adminSchema = new mongoose.Schema({
    adminID:{
        type: String,
        required : true,
    },
    adminName : {
        type: String,
        required : true,
    },
    adminEmail : {
        type: String,
        required : true,
    },
    adminPassword : {
        type: String,
        required : true,
    },
    userType:  { type: String, default: "User" },
    adminDesignation:{
        type: String,
        required : true,
    },
    accessAllowed : {type: Boolean},    
    clientReadAccess: {type: Boolean},
    clientEditAccess: {type : Boolean},
    adminReadAccess : {type : Boolean},
    adminWriteAccess : {type : Boolean},
    clientsAccessList : []

})

export const AdminModel = mongoose.model('admins', adminSchema);