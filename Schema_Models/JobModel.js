import  mongoose  from "mongoose";
export const JobSchema = new mongoose.Schema({
  jobID: {
    type: String,
    required: true,
    // unique: true,
    default : ()=>Date.now().toString()
  },
  dateAdded:{
    type : String,
    required : true,
    default: () =>String(new Date().toLocaleString())
  },
  userID:{
    type: String,
    required : true,
    default : 'www.userID.com'
  },
  jobTitle : {
    type : String,
    required : true ,
    default : 'www.jobTitle.com'
  },
  currentStatus : {
    type : String,
    required : true,
    default : 'saved'
  },
  jobDescription: {
    type: String,
    required: false,
    default : ''
  },
  joblink:{
    type : String,
    required : false,
    default : ''
  },
  companyName: {
    type: String,
    required: true,
    default : 'unknown'
  },
  timeline:{
    type : [String],
    required : true,
    default : ['Added']
  },
  createdAt : {
    type : String,
    default : () =>new Date().toLocaleString('en-US', 'Asia/Kolkata'),
    required : true,
    immutable : true
  },
  updatedAt:{
    type : String,
    required : true ,
    default : () =>new Date().toLocaleString('en-US', 'Asia/Kolkata')   
  },
  attachments : {
    type : [String],
    required : true,
    default : []

  }
});

export const JobModel = mongoose.model('JobDB', JobSchema)