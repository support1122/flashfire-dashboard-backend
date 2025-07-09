import {UserModel} from '../Schema_Models/UserModel.js'
import jwt from 'jsonwebtoken'
import dotenv from 'dotenv'
dotenv.config();

export default async function LocalTokenValidator(req, res, next) {
    let {token, userDetails}= req.body;
    try {
        let tokenValidation = jwt.verify(token, process.env.JWT_SECRET_KEY);
        if (tokenValidation && tokenValidation.email == userDetails?.email){
        // res.status(200).json({message: 'token verified and validated ..!'});
        next();
        return;
        }
        else{
            return res.status(403).json({message : 'invalid token please login again'});
        }
        
    } catch (error) {
        console.log(error);
    }
}