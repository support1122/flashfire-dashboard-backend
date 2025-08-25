import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import connectDB from "./Utils/ConnectDB.js";
import Routes from "./Routes.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8001;
const NODE_ENV = process.env.NODE_ENV || "development";

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:", "blob:"],
      scriptSrc: ["'self'"],
      connectSrc: ["'self'", "https://api.cloudinary.com", "https://api.openai.com"],
    },
  },
}));

// CORS configuration
const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = NODE_ENV === "production" 
      ? [
          "https://portal.flashfirejobs.com",
          "https://www.portal.flashfirejobs.com",
          "https://flashfire-dashboard-frontend.vercel.app",
          "https://flashfire-dashboard.vercel.app",
          ...(process.env.ALLOWED_ORIGINS?.split(",") || [])
        ]
      : ["http://localhost:3000", "http://localhost:5173"];
    
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.log(`CORS blocked origin: ${origin}`);
      console.log(`Allowed origins: ${allowedOrigins.join(', ')}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  optionsSuccessStatus: 200,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
};

app.use(cors(corsOptions));

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100, // limit each IP to 100 requests per windowMs
  message: {
    error: "Too many requests from this IP, please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(limiter);

// Body parsing middleware
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Request logging middleware (only in development or for important routes)
if (NODE_ENV === "development") {
  app.use((req, res, next) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${req.method} ${req.path} - ${req.ip}`);
    next();
  });
}

// Routes
app.use("/", Routes);

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ 
    status: "OK", 
    message: "Server is running",
    environment: NODE_ENV,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    port: PORT
  });
});

// Root endpoint for Render health checks
app.get("/", (req, res) => {
  res.json({ 
    message: "FlashFire Dashboard API",
    status: "running",
    environment: NODE_ENV,
    timestamp: new Date().toISOString()
  });
});

// 404 handler
app.use("*", (req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error("Global error handler:", err);
  
  const statusCode = err.statusCode || 500;
  const message = NODE_ENV === "production" 
    ? "Internal server error" 
    : err.message || "Something went wrong";
  
  res.status(statusCode).json({
    error: message,
    ...(NODE_ENV === "development" && { stack: err.stack })
  });
});

// Connect to database
connectDB().then(() => {
  console.log("✅ Database connected successfully");
}).catch((error) => {
  console.error("❌ Database connection failed:", error);
  process.exit(1);
});

app.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT} in ${NODE_ENV} mode`);
  console.log(`📊 Health check available at http://localhost:${PORT}/health`);
  console.log(`🌐 API available at http://localhost:${PORT}`);
});
