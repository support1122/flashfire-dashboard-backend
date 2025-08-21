import mongoose from "mongoose";
const { Schema } = mongoose;

const URL_RE = /^(https?:\/\/)([\w-]+\.)+[\w-]+(\/[^\s]*)?$/i;
const digitsOnly = (v) => (v || "").replace(/\D/g, "");
const trimArray = (arr) =>
  (arr || [])
    .map((s) => (typeof s === "string" ? s.trim() : s))
    .filter(Boolean);

const requiredTrue = {
  validator: (v) => v === true,
  message: "This checkbox must be checked."
};

const UserProfileSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", index: true },

    // ✅ Keep ONE email and make it unique/indexed
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true,
      index: true
    },

    // Personal
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    contactNumber: {
      type: String,
      required: true,
      set: digitsOnly,
      validate: {
        validator: (v) => /^\d{10,15}$/.test(v || ""),
        message: "Contact number must be 10–15 digits."
      }
    },
    dob: { type: Date, required: true },

    // Education
    bachelorsUniDegree: { type: String, required: true, trim: true },
    bachelorsGradMonthYear: { type: Date, required: true },
    mastersUniDegree: { type: String, required: true, trim: true },
    mastersGradMonthYear: { type: Date, required: true },

    // Immigration
    visaStatus: {
      type: String,
      required: true,
      enum: [
        "CPT",
        "F1",
        "F1 OPT",
        "F1 STEM OPT",
        "H1B",
        "Green Card",
        "U.S. Citizen",
        "Other"
      ]
    },
    visaExpiry: { type: Date, required: true },

    // ✅ Address now a single string instead of object
    address: { type: String, trim: true, required: true },

    // Preferences & Experience
    preferredRoles: {
      type: [String],
      required: true,
      default: [],
      set: trimArray,
      validate: [
        {
          validator: (arr) =>
            Array.isArray(arr) && arr.length > 0,
          message: "At least one preferred role is required."
        }
      ]
    },
    experienceLevel: {
      type: String,
      required: true,
      enum: [
        "Entry level",
        "0-2 Years",
        "0-3 Years",
        "0-4 Years",
        "0-5 Years",
        "0-6 Years",
        "0-7 Years",
        "Other"
      ]
    },
    expectedSalaryRange: {
      type: String,
      required: true,
      enum: ["60k-100k", "100k-150k", "150k-200k", "Other"]
    },
    preferredLocations: {
      type: [String],
      required: true,
      set: trimArray,
      validate: [
        {
          validator: (arr) =>
            Array.isArray(arr) && arr.length > 0,
          message: "At least one preferred location is required."
        }
      ]
    },
    targetCompanies: {
      type: [String],
      required: true,
      set: trimArray,
      validate: [
        {
          validator: (arr) =>
            Array.isArray(arr) && arr.length > 0,
          message: "At least one target company is required."
        }
      ]
    },
    reasonForLeaving: { type: String, required: true, trim: true },

    // Links & Documents
    linkedinUrl: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      validate: {
        validator: (v) => URL_RE.test(v),
        message: "LinkedIn URL must be valid (http/https)."
      }
    },
    githubUrl: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      validate: {
        validator: (v) => URL_RE.test(v),
        message: "GitHub URL must be valid (http/https)."
      }
    },
    portfolioUrl: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      validate: {
        validator: (v) => URL_RE.test(v),
        message: "Portfolio URL must be valid (http/https)."
      }
    },
    coverLetterUrl: {
      type: String,
      required: true,
      trim: true,
      validate: {
        validator: (v) => URL_RE.test(v),
        message: "Cover letter URL must be valid (http/https)."
      }
    },
    resumeUrl: {
      type: String,
      required: true,
      trim: true,
      validate: {
        validator: (v) => URL_RE.test(v),
        message: "Resume URL must be valid (http/https)."
      }
    },

    // Consent
    confirmAccuracy: {
      type: Boolean,
      required: true,
      validate: requiredTrue
    },
    agreeTos: {
      type: Boolean,
      required: true,
      validate: requiredTrue
    },

    status: {
      type: String,
      enum: ["new", "in_review", "complete", "rejected"],
      default: "new",
      index: true
    }
  },
  { timestamps: true }
);

// Normalize grad month-year dates
UserProfileSchema.pre("validate", function (next) {
  const toMonthStart = (val) => {
    if (!val) return val;
    if (val instanceof Date) return val;
    if (/^\d{4}-\d{2}(-\d{2})?$/.test(val)) {
      const [y, m] = String(val).split("-").map(Number);
      return new Date(Date.UTC(y, m - 1, 1));
    }
    const d = new Date(val);
    return isNaN(d) ? undefined : d;
  };
  this.bachelorsGradMonthYear = toMonthStart(this.bachelorsGradMonthYear);
  this.mastersGradMonthYear = toMonthStart(this.mastersGradMonthYear);
  next();
});

UserProfileSchema.index({ createdAt: -1 });

export const ProfileModel = mongoose.model("Profiles", UserProfileSchema);
