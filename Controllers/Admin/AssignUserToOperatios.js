import { UserModel } from "../../Schema_Models/UserModel.js";
import Operations from "../../Schema_Models/Operations.js";

export const assignUserToOperations = async (req, res) => {
     const { userId, operatorEmail } = req.body;

     if (!userId || !operatorEmail) {
          return res
               .status(400)
               .json({ error: "User ID and Operator Email are required" });
     }

     try {
          const user = await UserModel.findOne({ email: userId });
          const operation = await Operations.findOne({ email: operatorEmail });

          if (!user || !operation) {
               return res
                    .status(404)
                    .json({ error: "User or Operation not found" });
          }

          // Check if user is already in managedUsers
          if (
               operation.managedUsers.some(
                    (id) => id.toString() === user.id.toString()
               )
          ) {
               return res
                    .status(400)
                    .json({ error: "User is already assigned to this operation" });
          }

          operation.managedUsers.push(user.id);
          await operation.save();

          res
               .status(200)
               .json({ message: "User assigned to operation successfully" });
     } catch (error) {
          console.error("Error assigning user to operation:", error);
          res.status(500).json({ error: "Server error" });
     }
};
