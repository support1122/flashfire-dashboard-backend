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
}, {
     timestamps: true, 
});

export default model('Operations', OperationsSchema);
