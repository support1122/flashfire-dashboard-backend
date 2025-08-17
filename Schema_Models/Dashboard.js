// import mongoose from 'mongoose';
// import { JobSchema } from './JobModel.js';
// export const dashboardSchema = new mongoose.Schema({
//   job: {
//     type: JobSchema,
//     required: true 
//   },
//   currentStatus: {
//     type: String,
//     enum: ['Saved', 'Applied', 'Short-listed', 'Interviews', 'Rejected'],
//     required: true,
//     defalut : 'Saved'
//   }
// }, {
//   timeline:{
//     type : [String],
//     required : [true],
//     default : new Date().toISOString()
//   }
// });

// export const DashboardModel = mongoose.model('Dashboard', dashboardSchema);
