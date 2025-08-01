import jwt from 'jsonwebtoken'
import dotenv from 'dotenv'
dotenv.config();


export default async function LocalTokenValidator(req, res, next) {
    const { token, userDetails } = req.body;

    if (!token || !userDetails?.email) {
        return res.status(403).json({ message: "Token or user details missing" });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET_KEY);
        if (decoded?.email === userDetails.email) {
            console.log('token validation suceessfull..!')
            next();
        } else {
            return res.status(403).json({ message: "Token or user details missing" });
        }
    } catch (err) {
        console.log("JWT validation failed:", err);
        return res.status(403).json({ message: "Invalid token or expired" });
    }
}
