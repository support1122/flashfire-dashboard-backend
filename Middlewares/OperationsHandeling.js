import { UserModel } from "../Schema_Models/UserModel.js";

export default async function OperationsHandeling(req, res, next) {
     let { id } = req.body;

     try {
          console.log(req.body);
          let existanceOfUser = await UserModel.findById({ _id: id });
          console.log(existanceOfUser)
          if (!existanceOfUser) {
               return res.status(404).json({ message: 'User Not Found. Sign Up to continue ' });
          }
          req.body.existanceOfUser = existanceOfUser;
          next();
     } catch (error) {
          console.log(error)
          res.status(500).json({ message: "Internal server error while fetching user details of Operations team - middleware" });
     }
}