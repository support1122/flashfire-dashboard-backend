import mongoose from "mongoose";
import dotenv from 'dotenv'
dotenv.config();

// Harden Mongoose connection to avoid silent buffering and long hangs
mongoose.set('strictQuery', false);
mongoose.set('bufferCommands', false);

// Connection retry configuration
const MAX_RETRIES = 3;
const RETRY_DELAY = 5000; // 5 seconds

// Monitor connection pool health
const logConnectionStatus = () => {
    const state = mongoose.connection.readyState;
    const states = {
        0: 'disconnected',
        1: 'connected',
        2: 'connecting',
        3: 'disconnecting'
    };
    const poolSize = mongoose.connection.db?.serverConfig?.poolSize || 'unknown';
    console.log(`📊 MongoDB Connection Status: ${states[state] || 'unknown'} | Pool Size: ${poolSize}`);
};

// Set up connection event listeners
mongoose.connection.on('connected', () => {
    console.log('✅ MongoDB connection established');
    logConnectionStatus();
});

mongoose.connection.on('error', (err) => {
    console.error('❌ MongoDB connection error:', err.message);
    logConnectionStatus();
});

mongoose.connection.on('disconnected', () => {
    console.warn('⚠️  MongoDB disconnected');
    logConnectionStatus();
});

mongoose.connection.on('reconnected', () => {
    console.log('🔄 MongoDB reconnected');
    logConnectionStatus();
});

const Connection = async (retryCount = 0) => {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
        throw new Error('❌ MONGODB_URI is not set in environment variables');
    }

    // Validate URI format
    if (!uri.startsWith('mongodb://') && !uri.startsWith('mongodb+srv://')) {
        throw new Error('❌ MONGODB_URI must start with mongodb:// or mongodb+srv://');
    }

    // Extract host from URI for logging (without credentials)
    const uriMatch = uri.match(/@([^/]+)/);
    const host = uriMatch ? uriMatch[1] : 'unknown';
    
    console.log(`🔌 Attempting to connect to MongoDB... (Attempt ${retryCount + 1}/${MAX_RETRIES + 1})`);
    console.log(`📍 Host: ${host}`);
    console.log(`📍 Connection type: ${uri.startsWith('mongodb+srv://') ? 'SRV (Atlas)' : 'Standard'}`);

    try {
        // Improved connection options for better reliability
        await mongoose.connect(uri, {
            serverSelectionTimeoutMS: 60000, // Increased to 60 seconds
            socketTimeoutMS: 90000, // Increased to 90 seconds
            connectTimeoutMS: 60000, // Connection timeout
            maxPoolSize: 10, // Maximum number of connections in the pool
            minPoolSize: 2, // Minimum number of connections to maintain
            maxIdleTimeMS: 30000, // Close connections after 30 seconds of inactivity
            heartbeatFrequencyMS: 10000, // Check server status every 10 seconds
            retryWrites: true,
            retryReads: true,
            // Auto-reconnect settings
            autoIndex: true,
            // Buffer settings
            bufferMaxEntries: 0, // Disable mongoose buffering
            bufferCommands: false,
        });
        
        console.log("✅ Database connected successfully!");
        logConnectionStatus();
        
        // Set up periodic health check
        setInterval(() => {
            if (mongoose.connection.readyState !== 1) {
                console.warn('⚠️  MongoDB connection health check: NOT CONNECTED');
            }
        }, 30000); // Check every 30 seconds
        
    } catch (e) {
        console.error('❌ Problem while connecting to MongoDB:');
        console.error(`   Error: ${e.name || 'Unknown'}`);
        console.error(`   Message: ${e.message}`);
        
        // Check if it's a network timeout error
        if (e.name === 'MongoNetworkTimeoutError' || e.message.includes('timed out')) {
            console.error('\n💡 NETWORK TIMEOUT ERROR DETECTED');
            console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.error('Possible causes:');
            console.error('1. MongoDB server is unreachable or down');
            console.error('2. Network connectivity issues');
            console.error('3. Server overloaded or throttled');
            console.error('4. Payment/billing issues causing server suspension');
            console.error('5. Firewall blocking connections');
            console.error('\n📋 TO TROUBLESHOOT:');
            console.error('1. Check MongoDB server status and billing');
            console.error('2. Verify network connectivity from Render to MongoDB server');
            console.error('3. Check firewall rules allow connections from Render IPs');
            console.error('4. Verify MongoDB server is running and accessible');
            console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
            
            // Retry logic for network timeouts
            if (retryCount < MAX_RETRIES) {
                console.log(`⏳ Retrying connection in ${RETRY_DELAY / 1000} seconds...`);
                await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
                return Connection(retryCount + 1);
            } else {
                console.error(`❌ Max retries (${MAX_RETRIES}) reached. Giving up.`);
            }
        } else if (e.code === 'ENOTFOUND') {
            console.error('\n💡 DNS RESOLUTION FAILED');
            console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.error('The MongoDB hostname cannot be resolved.');
            console.error('Check your MONGODB_URI hostname is correct.');
            console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        } else if (e.name === 'MongoServerError' && e.message.includes('auth')) {
            console.error('\n💡 AUTHENTICATION FAILED');
            console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.error('Database username or password is incorrect.');
            console.error('Check your MONGODB_URI credentials.');
            console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        }
        
        throw e;
    }
}

export default Connection
