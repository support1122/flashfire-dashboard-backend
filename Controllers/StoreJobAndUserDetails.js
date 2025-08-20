import { JobModel } from "../Schema_Models/JobModel.js";
import { UserModel } from "../Schema_Models/UserModel.js";

export default async function StoreJobAndUserDetails(req, res) {
    
    try {
        console.log(req.body);
        // res.status(200).json({message : 'sucess'});
    } catch (error) {
        console.log(error)
    }
}