/**
 * Application configuration
 */
export const config = {
  // API configuration
  api: {
    baseUrl: 'http://localhost:8080/api',
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