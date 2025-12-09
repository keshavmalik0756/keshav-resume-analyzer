/**
 * Application configuration
 */
export const config = {
  // API configuration
  api: {
    baseUrl: process.env.REACT_APP_API_BASE_URL || (process.env.NODE_ENV === 'production' 
      ? 'https://keshav-resume-analyzer-backend.onrender.com/api'  // Update this to your actual backend URL
      : 'http://localhost:8080/api'),
    timeout: 30000, // 30 seconds
  },

  // File upload configuration
  upload: {
    maxSize: 10 * 1024 * 1024, // 10MB in bytes
    acceptedTypes: ['.pdf', 'application/pdf'],
  },

  // SSE configuration
  sse: {
    reconnectInterval: 1000, // 1 second
    maxRetries: 3,
  }
};