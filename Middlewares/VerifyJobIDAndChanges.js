import mongoose from "mongoose";
import { JobModel } from "../Schema_Models/JobModel.js";
import { UserModel } from "../Schema_Models/UserModel.js";


export default async function VerifyJobIDAndChanges(req, res, next) {
    let {userDetails, jobID} = req.body;
    console.log(req.body, 'verifying........')
    try {
        let checkJobExistance = await JobModel.findOne({jobID})
        let checkUserExistance = await UserModel.findOne({email : userDetails?.email})
        if(!checkJobExistance) {
            return res.status(403).json({message : 'job with this jobID doesnot exist..!'})
        }
        if(!checkUserExistance){
            return res.status(403). json({message : 'user not found!..'})
        }
        console.log(checkJobExistance, checkUserExistance,'verification')
        next();
    } catch (error) {
        console.log(error);
    }
}