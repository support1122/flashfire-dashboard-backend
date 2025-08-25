import { UserModel } from "../Schema_Models/UserModel.js";
import { OAuth2Client } from "google-auth-library";
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
import jwt from 'jsonwebtoken'

const GoogleOAuth = async (req, res) => {
  const { token } = req.body;

 try {
  
   const ticket = await client.verifyIdToken({
    idToken: token,
    audience: process.env.GOOGLE_CLIENT_ID
  });
  const payload = ticket.getPayload();

  let userFromDb = await UserModel.findOne({ email: payload.email });
  if (!userFromDb) {
    await UserModel.create({ name: payload?.name, email: payload?.email });
  }
let userDetails = await UserModel.findOne({ email: payload.email });
const tokenNew = jwt.sign(
            { email: payload?.email, name: userFromDb?.name },
            process.env.JWT_SECRET || 'flashfire-secret-key-2024',
            { expiresIn: '24h' }
        );
return res.status(200).json({
                message: 'Login Sucess..!',
                userDetails: { name: userDetails.name, email : userDetails.email, planType:userDetails.planType, userType:userDetails.userType, planLimit : userDetails.planLimit, resumeLink : userDetails.resumeLink },
                token: tokenNew
            });
} catch (error) {
  console.log(error)
 }
};
export default GoogleOAuth;