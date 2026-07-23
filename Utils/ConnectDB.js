import mongoose from "mongoose";
import dotenv from 'dotenv'
dotenv.config();

// Surface connection drops in the logs so outages are diagnosable from Render.
mongoose.connection.on('disconnected', () => console.error('[mongo] connection lost'));
mongoose.connection.on('reconnected', () => console.log('[mongo] reconnected'));

// No .catch here on purpose: a failed initial connect must reject so index.js
// logs it and exits — the platform then restarts the process. Swallowing the
// error left a zombie server running with no database, answering 503 forever.
const Connection = () => mongoose.connect(process.env.MONGODB_URI, {
                              serverSelectionTimeoutMS: 10000,
                              maxPoolSize: 20,
                         })
                    .then(()=>console.log("Database connected succesfully..!"))

export default Connection
