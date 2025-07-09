import { UserModel } from "../Schema_Models/UserModel.js";

export default async function RegisterVerify(req, res, next) {
    let { name, email, password} = req.body;
    console.log(req.body)
    let emailVerifyURL = `https://emailvalidation.abstractapi.com/v1/?api_key=${process.env.ABSTRACT_API_PRIMARY_KEY_BISWAJITSHRM66}&email=${email}`
    try {
        let checkUserExistance = await UserModel.findOne({email});
        if(checkUserExistance){
            return res.status(403).json({message : 'User Already Exist'});
        }
        let verifyEmail = await fetch(emailVerifyURL);
        let verificationResult = await verifyEmail.json();
        if(!verificationResult?.is_smtp_valid?.value){
           return res.status(403).json({message : 'Invalid E-Mail , please enter a valid email ..!'})
        }
        next();
    } catch (error) {
        console.log(error)
    }
}