import { UserModel } from "../Schema_Models/UserModel.js";

export default async function(req, res){
    let {resumeLink, token, userDetails, planType, planLimit, } = req.body;
    try {
let userFromDb = await UserModel.findOneAndUpdate(
                { email: userDetails.email },
                {
                    $set: {
                    planType,
                    resumeLink,
                    planLimit,
                    },
                },
                { new: true } // optional: return the updated document
                );   
console.log(userFromDb) ;
res.status(201).json({message : "Plan Selection Sucess",
                    userDetails :{
                        email:userFromDb.email,
                        name : userFromDb.name,
                        planLimit : userFromDb.planLimit,
                        planType : userFromDb.planType,
                        resumeLink : userFromDb.resumeLink,
                        userType: userFromDb.userType                    
                    },
})
} catch (error) {
        console.log(error)
    }
}