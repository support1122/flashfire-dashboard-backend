import { Schema, model, Types } from 'mongoose';

const OperationsSchema = new Schema({
     name: {
          type: String,
          required: [true, 'Name is required'],
          trim: true,
     },
     email: {
          type: String,
          required: [true, 'Email is required'],
          unique: true,
          lowercase: true,
          trim: true,
          match: [/^[a-zA-Z0-9._%+-]+@flashfirehq$/, 'Please enter a valid @flashfirehq email address'],
     },
     password: {
          type: String,
          required: [true, 'Password is required'],
          minlength: [6, 'Password must be at least 6 characters long'],
     },
     role: {
          type: String,
          required: [true, 'Role is required'],
          enum: ['operations', 'admin'],
     },
     managedUsers: [{
          type: Types.ObjectId,
          ref: 'users', 
     }],
     sessionKeys: [{
          sessionKey: { type: String, required: true }, // 8-digit numeric string
          createdBy: { type: String, default: 'admin' },
          duration: { type: Number, default: 720 }, // hours (30 days)
          target: { type: String, enum: ['optimizer', 'dashboard'], default: 'dashboard' },
          expiresAt: { type: Date, required: true },
          isUsed: { type: Boolean, default: false },
          isActive: { type: Boolean, default: true },
          createdAt: { type: Date, default: Date.now }
     }],
}, {
     timestamps: true, 
});

export default model('Operations', OperationsSchema);
