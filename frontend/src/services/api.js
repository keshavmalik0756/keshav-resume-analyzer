import { config } from '@/config';

/**
 * API error class for handling API-specific errors
 */
export class APIError extends Error {
  constructor(message, code, status) {
    super(message);
    this.name = 'APIError';
    this.code = code;
    this.status = status;
  }
}

/**
 * Resume API service
 */
export const resumeAPI = {
  /**
   * Upload and process a resume file
   * @param {File} file - The resume file to upload
   * @returns {Promise<{sessionId: string}>}
   */
  uploadAndProcess: async (file) => {
    try {
      const formData = new FormData();
      formData.append('resume', file);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), config.api.timeout);

      const response = await fetch(`${config.api.baseUrl}/upload-and-process`, {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new APIError(
          error.error || `Server error: ${response.status}`,
          error.code,
          response.status
        );
      }

      return await response.json();
    } catch (err) {
      if (err instanceof APIError) throw err;

      // Handle specific error types
      if (err.name === 'AbortError') {
        throw new APIError('Upload timeout. Please check your connection and try again.', 'TIMEOUT');
      }
      
      if (err.message.includes('NetworkError') || err.message.includes('Failed to fetch')) {
        throw new APIError('Network error. Please check your internet connection and ensure the backend server is running.', 'NETWORK_ERROR');
      }

      throw new APIError(err.message || 'Upload failed', 'UNKNOWN_ERROR');
    }
  },

  /**
   * Create SSE connection for real-time updates
   * @param {string} sessionId - The session ID to connect to
   * @returns {EventSource}
   */
  createEventSource: (sessionId) => {
    // Add retry mechanism for SSE connection
    const url = `${config.api.baseUrl}/events/${sessionId}`;
    console.log(`Creating SSE connection to: ${url}`);
    return new EventSource(url);
  },

  /**
   * Get session status
   * @param {string} sessionId - The session ID to check
   * @returns {Promise<Object>}
   */
  getSessionStatus: async (sessionId) => {
    try {
      const response = await fetch(`${config.api.baseUrl}/events/${sessionId}/status`);
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new APIError(
          error.error || `Failed to get session status: ${response.status}`,
          error.code,
          response.status
        );
      }

      return await response.json();
    } catch (err) {
      if (err instanceof APIError) throw err;
      throw new APIError('Failed to check session status. Please ensure the backend server is running.', 'STATUS_CHECK_ERROR');
    }
  },

  /**
   * Retry analysis for a session
   * @param {string} sessionId - The session ID to retry
   * @returns {Promise<Object>}
   */
  retryAnalysis: async (sessionId) => {
    try {
      const response = await fetch(`${config.api.baseUrl}/events/${sessionId}/retry`, {
        method: 'POST'
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new APIError(
          error.error || 'Retry request failed',
          error.code,
          response.status
        );
      }

      return await response.json();
    } catch (err) {
      if (err instanceof APIError) throw err;
      throw new APIError('Failed to retry processing. Please ensure the backend server is running.', 'RETRY_ERROR');
    }
  }
};