// EmailVerificationCheck.js
import { UserModel } from '../Schema_Models/UserModel.js';

export default async function EmailVerificationCheck(req, res, next) {
    try {
        const { email } = req.body;
        
        if (!email) {
            return res.status(400).json({
                message: 'Email is required'
            });
        }

        const user = await UserModel.findOne({ email });
        
        if (!user) {
            return res.status(404).json({
                message: 'User not found'
            });
        }

        if (!user.isEmailVerified) {
            return res.status(401).json({
                message: 'Please verify your email before accessing this feature',
                emailVerified: false
            });
        }

        // Add user to request object for use in subsequent middleware/controllers
        req.user = user;
        next();
        
    } catch (error) {
        console.log(error);
        res.status(500).json({
            message: 'Internal server error'
        });
    }
}



