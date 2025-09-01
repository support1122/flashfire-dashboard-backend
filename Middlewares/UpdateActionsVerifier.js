import mongoose from "mongoose";
import { JobModel } from "../Schema_Models/JobModel.js";
import { UserModel } from "../Schema_Models/UserModel.js";

export default async function UpdateActionsVerifier(req, res, next) {
    let {email,jobID,action} = req.body;
    try {
        let findJob = await JobModel.findOne({jobID})
        if (!findJob) {
            return res.status(404).json({ message: "Job not found" });
        }
        next();    
    } catch (error) {
        console.log(error);
    }
}