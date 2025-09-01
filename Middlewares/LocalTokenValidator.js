import jwt from 'jsonwebtoken'
import dotenv from 'dotenv'
dotenv.config();

export default async function LocalTokenValidator(req, res, next) {
    let token, userDetails;

    // Check Authorization header first (for GET requests)
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7);
        // For GET requests, we'll get userDetails from the token itself
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET || 'flashfire-secret-key-2024');
            userDetails = { email: decoded.email };
        } catch (err) {
            return res.status(403).json({ message: "Invalid token" });
        }
    } else {
        // Check req.body (for POST requests)
        token = req.body?.token;
        userDetails = req.body?.userDetails;
    }

    if (!token || !userDetails?.email) {
        return res.status(403).json({ message: "Token or user details missing" });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'flashfire-secret-key-2024');
        if (decoded?.email === userDetails.email) {
            // Set user information in request object for other controllers to use
            req.user = decoded;
            req.userDetails = userDetails;
            console.log('token validation successful..!')
            next();
        } else {
            return res.status(403).json({ message: "Token or user details missing" });
        }
    } catch (err) {
        console.log("JWT validation failed:", err);
        return res.status(403).json({ message: "Invalid token or expired" });
    }
}
