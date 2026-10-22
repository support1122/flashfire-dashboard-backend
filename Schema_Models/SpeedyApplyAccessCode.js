import mongoose from "mongoose";

// One current SpeedyApply access code per client (see Utils/speedyApplyAccess.js).
// The code is shown on the client's dashboard, so it is stored encrypted
// (Utils/CryptoHelper.js), not hashed. `version` goes up on every new code;
// extension tokens carry the version they were signed with, so a new code ends
// every older session.
const SpeedyApplyAccessCodeSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    codeEnc: { type: String, required: true },
    version: { type: Number, required: true, default: 1 },
    issuedAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
  },
  { collection: "speedyapplyaccesscodes" }
);

export const SpeedyApplyAccessCode = mongoose.model("SpeedyApplyAccessCode", SpeedyApplyAccessCodeSchema);
