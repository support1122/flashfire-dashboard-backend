import { UserModel } from "../../Schema_Models/UserModel.js";

export const updateBaseResume = async (req, res) => {
     try {
          const { email, resumeId } = req.body;

          if (!email || !resumeId) {
               return res.status(400).json({ message: "Email and resumeId are required" });
          }

          const updatedUser = await UserModel.findOneAndUpdate(
               { email },
               { baseResume: resumeId },
               { new: true } // return updated doc
          );

          if (!updatedUser) {
               return res.status(404).json({ message: "User not found" });
          }

          return res.status(200).json({
               message: "Base resume updated successfully",
               user: updatedUser,
          });
     } catch (error) {
          console.error("Error updating baseResume:", error);
          return res.status(500).json({ message: "Server error", error: error.message });
     }
};
