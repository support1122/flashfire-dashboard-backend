import { JobModel } from "../../Schema_Models/JobModel.js";

// Test endpoint to verify the controller is working
export const testJobController = async (req, res) => {
     try {
          res.json({
               message: "Job controller is working!",
               timestamp: new Date().toISOString(),
               jobId: req.params.id || "no-id-provided"
          });
     } catch (error) {
          console.error("Error in test endpoint:", error);
          res.status(500).json({ error: "Server error" });
     }
};

// get the job description for a particular job id (from body)
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

// get the job description for a particular job id (from URL params)
export const getJobDescriptionByUrl = async (req, res) => {
     try {
          const { id } = req.params; // expecting id from URL like /getJobDescription/:id

          if (!id) {
               return res.status(400).json({ error: "Job ID is required in URL" });
          }

          const job = await JobModel.findById(id, "jobDescription jobTitle companyName");
          // Return jobDescription, jobTitle, and companyName for context

          if (!job) {
               return res.status(404).json({ error: "Job not found" });
          }

          return res.json({
               jobDescription: job.jobDescription,
               jobTitle: job.jobTitle,
               companyName: job.companyName
          });
     } catch (error) {
          console.error("Error fetching job description by URL:", error);
          return res.status(500).json({ error: "Server error" });
     }
};
// showing the changes made in the user dashboard route
export const saveChangedSession = async (req, res) => {
     try {
          const { id, startingContent, finalChanges, resumeData, checkboxStates } = req.body;

          if (!id || !startingContent) {
               return res.status(400).json({ error: "Job ID and starting content are required" });
          }

          console.log('saveChangedSession - Received ID:', id);

          // Find the job and update it with the new changes
          const changesMade = {
               startingContent,
               finalChanges,
               timestamp: new Date().toLocaleString("en-US", "Asia/Kolkata"),
               changedSections: Object.keys(startingContent)
          };

          // Prepare resume data to save
          const resumeUpdate = {};
          if (resumeData) {
               resumeUpdate.resume = {
                    data: resumeData,
                    checkboxStates: checkboxStates || {
                         showSummary: true,
                         showProjects: false,
                         showLeadership: false
                    }
               };
          }

          // Try both _id and jobID fields
          let updatedJob;
          try {
               // First try with MongoDB _id
               updatedJob = await JobModel.findOneAndUpdate(
                    { _id: id },
                    {
                         changesMade,
                         ...resumeUpdate,
                         updatedAt: new Date().toLocaleString("en-US", "Asia/Kolkata")
                    },
                    { new: true }
               );
          } catch (error) {
               console.log('saveChangedSession - Trying with jobID field for ID:', id);
          }

          // If not found by _id, try with jobID
          if (!updatedJob) {
               updatedJob = await JobModel.findOneAndUpdate(
                    { jobID: id },
                    {
                         changesMade,
                         ...resumeUpdate,
                         updatedAt: new Date().toLocaleString("en-US", "Asia/Kolkata")
                    },
                    { new: true }
               );
          }

          if (!updatedJob) {
               console.log('saveChangedSession - Job not found for ID:', id);
               return res.status(404).json({ error: "Job not found" });
          }

          console.log('saveChangedSession - Changes saved successfully for job:', updatedJob.jobTitle);
          return res.json({ 
               message: "Changes saved successfully", 
               changesMade,
               jobId: id 
          });
     } catch (error) {
          console.error("Error saving changed session:", error);
          return res.status(500).json({ error: "Server error" });
     }
};

// Get a single job by _id or jobID to refresh session storage
export const getJobById = async (req, res) => {
     try {
          const { id } = req.body; // expecting { "id": "..." }

          if (!id) {
               return res.status(400).json({ error: "Job ID is required" });
          }

          console.log('getJobById - Fetching job with ID:', id);

          // Try to find job by both _id and jobID
          let job;
          try {
               // First try with MongoDB _id
               job = await JobModel.findById(id);
          } catch (error) {
               console.log('getJobById - Trying with jobID field for ID:', id);
          }

          // If not found by _id, try with jobID
          if (!job) {
               job = await JobModel.findOne({ jobID: id });
          }

          if (!job) {
               console.log('getJobById - Job not found for ID:', id);
               return res.status(404).json({ error: "Job not found" });
          }

          console.log('getJobById - Job found:', job.jobTitle);

          // Return the job with all fields
          return res.json({ 
               success: true, 
               job: {
                    _id: job._id.toString(),
                    jobID: job.jobID,
                    dateAdded: job.dateAdded,
                    userID: job.userID,
                    jobTitle: job.jobTitle,
                    currentStatus: job.currentStatus,
                    jobDescription: job.jobDescription,
                    joblink: job.joblink,
                    companyName: job.companyName,
                    timeline: job.timeline,
                    createdAt: job.createdAt,
                    updatedAt: job.updatedAt,
                    attachments: job.attachments,
                    changesMade: job.changesMade,
                    operatorName: job.operatorName,
                    operatorEmail: job.operatorEmail,
                    appliedDate: job.appliedDate
               }
          });
     } catch (error) {
          console.error("Error fetching job by ID:", error);
          return res.status(500).json({ error: "Server error" });
     }
};
