import crypto from 'crypto'
import dotenv from 'dotenv'
import { UserModel } from '../Schema_Models/UserModel.js';
import { encrypt } from '../Utils/CryptoHelper.js';
dotenv.config();
export default async function Register(req, res) {
    let {email, name, password} = req.body;
    // let userType;
    try {
        let passwordEncrypted = encrypt(password);
        
        await UserModel.create({name ,email, passwordHashed: passwordEncrypted});
        let newUserDetails = await UserModel.findOne({email});
        res.status(200).json({
            message: 'User registered',
            user: newUserDetails//{ email, name}
        })  ;
           
    } catch (error) {
        console.log(error)
    }
}