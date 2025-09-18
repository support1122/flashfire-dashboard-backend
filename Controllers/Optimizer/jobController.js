import { JobModel } from "../../Schema_Models/JobModel.js";

// get the job description for a particular job id
export const getJobDescription = async (req, res) => {
     try {
          const { id } = req.body; // expecting { "id": "..." }

          if (!id) {
               return res.status(400).json({ error: "Job ID is required in body" });
          }

          const job = await JobModel.findById(id, "jobDescription");
          // the 2nd param "jobDescription" ensures only that field is returned

          if (!job) {
               return res.status(404).json({ error: "Job not found" });
          }

          return res.json({ jobDescription: job.jobDescription });
     } catch (error) {
          console.error("Error fetching job description:", error);
          return res.status(500).json({ error: "Server error" });
     }
};
// showing the changes made in the user dashboard route
export const saveChangedSession = async (req, res) => {
     try {
          const { id, startingContent, finalChanges } = req.body;

          if (!id || !startingContent) {
               return res.status(400).json({ error: "Job ID and starting content are required" });
          }

          // Find the job and update it with the new changes
          const changesMade = {
               startingContent,
               finalChanges,
               timestamp: new Date().toLocaleString("en-US", "Asia/Kolkata"),
               changedSections: Object.keys(startingContent)
          };
          await JobModel.findOneAndUpdate(
               { _id: id },
               {
                    changesMade,
                    updatedAt: new Date().toLocaleString("en-US", "Asia/Kolkata")
               }
          );
          console.log(changesMade,"changes made");
          return res.json({ message: "Changes saved successfully"  , changesMade });
     } catch (error) {
          console.error("Error saving changed session:", error);
          return res.status(500).json({ error: "Server error" });
     }
};
