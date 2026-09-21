import { Schema, model } from 'mongoose';

const ExtensionCodeSchema = new Schema({
  code: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  name: {
    type: String,
    required: true,
    trim: true,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

const ExtensionCode = model('ExtensionCode', ExtensionCodeSchema);
export default ExtensionCode;
