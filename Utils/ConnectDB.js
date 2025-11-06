import mongoose from "mongoose";
import dotenv from 'dotenv'
dotenv.config();

// Harden Mongoose connection to avoid silent buffering and long hangs
mongoose.set('strictQuery', false);
mongoose.set('bufferCommands', false);

const Connection = async () => {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
        throw new Error('❌ MONGODB_URI is not set in environment variables');
    }

    // Validate URI format
    if (!uri.startsWith('mongodb://') && !uri.startsWith('mongodb+srv://')) {
        throw new Error('❌ MONGODB_URI must start with mongodb:// or mongodb+srv://');
    }

    console.log('🔌 Attempting to connect to MongoDB...');
    console.log(`📍 Connection type: ${uri.startsWith('mongodb+srv://') ? 'SRV (Atlas)' : 'Standard'}`);

    try {
        await mongoose.connect(uri, {
            serverSelectionTimeoutMS: 30000,
            socketTimeoutMS: 45000,
            maxPoolSize: 10,
        });
        console.log("✅ Database connected successfully!");
    } catch (e) {
        console.error('❌ Problem while connecting to MongoDB:');
        console.error(e);
        
        // Provide helpful error messages based on error type
        // if (e.code === 'ENOTFOUND') {
        //     console.error('\n💡 DNS RESOLUTION FAILED - MONGODB_URI HOST IS INCORRECT');
        //     console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        //     console.error('The hostname in your MONGODB_URI cannot be found.');
        //     console.error('\n📋 TO FIX THIS:');
        //     console.error('1. Go to MongoDB Atlas → https://cloud.mongodb.com/');
        //     console.error('2. Click "Connect" on your cluster');
        //     console.error('3. Choose "Connect your application"');
        //     console.error('4. Copy the FULL connection string (looks like):');
        //     console.error('   mongodb+srv://<username>:<password>@cluster0.xxxxx.mongodb.net/<database>?retryWrites=true&w=majority');
        //     console.error('\n5. In Render.com dashboard:');
        //     console.error('   → Go to your service → Environment');
        //     console.error('   → Update MONGODB_URI with the EXACT string from Atlas');
        //     console.error('   → Replace <username> with your DB username');
        //     console.error('   → Replace <password> with your DB password');
        //     console.error('   → Replace <database> with your database name (e.g., flashfire)');
        //     console.error('   → Save and redeploy');
        //     console.error('\n⚠️  COMMON MISTAKE: Using "replica.xxxxx.mongodb.net"');
        //     console.error('   ✓ CORRECT: "cluster0.xxxxx.mongodb.net" (or your actual cluster name)');
        //     console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        // } else if (e.name === 'MongoServerError' && e.message.includes('auth')) {
        //     console.error('\n💡 AUTHENTICATION FAILED');
        //     console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        //     console.error('Your database username or password is incorrect.');
        //     console.error('Check your MONGODB_URI credentials in Render environment variables.');
        //     console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        // } else if (e.message.includes('ETIMEDOUT') || e.message.includes('ECONNREFUSED')) {
        //     console.error('\n💡 NETWORK ACCESS BLOCKED');
        //     console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        //     console.error('MongoDB Atlas is blocking the connection.');
        //     console.error('\n📋 TO FIX THIS:');
        //     console.error('1. Go to MongoDB Atlas → Network Access');
        //     console.error('2. Click "Add IP Address"');
        //     console.error('3. Either:');
        //     console.error('   → Add 0.0.0.0/0 (allows all IPs - for testing)');
        //     console.error('   → Add your Render service\'s outbound IPs');
        //     console.error('4. Click "Confirm"');
        //     console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        // }
        
        throw e;
    }
}

export default Connection