import { JobModel } from "../Schema_Models/JobModel.js";
import { UserModel } from "../Schema_Models/UserModel.js";
export default async function GetAllJobs(req,res) {
    let {userDetails}= req.body;
    try {
        let allJobs = await JobModel.find({userID : userDetails?.email});
        // let userDetailsLatest = await UserModel.findOne({email: userDetails?.email })
        console.log(allJobs, userDetails);
        res.status(200).json({message : 'all Jobs List',
                              allJobs ,
                            //   userDetails:userDetailsLatest                 
                            });
    } catch (error) {
        console.log(error);
    }
}