import mongoose from "mongoose";
import dotenv from 'dotenv'
dotenv.config();
//connection to db ..
const ConnectDB = () => mongoose.connect(process.env.MONGODB_URI)
                    .then(() => console.log("✅ Database connected successfully"))
                                .catch((error) => {
                                    console.error("❌ Database connection failed:", error);
                                    process.exit(1);
                                });;

export default ConnectDB;