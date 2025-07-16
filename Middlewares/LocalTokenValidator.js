import {UserModel} from '../Schema_Models/UserModel.js'
import jwt from 'jsonwebtoken'
import dotenv from 'dotenv'
dotenv.config();

// export default async function LocalTokenValidator(req, res, next) {
//     let {token, userDetails}= req.body;
//     try {
//         let tokenValidation = jwt.verify(token, process.env.JWT_SECRET_KEY);
//         if (tokenValidation && tokenValidation.email == userDetails?.email){
//         // res.status(200).json({message: 'token verified and validated ..!'});
//         next();
//         return;
//         }
//         else{
//             return res.status(403).json({message : 'invalid token please login again'});
//         }
        
//     } catch (error) {
//         console.log(error);
//     }
// }
export default async function LocalTokenValidator(req, res, next) {
    const { token, userDetails } = req.body;

    if (!token || !userDetails?.email) {
        return res.status(403).json({ message: "Token or user details missing" });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET_KEY);
        if (decoded?.email === userDetails.email) {
            next();
        } else {
            return res.status(403).json({ message: "Invalid token. Please login again." });
        }
    } catch (err) {
        console.log("JWT validation failed:", err);
        return res.status(403).json({ message: "Invalid token or expired" });
    }
}
