import { UserModel } from "../Schema_Models/UserModel.js";

export default async function LoginVerify(req, res, next) {
     let { email, password } = req.body;

     try {
          // console.log(req.body);
          let existanceOfUser = await UserModel.findOne({ email });
          // console.log(existanceOfUser)
          if (!existanceOfUser) {
               return res.status(404).json({ message: 'User Not Found. Sign Up to continue ' });
          }
          req.body.existanceOfUser = existanceOfUser;
          next();
     } catch (error) {
          console.log(error)
     }
}