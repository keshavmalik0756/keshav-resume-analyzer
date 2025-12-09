const { v4: uuidv4 } = require("uuid");

/**
 * Session Management System
 * Handles in-memory session storage with status tracking, cleanup, and expiration
 */
class SessionManager {
  constructor() {
    this.sessions = new Map();
    this.cleanupInterval = null;
    this.defaultExpirationTime = 60 * 60 * 1000; // 60 minutes in milliseconds (extended for better UX)

    // Start cleanup process
    this.startCleanupProcess();
  }

  /**
   * Create a new session with unique ID
   * @param {Object} initialData - Initial session data
   * @returns {string} - Session ID
   */
  createSession(initialData = {}) {
    // Use provided sessionId if available, otherwise generate a new one
    const sessionId = initialData.sessionId || uuidv4();
    const now = new Date();

    const session = {
      sessionId,
      status: "created",
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(now.getTime() + this.defaultExpirationTime),
      retryCount: 0,
      ...initialData,
    };

    this.sessions.set(sessionId, session);
    console.log(`[SESSION] Created session: ${sessionId}, total sessions: ${this.sessions.size}`);
    return sessionId;
  }

  /**
   * Retrieve session by ID
   * @param {string} sessionId - Session ID
   * @returns {Object|null} - Session data or null if not found
   */
  getSession(sessionId) {
    if (!sessionId || typeof sessionId !== "string") {
      console.log(`[SESSION] Invalid session ID provided: ${sessionId}`);
      return null;
    }

    const session = this.sessions.get(sessionId);
    console.log(`[SESSION] Retrieving session ${sessionId}, found in map: ${!!session}`);

    if (!session) {
      console.log(`[SESSION] Session not found: ${sessionId}, available sessions: ${Array.from(this.sessions.keys()).join(', ')}`);
      return null;
    }

    // Check if session has expired
    if (this.isSessionExpired(session)) {
      console.log(`[SESSION] Session expired: ${sessionId}`);
      this.deleteSession(sessionId);
      return null;
    }

    return { ...session }; // Return a copy to prevent external modifications
  }

  /**
   * Update session data
   * @param {string} sessionId - Session ID
   * @param {Object} updateData - Data to update
   * @returns {boolean} - Success status
   */
  updateSession(sessionId, updateData) {
    if (!sessionId || typeof sessionId !== "string") {
      return false;
    }

    const session = this.sessions.get(sessionId);

    if (!session || this.isSessionExpired(session)) {
      return false;
    }

    // Update session data
    const updatedSession = {
      ...session,
      ...updateData,
      updatedAt: new Date(),
      sessionId, // Ensure sessionId cannot be overwritten
    };

    this.sessions.set(sessionId, updatedSession);
    return true;
  }

  /**
   * Update session status
   * @param {string} sessionId - Session ID
   * @param {string} status - New status
   * @returns {boolean} - Success status
   */
  updateStatus(sessionId, status) {
    return this.updateSession(sessionId, { status });
  }

  /**
   * Delete session
   * @param {string} sessionId - Session ID
   * @returns {boolean} - Success status
   */
  deleteSession(sessionId) {
    if (!sessionId || typeof sessionId !== "string") {
      return false;
    }

    return this.sessions.delete(sessionId);
  }

  /**
   * Check if session exists and is valid
   * @param {string} sessionId - Session ID
   * @returns {boolean} - Existence status
   */
  sessionExists(sessionId) {
    if (!sessionId || typeof sessionId !== "string") {
      return false;
    }

    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    if (this.isSessionExpired(session)) {
      this.deleteSession(sessionId);
      return false;
    }

    return true;
  }

  /**
   * Get all active sessions (non-expired)
   * @returns {Array} - Array of active sessions
   */
  getActiveSessions() {
    const activeSessions = [];

    for (const [sessionId, session] of this.sessions.entries()) {
      if (!this.isSessionExpired(session)) {
        activeSessions.push({ ...session });
      }
    }

    return activeSessions;
  }

  /**
   * Get session count
   * @returns {number} - Number of active sessions
   */
  getSessionCount() {
    let count = 0;

    for (const session of this.sessions.values()) {
      if (!this.isSessionExpired(session)) {
        count++;
      }
    }

    return count;
  }

  /**
   * Extend session expiration time
   * @param {string} sessionId - Session ID
   * @param {number} additionalTime - Additional time in milliseconds
   * @returns {boolean} - Success status
   */
  extendSession(sessionId, additionalTime = this.defaultExpirationTime) {
    const session = this.sessions.get(sessionId);

    if (!session || this.isSessionExpired(session)) {
      return false;
    }

    const currentExpiration = new Date(session.expiresAt);
    const newExpirationTime = new Date(
      currentExpiration.getTime() + additionalTime
    );
    return this.updateSession(sessionId, { expiresAt: newExpirationTime });
  }

  /**
   * Check if session has expired
   * @param {Object} session - Session object
   * @returns {boolean} - Expiration status
   */
  isSessionExpired(session) {
    if (!session || !session.expiresAt) {
      console.log(`[SESSION] Invalid session or missing expiresAt:`, session);
      return true;
    }

    const now = new Date();
    const expiresAt = new Date(session.expiresAt);
    const isExpired = now > expiresAt;
    console.log(`[SESSION] Checking expiration - Now: ${now.toISOString()}, Expires: ${expiresAt.toISOString()}, Expired: ${isExpired}`);
    return isExpired;
  }

  /**
   * Clean up expired sessions
   * @returns {number} - Number of sessions cleaned up
   */
  cleanupExpiredSessions() {
    let cleanedCount = 0;
    const now = new Date();

    for (const [sessionId, session] of this.sessions.entries()) {
      if (this.isSessionExpired(session)) {
        this.sessions.delete(sessionId);
        cleanedCount++;
      }
    }

    return cleanedCount;
  }

  /**
   * Start automatic cleanup process
   * @param {number} intervalMs - Cleanup interval in milliseconds (default: 5 minutes)
   */
  startCleanupProcess(intervalMs = 5 * 60 * 1000) {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    this.cleanupInterval = setInterval(() => {
      const cleanedCount = this.cleanupExpiredSessions();
      if (cleanedCount > 0) {
        console.log(`Cleaned up ${cleanedCount} expired sessions`);
      }
    }, intervalMs);
  }

  /**
   * Stop automatic cleanup process
   */
  stopCleanupProcess() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Clear all sessions (useful for testing)
   */
  clearAllSessions() {
    this.sessions.clear();
  }

  /**
   * Get session statistics
   * @returns {Object} - Session statistics
   */
  getStats() {
    const totalSessions = this.sessions.size;
    const activeSessions = this.getSessionCount();
    const expiredSessions = totalSessions - activeSessions;

    return {
      total: totalSessions,
      active: activeSessions,
      expired: expiredSessions,
    };
  }
}

// Create singleton instance
const sessionManager = new SessionManager();

module.exports = sessionManager;