import crypto from 'crypto'
import dotenv from 'dotenv'
import jwt from 'jsonwebtoken'
import { UserModel } from '../Schema_Models/UserModel.js';
import { encrypt } from '../Utils/CryptoHelper.js';
dotenv.config();
export default async function Register(req, res) {
    let {email, firstName, lastName, password, planType} = req.body;
     try {
        // Check if user already exists
        const existingUser = await UserModel.findOne({email});
        if (existingUser) {
            return res.status(400).json({
                message: 'User with this email already exists'
            });
        }

        let passwordEncrypted = encrypt(password);
        
        // Create user with selected plan or default to "Free Trial"
        const userData = {
            name: `${firstName} ${lastName}`, 
            email, 
            passwordHashed: passwordEncrypted,
            planType: planType || "Free Trial"
        };
        
        await UserModel.create(userData);
        let newUserDetails = await UserModel.findOne({email});
        
        // Generate JWT token
        const token = jwt.sign({ email }, process.env.JWT_SECRET || 'flashfire-secret-key-2024', { expiresIn: '7d' });
        
        res.status(200).json({
            message: 'User registered successfully',
            userDetails: {
                name: newUserDetails.name,
                email: newUserDetails.email,
                planType: newUserDetails.planType,
                userType: newUserDetails.userType,
                planLimit: newUserDetails.planLimit,
                resumeLink: newUserDetails.resumeLink,
                coverLetters: newUserDetails.coverLetters,
                optimizedResumes: newUserDetails.optimizedResumes
            },
            token: token
        });
           
    } catch (error) {
        console.log(error);
        res.status(500).json({
            message: 'Registration failed',
            error: error.message
        });
    }
}