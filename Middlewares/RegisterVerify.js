import { UserModel } from "../Schema_Models/UserModel.js";

export default async function RegisterVerify(req, res, next) {
    let { firstName, lastName, email, password, planType} = req.body;
    let name = firstName + lastName ;
    req.body.name = name;
    console.log(req.body)
    
    // Validate planType
    const validPlans = ["Free Trial", "Ignite", "Professional", "Executive"];
    if (planType && !validPlans.includes(planType)) {
        return res.status(400).json({
            message: 'Invalid plan type. Please select a valid plan.'
        });
    }
    

    
    // Temporarily disabled email validation due to API issues
    // let emailVerifyURL = `https://emailvalidation.abstractapi.com/v1/?api_key=${process.env.ABSTRACT_API_PRIMARY_KEY_BISWAJITSHRM66}&email=${email}`
    try {
        let checkUserExistance = await UserModel.findOne({email});
        if(checkUserExistance){
            return res.status(403).json({message : 'User Already Exist'});
        }
        // Temporarily skip email validation
        // let verifyEmail = await fetch(emailVerifyURL);
        // let verificationResult = await verifyEmail.json();
        // if(!verificationResult?.is_smtp_valid?.value){
        //    return res.status(403).json({message : 'Invalid E-Mail , please enter a valid email ..!'})
        // }
        next();
    } catch (error) {
        console.log(error)
    }
}