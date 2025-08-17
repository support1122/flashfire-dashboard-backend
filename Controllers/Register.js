import crypto from 'crypto'
import dotenv from 'dotenv'
import { UserModel } from '../Schema_Models/UserModel.js';
import { encrypt } from '../Utils/CryptoHelper.js';
dotenv.config();

export default async function Register(req, res) {
    let {email, name, password} = req.body;
    
    try {
        // Check if user already exists
        const existingUser = await UserModel.findOne({ email });
        if (existingUser) {
            return res.status(400).json({
                message: 'User with this email already exists'
            });
        }

        // Encrypt password
        const passwordEncrypted = encrypt(password);

        // Create user directly without email verification
        const newUser = await UserModel.create({
            name,
            email,
            passwordHashed: passwordEncrypted,
            isEmailVerified: true, // Set to true since we're not doing email verification
            emailVerificationToken: null
        });

        res.status(201).json({
            message: 'User registered successfully! You can now login.',
            userDetails: {
                name: newUser.name,
                email: newUser.email,
                isEmailVerified: newUser.isEmailVerified
            }
        });
           
    } catch (error) {
        console.log(error);
        res.status(500).json({
            message: 'Internal server error',
            error: error.message
        });
    }
}