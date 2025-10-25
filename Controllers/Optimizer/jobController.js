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
          const { id, startingContent, finalChanges, optimizedResume } = req.body;

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

          // Prepare update object
          const updateData = {
               changesMade,
               updatedAt: new Date().toLocaleString("en-US", "Asia/Kolkata")
          };

          // Add optimized resume data if provided
          if (optimizedResume) {
               updateData.optimizedResume = {
                    ...optimizedResume,
                    hasResume: true,
                    createdAt: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
               };
               console.log('saveChangedSession - Adding optimized resume data with hasResume: true and timestamp');
          }

          // Try both _id and jobID fields
          let updatedJob;
          try {
               // First try with MongoDB _id
               updatedJob = await JobModel.findOneAndUpdate(
                    { _id: id },
                    updateData,
                    { new: true }
               );
          } catch (error) {
               console.log('saveChangedSession - Trying with jobID field for ID:', id);
          }

          // If not found by _id, try with jobID
          if (!updatedJob) {
               updatedJob = await JobModel.findOneAndUpdate(
                    { jobID: id },
                    updateData,
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

// Get optimized resume data by job ID
export const getOptimizedResume = async (req, res) => {
     try {
          const { jobId } = req.params;

          if (!jobId) {
               return res.status(400).json({ error: "Job ID is required" });
          }

          console.log('getOptimizedResume - Fetching resume for job ID:', jobId);

          let job = null;
          
          // First try to find by jobID field (string)
          try {
               job = await JobModel.findOne({ jobID: jobId }).select('optimizedResume');
               if (job) {
                    console.log('getOptimizedResume - Found job by jobID field');
               }
          } catch (error) {
               console.log('getOptimizedResume - Error searching by jobID:', error.message);
          }
          
          // If not found by jobID, try by _id (ObjectId) only if it looks like a valid ObjectId
          if (!job && jobId.length === 24 && /^[0-9a-fA-F]{24}$/.test(jobId)) {
               try {
                    job = await JobModel.findOne({ _id: jobId }).select('optimizedResume');
                    if (job) {
                         console.log('getOptimizedResume - Found job by _id field');
                    }
               } catch (error) {
                    console.log('getOptimizedResume - Error searching by _id:', error.message);
               }
          }

          if (!job) {
               console.log('getOptimizedResume - Job not found for ID:', jobId);
               return res.status(404).json({ error: "Job not found" });
          }

          if (!job.optimizedResume || !job.optimizedResume.resumeData) {
               console.log('getOptimizedResume - No optimized resume found for job:', jobId);
               return res.status(404).json({ error: "No optimized resume found for this job" });
          }

          console.log('getOptimizedResume - Resume data found for job:', jobId);
          return res.status(200).json({
               success: true,
               optimizedResume: job.optimizedResume
          });

     } catch (error) {
          console.error("Error fetching optimized resume:", error);
          return res.status(500).json({ error: "Server error" });
     }
};

// Get all jobs with optimized resumes for Documents section
export const getJobsWithOptimizedResumes = async (req, res) => {
     try {
          const userEmail = req.body?.email || req.body?.userDetails?.email || req.email;
          
          if (!userEmail) {
               return res.status(400).json({ error: "User email not found" });
          }

          console.log('getJobsWithOptimizedResumes - User email:', userEmail);

          // Find jobs that have optimized resumes
          const jobsWithResumes = await JobModel.find({ 
               userID: userEmail,
               'optimizedResume.hasResume': true 
          })
          .select('jobTitle companyName jobID joblink optimizedResume.hasResume optimizedResume.version optimizedResume.createdAt updatedAt createdAt')
          .lean();

          // Format the data for the Documents section
          const optimizedResumes = jobsWithResumes.map(job => ({
               id: job._id.toString(),
               jobID: job.jobID,
               title: `${job.jobTitle} at ${job.companyName}`,
               jobRole: job.jobTitle,
               companyName: job.companyName,
               jobLink: job.joblink || '#',
               createdAt: job.optimizedResume.createdAt || job.updatedAt || job.createdAt,
               category: 'Resume',
               version: job.optimizedResume.version,
               hasResume: job.optimizedResume.hasResume
          }));

          console.log(`getJobsWithOptimizedResumes - Found ${optimizedResumes.length} jobs with optimized resumes`);

          return res.status(200).json({
               success: true,
               optimizedResumes,
               count: optimizedResumes.length
          });

     } catch (error) {
          console.error("Error fetching jobs with optimized resumes:", error);
          return res.status(500).json({ error: "Server error" });
     }
};

// New endpoint specifically for Documents tab - gets all optimized resumes with full details
export const getOptimizedResumesForDocuments = async (req, res) => {
     try {
          const userEmail = req.body?.email || req.body?.userDetails?.email || req.email;
          
          if (!userEmail) {
               return res.status(400).json({ error: "User email not found" });
          }

          console.log('getOptimizedResumesForDocuments - User email:', userEmail);

          // Find jobs that have optimized resumes with full details
          const jobsWithResumes = await JobModel.find({ 
               userID: userEmail,
               'optimizedResume.hasResume': true 
          })
          .select('jobTitle companyName jobID joblink optimizedResume updatedAt createdAt')
          .sort({ 'optimizedResume.createdAt': -1, 'updatedAt': -1, 'createdAt': -1 }) // Sort by most recent first
          .lean();

          // Format the data for the Documents section with all details
          const optimizedResumes = jobsWithResumes.map(job => {
               // Handle date formatting - convert to ISO string if needed
               let createdAt = job.optimizedResume.createdAt || job.updatedAt || job.createdAt;
               
               // If createdAt is a string in DD/MM/YYYY format, convert it to ISO
               if (typeof createdAt === 'string' && createdAt.includes('/')) {
                    try {
                         // Parse DD/MM/YYYY, HH:MM:SS am/pm format
                         const parts = createdAt.split(', ');
                         if (parts.length === 2) {
                              const datePart = parts[0]; // "25/10/2025"
                              const timePart = parts[1]; // "1:46:11 pm"
                              
                              const [day, month, year] = datePart.split('/');
                              const [time, ampm] = timePart.split(' ');
                              const [hours, minutes, seconds] = time.split(':');
                              
                              let hour24 = parseInt(hours);
                              if (ampm.toLowerCase() === 'pm' && hour24 !== 12) {
                                   hour24 += 12;
                              } else if (ampm.toLowerCase() === 'am' && hour24 === 12) {
                                   hour24 = 0;
                              }
                              
                              const isoDate = new Date(year, month - 1, day, hour24, minutes, seconds).toISOString();
                              createdAt = isoDate;
                         }
                    } catch (error) {
                         console.error('Error parsing date:', createdAt, error);
                         // Fallback to current date
                         createdAt = new Date().toISOString();
                    }
               }
               
               return {
                    id: job._id.toString(),
                    jobID: job.jobID,
                    title: `${job.jobTitle} at ${job.companyName}`,
                    jobRole: job.jobTitle,
                    companyName: job.companyName,
                    jobLink: job.joblink || '#',
                    createdAt: createdAt,
                    category: 'Resume',
                    version: job.optimizedResume.version || 0,
                    hasResume: job.optimizedResume.hasResume,
                    isJobBased: true, // This is a job-based resume
                    resumeData: job.optimizedResume.resumeData,
                    showSummary: job.optimizedResume.showSummary,
                    showProjects: job.optimizedResume.showProjects,
                    showLeadership: job.optimizedResume.showLeadership,
                    showPublications: job.optimizedResume.showPublications
               };
          });

          console.log(`getOptimizedResumesForDocuments - Found ${optimizedResumes.length} jobs with optimized resumes`);

          return res.status(200).json({
               success: true,
               optimizedResumes,
               count: optimizedResumes.length
          });

     } catch (error) {
          console.error("Error fetching optimized resumes for documents:", error);
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
