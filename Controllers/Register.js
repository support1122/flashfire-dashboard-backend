import crypto from 'crypto'
import dotenv from 'dotenv'
import { UserModel } from '../Schema_Models/UserModel.js';
import { encrypt } from '../Utils/CryptoHelper.js';
dotenv.config();
export default async function Register(req, res) {
    let {email, name, password} = req.body;

    try {
        let passwordEncrypted = encrypt(password);
        await UserModel.create({name ,email, passwordHashed: passwordEncrypted});
        
        res.status(200).json({
            message: 'User registered',
            user: { email, name}
        })     
    } catch (error) {
        console.log(error)
    }
}