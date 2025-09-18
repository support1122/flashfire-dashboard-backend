import { JobModel } from "../../Schema_Models/JobModel.js";

export default async function GetAllJobsOPS(req,res) {
    let {email}= req.body;
    try {
        console.log(email)
        let allJobs = await JobModel.find({userID : email});
        console.log("all jobs ", allJobs)
        // let userDetailsLatest = await UserModel.findOne({email: userDetails?.email })
        // console.log(allJobs, userDetails);
        res.status(200).json({message : 'all Jobs List',
                              allJobs ,
                            //   userDetails:userDetailsLatest                 
                            });
    } catch (error) {
        console.log(error);
    }
}