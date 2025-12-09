const express = require("express");
const cors = require("cors");
require("dotenv").config();

// Import routes
const uploadRoutes = require("./routes/upload");
const sseRoutes = require("./routes/sse");
const processRoutes = require("./routes/process");

// Import services for graceful shutdown
const sseManager = require("./services/sseManager");

const app = express();
const PORT = process.env.PORT || 8080;

// Configure CORS to allow multiple frontend origins
app.use(
  cors({
    origin: [
      process.env.FRONTEND_URL || "http://localhost:5173", 
      "http://localhost:5174",
      "http://127.0.0.1:5173",
      "http://127.0.0.1:5174",
      "https://keshav-resume-analyzer.onrender.com"
    ],
    credentials: true,
    optionsSuccessStatus: 200
  })
);

// Configure JSON parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Basic health check endpoint
app.get("/", (req, res) => {
  res.json({
    message: "Resume Analyzer API is running",
    status: "healthy",
    timestamp: new Date().toISOString(),
  });
});

// API routes
app.use("/api", uploadRoutes);
app.use("/api", sseRoutes);
app.use("/api", processRoutes);

// Serve static files from dist directory (after API routes)
// On Vercel, static files are served from public directory
app.use(express.static(process.env.VERCEL ? 'public' : 'dist'));

// Global error handling middleware
app.use((error, req, res, next) => {
  console.error("Server error:", error);
  res.status(500).json({ 
    error: "Internal server error",
    code: "INTERNAL_ERROR",
    message: error.message || "An unexpected error occurred"
  });
});

// 404 handler for unmatched routes
app.use((req, res) => {
  res.status(404).json({
    error: "Endpoint not found",
    code: "NOT_FOUND",
    path: req.originalUrl
  });
});

const server = app.listen(PORT, () => {
  console.log(`Resume Analyzer API server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
  console.log(`CORS enabled for origins: http://localhost:5173, http://localhost:5174, https://keshav-resume-analyzer.onrender.com`);
});

// Graceful shutdown handling
const gracefulShutdown = (signal) => {
  console.log(`Received ${signal}. Starting graceful shutdown...`);
  
  // Close SSE connections
  sseManager.shutdown();
  
  // Close HTTP server
  server.close((err) => {
    if (err) {
      console.error('Error during server shutdown:', err);
      process.exit(1);
    }
    
    console.log('Server shut down gracefully');
    process.exit(0);
  });
  
  // Force shutdown after 10 seconds
  setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
};

// Handle shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  gracefulShutdown('unhandledRejection');
});