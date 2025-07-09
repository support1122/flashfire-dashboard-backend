import mongoose from "mongoose";
import { UserModel } from "../Schema_Models/UserModel.js";

export default async function LoginVerify(req, res, next) {
    let {email, password} = req.body;

    try {
        console.log(req.body);
        let existanceOfUser = await UserModel.findOne({email});
        console.log(existanceOfUser)
        if(!existanceOfUser){
            return res.status(404).json({message : 'User Doesnot Exist ..!..please sign up..'});
        }
        next();
    } catch (error) {
        console.log(error)
    }
}