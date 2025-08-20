import { JobModel } from "../Schema_Models/JobModel.js";
import { UserModel } from "../Schema_Models/UserModel.js";

export default async function StoreJobAndUserDetails(req, res) {
    
    try {
        console.log(req.body);
        const existance = await JobModel.findOne({jobTitle : req.body.Title, userID, companyName: req.body['Company Name'], joblink : req.body['Apply Url']});
        if(existance){
            return;
        }
        // make sure `userID` is defined above (e.g., from auth or req.body)
        console.log(payload);
        const payload = {
        dateAdded: req.body['Published at'] ? new Date(req.body['Published at']) : new Date(),
        userID, // <- ensure this variable exists
        jobTitle: req.body['Title'] || 'Untitled Job',
        jobDescription: JSON.stringify({
            employmentType: req.body['Employment Type'] || '',
            jobFunctions:   req.body['Job Functions'] || '',
            industries:     req.body['Industries'] || '',
            description:    req.body['Description'] || '',
            requirements:   req.body['REQUIREMENTS AND QUALIFICATIONS'] || '',
            salary:         req.body['Salary'] || ''
        }),
        joblink: req.body['Apply Url'] || '',
        companyName: req.body['Company Name'] || '',
        createdAt: req.body['Published at'] ? new Date(req.body['Published at']) : new Date()
        };

        // preferred (Mongoose):
        await JobModel.create(payload);
console.log('job created.')
        // or:
        // await new JobModel(payload).save();

        // only if you truly want the raw driver method:
        // await JobModel.collection.insertOne(payload);

        // res.status(200).json({message : 'sucess'});
    } catch (error) {
        console.log(error)
    }
}