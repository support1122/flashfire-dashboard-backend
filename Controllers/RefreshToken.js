import { UserModel } from "../Schema_Models/UserModel.js";
import Operations from "../Schema_Models/Operations.js";
import { signAuthToken, verifyAuthToken, extractToken, normalizeEmail } from "../Utils/AuthToken.js";
import dotenv from 'dotenv';
dotenv.config();

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const findByEmail = (Model, email) =>
    Model.findOne({ email }).then((hit) =>
        hit || Model.findOne({ email: { $regex: new RegExp(`^${escapeRegex(email)}$`, "i") } })
    );

// This endpoint used to mint a 7-day token for whatever email was posted, with
// no proof of anything, which made every other auth check pointless. It now
// only renews a token the caller already holds, and the identity comes from
// that token - never from the request body.
export default async function RefreshToken(req, res) {
    try {
        const presentedToken = extractToken(req);
        if (!presentedToken) {
            return res.status(401).json({ message: "Authentication required", code: "MISSING_TOKEN" });
        }

        const decoded = verifyAuthToken(presentedToken);
        if (!decoded?.email) {
            return res.status(401).json({ message: "Session expired. Please log in again.", code: "INVALID_TOKEN" });
        }

        const email = normalizeEmail(decoded.email);

        // If the caller also sent an email, it must be their own.
        const requestedEmail = normalizeEmail(req.body?.email);
        if (requestedEmail && requestedEmail !== email) {
            return res.status(403).json({ message: "Token does not match the requested account", code: "EMAIL_MISMATCH" });
        }

        const user = await findByEmail(UserModel, email);

        if (!user) {
            // Operations accounts carry the same token shape but live in a
            // different collection.
            const opUser = await findByEmail(Operations, email);
            if (!opUser) {
                return res.status(404).json({ message: "User not found", code: "ACCOUNT_NOT_FOUND" });
            }

            return res.status(200).json({
                message: 'Token refreshed successfully',
                token: signAuthToken({ email: opUser.email, name: opUser.name }),
                userDetails: {
                    name: opUser.name,
                    email: opUser.email,
                    role: opUser.role,
                    managedUsers: opUser.managedUsers || []
                }
            });
        }

        return res.status(200).json({
            message: 'Token refreshed successfully',
            token: signAuthToken({ email: user.email, name: user.name }),
            userDetails: {
                name: user.name,
                email: user.email,
                planType: user.planType,
                userType: user.userType,
                planLimit: user.planLimit,
                resumeLink: user.resumeLink,
                coverLetters: user.coverLetters,
                optimizedResumes: user.optimizedResumes
            }
        });

    } catch (error) {
        console.error('Token refresh error:', error);
        return res.status(500).json({ message: "Internal server error" });
    }
}
