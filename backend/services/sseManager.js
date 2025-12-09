const EventEmitter = require('events');

/**
 * Server-Sent Events Manager
 * Handles SSE connections, broadcasting, and connection management
 */
class SSEManager extends EventEmitter {
  constructor() {
    super();
    this.connections = new Map(); // sessionId -> Set of response objects
    this.connectionCleanupInterval = null;
    this.heartbeatInterval = null;
    
    // Start connection management processes
    this.startConnectionCleanup();
    this.startHeartbeat();
  }

  /**
   * Create SSE connection for a session
   * @param {string} sessionId - Session ID
   * @param {Object} res - Express response object
   * @returns {boolean} - Success status
   */
  createConnection(sessionId, res) {
    if (!sessionId || !res) {
      return false;
    }

    // Set SSE headers with proper CORS
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*', // Allow all origins for SSE
      'Access-Control-Allow-Credentials': 'true',
      'X-Accel-Buffering': 'no' // Disable buffering for nginx
    });

    // Send initial connection event
    this.sendEvent(res, 'connected', {
      sessionId,
      timestamp: new Date().toISOString(),
      message: 'SSE connection established'
    });

    // Store connection
    if (!this.connections.has(sessionId)) {
      this.connections.set(sessionId, new Set());
    }
    this.connections.get(sessionId).add(res);

    // Handle connection close
    res.on('close', () => {
      this.removeConnection(sessionId, res);
    });

    res.on('error', (error) => {
      console.error(`SSE connection error for session ${sessionId}:`, error);
      this.removeConnection(sessionId, res);
    });

    console.log(`SSE connection established for session: ${sessionId}`);
    return true;
  }

  /**
   * Remove a specific connection
   * @param {string} sessionId - Session ID
   * @param {Object} res - Express response object
   */
  removeConnection(sessionId, res) {
    if (!sessionId || !res) {
      return;
    }

    const sessionConnections = this.connections.get(sessionId);
    if (sessionConnections) {
      sessionConnections.delete(res);
      
      // Remove session entry if no connections remain
      if (sessionConnections.size === 0) {
        this.connections.delete(sessionId);
      }
    }

    console.log(`SSE connection closed for session: ${sessionId}`);
  }

  /**
   * Broadcast event to all connections for a session
   * @param {string} sessionId - Session ID
   * @param {string} eventType - Event type
   * @param {Object} data - Event data
   */
  broadcastToSession(sessionId, eventType, data) {
    if (!sessionId || !eventType) {
      return;
    }

    const sessionConnections = this.connections.get(sessionId);
    if (!sessionConnections || sessionConnections.size === 0) {
      return;
    }

    const eventData = {
      sessionId,
      timestamp: new Date().toISOString(),
      ...data
    };

    // Send to all connections for this session
    const deadConnections = [];
    
    for (const res of sessionConnections) {
      try {
        if (!res.destroyed && !res.finished) {
          this.sendEvent(res, eventType, eventData);
        } else {
          deadConnections.push(res);
        }
      } catch (error) {
        console.error(`Error sending SSE event to session ${sessionId}:`, error);
        deadConnections.push(res);
      }
    }

    // Clean up dead connections
    deadConnections.forEach(res => {
      this.removeConnection(sessionId, res);
    });
  }

  /**
   * Send individual SSE event
   * @param {Object} res - Express response object
   * @param {string} eventType - Event type
   * @param {Object} data - Event data
   */
  sendEvent(res, eventType, data) {
    if (!res || res.destroyed || res.finished) {
      return;
    }

    try {
      const eventString = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
      res.write(eventString);
    } catch (error) {
      console.error('Error writing SSE event:', error);
    }
  }

  /**
   * Send heartbeat to all active connections
   */
  sendHeartbeat() {
    const heartbeatData = {
      timestamp: new Date().toISOString(),
      type: 'heartbeat'
    };

    for (const [sessionId, sessionConnections] of this.connections.entries()) {
      const deadConnections = [];
      
      for (const res of sessionConnections) {
        try {
          if (!res.destroyed && !res.finished) {
            this.sendEvent(res, 'heartbeat', heartbeatData);
          } else {
            deadConnections.push(res);
          }
        } catch (error) {
          deadConnections.push(res);
        }
      }

      // Clean up dead connections
      deadConnections.forEach(res => {
        this.removeConnection(sessionId, res);
      });
    }
  }

  /**
   * Get connection count for a session
   * @param {string} sessionId - Session ID
   * @returns {number} - Number of active connections
   */
  getConnectionCount(sessionId) {
    const sessionConnections = this.connections.get(sessionId);
    return sessionConnections ? sessionConnections.size : 0;
  }

  /**
   * Get total connection count
   * @returns {number} - Total number of active connections
   */
  getTotalConnectionCount() {
    let total = 0;
    for (const sessionConnections of this.connections.values()) {
      total += sessionConnections.size;
    }
    return total;
  }

  /**
   * Close all connections for a session
   * @param {string} sessionId - Session ID
   */
  closeSessionConnections(sessionId) {
    const sessionConnections = this.connections.get(sessionId);
    if (!sessionConnections) {
      return;
    }

    for (const res of sessionConnections) {
      try {
        if (!res.destroyed && !res.finished) {
          this.sendEvent(res, 'session_closed', {
            sessionId,
            message: 'Session has been closed'
          });
          res.end();
        }
      } catch (error) {
        console.error(`Error closing SSE connection for session ${sessionId}:`, error);
      }
    }

    this.connections.delete(sessionId);
  }

  /**
   * Start connection cleanup process
   */
  startConnectionCleanup() {
    if (this.connectionCleanupInterval) {
      clearInterval(this.connectionCleanupInterval);
    }

    this.connectionCleanupInterval = setInterval(() => {
      this.cleanupDeadConnections();
    }, 30000); // Clean up every 30 seconds
  }

  /**
   * Start heartbeat process
   */
  startHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    this.heartbeatInterval = setInterval(() => {
      this.sendHeartbeat();
    }, 30000); // Send heartbeat every 30 seconds
  }

  /**
   * Clean up dead connections
   */
  cleanupDeadConnections() {
    let cleanedCount = 0;
    
    for (const [sessionId, sessionConnections] of this.connections.entries()) {
      const deadConnections = [];
      
      for (const res of sessionConnections) {
        if (res.destroyed || res.finished) {
          deadConnections.push(res);
        }
      }

      deadConnections.forEach(res => {
        sessionConnections.delete(res);
        cleanedCount++;
      });

      // Remove session if no connections remain
      if (sessionConnections.size === 0) {
        this.connections.delete(sessionId);
      }
    }

    if (cleanedCount > 0) {
      console.log(`Cleaned up ${cleanedCount} dead SSE connections`);
    }
  }

  /**
   * Stop all cleanup processes
   */
  stopCleanupProcesses() {
    if (this.connectionCleanupInterval) {
      clearInterval(this.connectionCleanupInterval);
      this.connectionCleanupInterval = null;
    }

    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Close all connections and cleanup
   */
  shutdown() {
    // Close all connections
    for (const [sessionId] of this.connections.entries()) {
      this.closeSessionConnections(sessionId);
    }

    // Stop cleanup processes
    this.stopCleanupProcesses();
  }

  /**
   * Get SSE manager statistics
   * @returns {Object} - Statistics object
   */
  getStats() {
    return {
      totalSessions: this.connections.size,
      totalConnections: this.getTotalConnectionCount(),
      sessionsWithConnections: Array.from(this.connections.keys()).map(sessionId => ({
        sessionId,
        connectionCount: this.getConnectionCount(sessionId)
      }))
    };
  }
}

// Create singleton instance
const sseManager = new SSEManager();

module.exports = sseManager;