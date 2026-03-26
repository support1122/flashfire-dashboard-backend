import mongoose from "mongoose";

const ClientTodosSchema = new mongoose.Schema({
  clientEmail: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  todos: [{
    id: {
      type: String,
      required: true
    },
    title: {
      type: String,
      required: true,
      trim: true
    },
    notes: {
      type: String,
      default: "",
      trim: true
    },
    completed: {
      type: Boolean,
      default: false
    },
    createdBy: {
      type: String,
      default: ""
    },
    createdAt: {
      type: String,
      default: () => new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
    },
    updatedAt: {
      type: String,
      default: () => new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
    }
  }],
  excludedCompanies: {
    type: [String],
    default: []
  },
  excludedLocations: {
    type: [String],
    default: []
  },
  exclusionSanitizeAudit: [{
    text: { type: String, default: "" },
    kind: { type: String, enum: ["company", "location"], default: "company" },
    reason: { type: String, default: "" },
    removedAt: { type: String, default: "" }
  }],
  lockPeriods: [{
    id: {
      type: String,
      required: true
    },
    startDate: {
      type: String,
      required: true
    },
    endDate: {
      type: String,
      required: true
    },
    reason: {
      type: String,
      default: ""
    },
    createdAt: {
      type: String,
      default: () => new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
    }
  }],
  createdAt: {
    type: String,
    default: () => new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
  },
  updatedAt: {
    type: String,
    default: () => new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
  }
}, {
  timestamps: false
});

export const ClientTodosModel = mongoose.models.ClientTodos || mongoose.model('ClientTodos', ClientTodosSchema);

