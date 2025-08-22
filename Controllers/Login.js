import { UserModel } from "../Schema_Models/UserModel.js";
import { ProfileModel } from "../Schema_Models/ProfileModel.js";
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken'
import { decrypt } from "../Utils/CryptoHelper.js";
dotenv.config();

export default async function Login(req, res) {
    const { email, password, existanceOfUser, token} = req.body;
    console.log(req.body);
    
    try {
        let profileLookUp = await ProfileModel.findOne({email});
        let passwordDecrypted = decrypt(existanceOfUser.passwordHashed)
        if (passwordDecrypted === password) {
            return res.status(200).json({
                message: 'Login Sucess..!',
                userDetails: { name: existanceOfUser.name, email, planType:existanceOfUser.planType, userType:existanceOfUser.userType, planLimit : existanceOfUser.planLimit, resumeLink : existanceOfUser.resumeLink, coverLetters : existanceOfUser.coverLetters, optimizedResumes: existanceOfUser.optimizedResumes },
                token,
                userProfile : profileLookUp?.email.length > 0 ? profileLookUp : null
            });

        } else {
            req.body.token = 'InvalidUser';
            return res.status(401).json({ message: "Invalid password" });
        }

    } catch (error) {
        console.log(error);
        res.status(500).json({ message: "Internal server error" });
    }
}
