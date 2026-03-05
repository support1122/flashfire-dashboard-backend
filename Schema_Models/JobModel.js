import mongoose from "mongoose";
export const JobSchema = new mongoose.Schema({
  jobID: {
    type: String,
    required: true,
    // unique: true,
    default: () => Date.now().toString()
  },
  dateAdded: {
    type: String,
    required: true,
    default: () => String(new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }))
  },
  userID: {
    type: String,
    required: true,
    default: 'www.userID.com'
  },
  jobTitle: {
    type: String,
    required: true,
    default: 'www.jobTitle.com'
  },
  currentStatus: {
    type: String,
    required: true,
    default: 'saved'
  },
  jobDescription: {
    type: String,
    required: false,
    default: ''
  },
  joblink: {
    type: String,
    required: false,
    default: ''
  },
  companyName: {
    type: String,
    required: true,
    default: 'unknown'
  },
  timeline: {
    type: [String],
    required: true,
    default: ['Added']
  },
  createdAt: {
    type: String,
    default: () => new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
    required: true,
    immutable: true
  },
  updatedAt: {
    type: String,
    required: true,
    default: () => new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
  },
  attachments: {
    type: [String],
    required: true,
    default: [],
    attachedAt : () => new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
  },
  changesMade: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
  downloaded:{
    type: Boolean,
    default: false
  },
  operatorName: {
    type: String,
    required: false,
    default: 'user'
  },
  operatorEmail: {
    type: String,
    required: false,
    default: 'user@flashfirehq'
  },
  appliedDate: {
    type: String,
    required: false,
    default: null
  },
  removalReason: {
    type: String,
    required: false,
    default: null
  },
  removalDate: {
    type: String,
    required: false,
    default: null
  },
  removedBy: {
    type: String,
    required: false,
    default: null
  },
  optimizedResume: {
    // R2 storage key for resume data (replaces heavy resumeData field)
    resumeDataKey: {
      type: String,
      default: null
    },
    // Legacy field - kept for backward compatibility with old records
    // resumeData: {
    //   type: mongoose.Schema.Types.Mixed,
    //   default: null
    // },
    hasResume: {
      type: Boolean,
      default: false
    },
    showSummary: {
      type: Boolean,
      default: true
    },
    showProjects: {
      type: Boolean,
      default: false
    },
    showLeadership: {
      type: Boolean,
      default: true
    },
    showPublications: {
      type: Boolean,
      default: false
    },
    sectionOrder: {
      type: [String],
      default: [
        "personalInfo",
        "summary", 
        "workExperience",
        "projects",
        "leadership",
        "skills",
        "education",
        "publications"
      ]
    },
    version: {
      type: Number,
      default: 0
    },
    createdAt: {
      type: String,
      default: () => new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
    },
    // Flag to indicate if data is stored in R2 or MongoDB
    storageType: {
      type: String,
      enum: ['r2', 'mongodb', 'legacy'],
      default: 'legacy'
    }
  },
  // Whether the optimized resume has been viewed by operations
  optimizedResumeSeen: { type: Boolean, default: false },
  // Auto-optimization tracking (background worker)
  autoOptimization: {
    status: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'failed', 'skipped'],
      default: null
    },
    attempts: { type: Number, default: 0 },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    lastFailedAt: { type: Date, default: null },
    retryAfter: { type: Date, default: null },
    error: { type: String, default: null }
  }
});

// Performance indexes for fast per-user queries and recent-first sorting
JobSchema.index({ userID: 1, _id: -1 });
JobSchema.index({ operatorEmail: 1, _id: -1 });
JobSchema.index({ currentStatus: 1 });
JobSchema.index({ jobID: 1 });
JobSchema.index({ jobID: 1, userID: 1 });
// Index for sorting by most recently updated (for job tracker) - kept for backward compatibility
JobSchema.index({ userID: 1, updatedAt: -1 });
JobSchema.index({ userID: 1, dateAdded: -1 });
// Index for auto-optimization worker polling
JobSchema.index({ 'autoOptimization.status': 1, 'autoOptimization.retryAfter': 1, _id: 1 });

export const JobModel = mongoose.model('JobDB', JobSchema)


