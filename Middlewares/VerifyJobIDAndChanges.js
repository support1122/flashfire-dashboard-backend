import { JobModel } from "../Schema_Models/JobModel.js";
import { UserModel } from "../Schema_Models/UserModel.js";


export default async function VerifyJobIDAndChanges(req, res, next) {
    let {userDetails, jobID} = req.body;
    try {
        // Only check if job exists - use lean() and minimal projection for speed
        let checkJobExistance = await JobModel.findOne({jobID})
            .select('_id')
            .lean();
        
        if(!checkJobExistance) {
            return res.status(403).json({message : 'job with this jobID doesnot exist..!'})
        }
        next();
    } catch (error) {
        console.error('VerifyJobIDAndChanges error:', error);
        return res.status(500).json({ message: 'Verification failed' });
    }
}