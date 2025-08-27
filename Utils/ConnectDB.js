import mongoose from "mongoose";
import dotenv from 'dotenv'
dotenv.config();
//connection to db ..
const ConnectDB = () => mongoose.connect(process.env.MONGODB_URI, {
                                                                    maxPoolSize: 10,
                                                                    minPoolSize: 1,
                                                                    // Keep idle pooled connections up to 24h before pool closes them
                                                                    maxIdleTimeMS: 86_400_000,
                                                                    // Allow long-running operations / idle socket without killing it
                                                                    socketTimeoutMS: 86_400_000,     // (0 means "no timeout" but can mask hangs; 24h is safer)
                                                                    // How long to try to find a server if cluster momentarily unavailable
                                                                    serverSelectionTimeoutMS: 10_000,
                                                                    // (optional) heartbeatFrequencyMS: 10000,
                                                                    })
                    .then(() => console.log("✅ Database connected successfully"))
                                .catch((error) => {
                                    console.error("❌ Database connection failed:", error);
                                    process.exit(1);
                                });;

export default ConnectDB;