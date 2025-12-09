const express = require('express');
const sseManager = require('../services/sseManager');
const sessionManager = require('../services/sessionManager');
const eventBroadcaster = require('../services/eventBroadcaster');

const router = express.Router();

/**
 * GET /api/events/:sessionId
 * Establish SSE connection for real-time updates
 */
router.get('/events/:sessionId', (req, res) => {
  const { sessionId } = req.params;

  // Validate session ID
  if (!sessionId || typeof sessionId !== 'string') {
    return res.status(400).json({
      error: 'Invalid session ID',
      code: 'INVALID_SESSION_ID'
    });
  }

  // Check if session exists - if completed, allow connection to show results
  console.log(`[SSE] Attempting to connect to session: ${sessionId}`);
  
  // Debug: Log all active sessions
  const activeSessions = sessionManager.getActiveSessions();
  console.log(`[SSE] Active sessions count: ${activeSessions.length}`);
  
  const session = sessionManager.getSession(sessionId);
  if (!session) {
    console.log(`[SSE] Session not found: ${sessionId}`);
    // Additional debug info
    console.log(`[SSE] All session keys:`, Array.from(sessionManager.sessions.keys()));
    return res.status(404).json({
      error: 'Session not found',
      code: 'SESSION_NOT_FOUND'
    });
  }
  console.log(`[SSE] Session found: ${sessionId}, status: ${session.status}`);

  // Create SSE connection (headers will be set by SSE manager)
  const connectionCreated = sseManager.createConnection(sessionId, res);
  
  if (!connectionCreated) {
    // Note: If headers have already been sent by SSE manager, we can't send JSON response
    // In this case, the connection has already been established or failed
    return;
  }

  // Send current session status and any existing results
  if (session.status === 'completed' && session.feedback) {
    // Session already completed - send the results immediately
    sseManager.broadcastToSession(sessionId, 'analysis.completed', {
      status: 'completed',
      message: 'Analysis completed successfully',
      stage: 'analysis',
      feedback: session.feedback,
      completedAt: session.completedAt || new Date().toISOString()
    });
  } else {
    // Send current status
    sseManager.broadcastToSession(sessionId, 'session.status', {
      status: session.status,
      message: `Current status: ${session.status}`,
      sessionData: {
        sessionId: session.sessionId,
        status: session.status,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt
      }
    });
  }

  // Extend session expiration since user is actively connected
  sessionManager.extendSession(sessionId);

  console.log(`SSE connection established for session: ${sessionId}`);
});

/**
 * GET /api/events/:sessionId/status
 * Get current session status (non-SSE endpoint)
 */
router.get('/events/:sessionId/status', (req, res) => {
  const { sessionId } = req.params;

  // Validate session ID
  if (!sessionId || typeof sessionId !== 'string') {
    return res.status(400).json({
      error: 'Invalid session ID',
      code: 'INVALID_SESSION_ID'
    });
  }

  // Get session
  console.log(`[SSE] Status check for session: ${sessionId}`);
  
  // Debug: Log all active sessions
  const activeSessions = sessionManager.getActiveSessions();
  console.log(`[SSE] Active sessions count: ${activeSessions.length}`);
  
  const session = sessionManager.getSession(sessionId);
  if (!session) {
    console.log(`[SSE] Session not found for status check: ${sessionId}`);
    // Additional debug info
    console.log(`[SSE] All session keys:`, Array.from(sessionManager.sessions.keys()));
    return res.status(404).json({
      error: 'Session not found',
      code: 'SESSION_NOT_FOUND'
    });
  }
  console.log(`[SSE] Session found for status check: ${sessionId}`);

  // Return session status
  res.json({
    success: true,
    sessionId: session.sessionId,
    status: session.status,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    hasActiveConnections: sseManager.getConnectionCount(sessionId) > 0,
    retryCount: session.retryCount || 0
  });
});

/**
 * POST /api/events/:sessionId/retry
 * Trigger retry for failed session
 */
router.post('/events/:sessionId/retry', (req, res) => {
  const { sessionId } = req.params;

  // Validate session ID
  if (!sessionId || typeof sessionId !== 'string') {
    return res.status(400).json({
      error: 'Invalid session ID',
      code: 'INVALID_SESSION_ID'
    });
  }

  // Get session
  const session = sessionManager.getSession(sessionId);
  if (!session) {
    return res.status(404).json({
      error: 'Session not found',
      code: 'SESSION_NOT_FOUND'
    });
  }

  // Check if session is in error state
  if (session.status !== 'error') {
    return res.status(400).json({
      error: 'Session is not in error state',
      code: 'INVALID_SESSION_STATE'
    });
  }

  // Increment retry count
  const newRetryCount = (session.retryCount || 0) + 1;
  
  // Check retry limit
  if (newRetryCount > 3) {
    return res.status(400).json({
      error: 'Maximum retry attempts exceeded',
      code: 'MAX_RETRIES_EXCEEDED'
    });
  }

  // Update session for retry
  sessionManager.updateSession(sessionId, {
    status: 'retrying',
    retryCount: newRetryCount,
    lastError: null
  });

  // Broadcast retry started
  eventBroadcaster.broadcastRetryStarted(sessionId, newRetryCount);

  res.json({
    success: true,
    message: 'Retry initiated',
    sessionId: sessionId,
    retryCount: newRetryCount
  });

  console.log(`Retry initiated for session ${sessionId}, attempt ${newRetryCount}`);
});

/**
 * DELETE /api/events/:sessionId
 * Close SSE connections for a session
 */
router.delete('/events/:sessionId', (req, res) => {
  const { sessionId } = req.params;

  // Validate session ID
  if (!sessionId || typeof sessionId !== 'string') {
    return res.status(400).json({
      error: 'Invalid session ID',
      code: 'INVALID_SESSION_ID'
    });
  }

  // Close connections
  sseManager.closeSessionConnections(sessionId);

  res.json({
    success: true,
    message: 'SSE connections closed',
    sessionId: sessionId
  });

  console.log(`SSE connections closed for session: ${sessionId}`);
});

/**
 * GET /api/sse/stats
 * Get SSE connection statistics
 */
router.get('/sse/stats', (req, res) => {
  try {
    const stats = {
      sse: sseManager.getStats(),
      sessions: sessionManager.getStats(),
      broadcaster: eventBroadcaster.getStats()
    };

    res.json({
      success: true,
      stats: stats,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error getting SSE stats:', error);
    res.status(500).json({
      error: 'Failed to get SSE statistics',
      code: 'STATS_ERROR'
    });
  }
});

module.exports = router;