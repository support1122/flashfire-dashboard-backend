import { UserModel } from "../Schema_Models/UserModel.js";
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken'
import { decrypt } from "../Utils/CryptoHelper.js";
dotenv.config();

export default async function Login(req, res) {
    const { email, password} = req.body;
    console.log(req.body);

    try {
        const userFromDb = await UserModel.findOne({ email });
        let passwordDecrypted = decrypt(userFromDb.passwordHashed)
        if (passwordDecrypted === password) {
            const token = jwt.sign(
            { email, name: userFromDb.name },
            process.env.JWT_SECRET_KEY,
            { expiresIn: '1d' }
        );
            return res.status(200).json({
                message: 'Login Sucess..!',
                userDetails: { name: userFromDb.name, email },
                token
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
