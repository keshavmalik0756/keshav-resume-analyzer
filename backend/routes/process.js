const express = require('express');
const PDFExtractor = require('../services/pdfExtractor');
const GeminiService = require('../services/geminiService');
const sessionManager = require('../services/sessionManager');
const eventBroadcaster = require('../services/eventBroadcaster');
const fileCleanupService = require('../services/fileCleanup');

const router = express.Router();

/**
 * POST /api/process/:sessionId
 * Main processing workflow - orchestrates PDF extraction and AI analysis
 */
router.post('/process/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  
  try {
    // Validate session exists
    const session = sessionManager.getSession(sessionId);
    if (!session) {
      return res.status(404).json({
        error: 'Session not found',
        code: 'SESSION_NOT_FOUND'
      });
    }

    // Start processing immediately and return response
    res.status(200).json({
      success: true,
      sessionId: sessionId,
      message: 'Processing started',
      status: 'processing'
    });

    // Run processing workflow asynchronously
    processResumeWorkflow(sessionId, session);

  } catch (error) {
    console.error('Process route error:', error);
    res.status(500).json({
      error: 'Failed to start processing',
      code: 'PROCESSING_START_ERROR'
    });
  }
});

/**
 * Main processing workflow function
 * @param {string} sessionId - Session ID
 * @param {Object} session - Session data
 */
async function processResumeWorkflow(sessionId, session) {
  const pdfExtractor = new PDFExtractor();
  let geminiService;
  
  try {
    // Initialize Gemini service
    geminiService = new GeminiService();
  } catch (error) {
    eventBroadcaster.broadcastError(sessionId, 'AI service initialization failed', {
      code: 'AI_INIT_ERROR',
      stage: 'initialization',
      retryable: false
    });
    return;
  }

  try {
    // Step 1: Extract text from PDF
    eventBroadcaster.broadcastExtractionStarted(sessionId);
    
    const filePath = session.fileInfo?.path || `backend/uploads/${session.fileInfo?.filename}`;
    const extractionResult = await pdfExtractor.extractText(filePath);
    
    if (!extractionResult.success) {
      eventBroadcaster.broadcastError(sessionId, extractionResult.error.message, {
        code: extractionResult.error.type,
        stage: 'extraction',
        retryable: false
      });
      return;
    }

    eventBroadcaster.broadcastExtractionCompleted(sessionId, {
      text: extractionResult.text,
      textLength: extractionResult.metadata.textLength,
      pageCount: extractionResult.metadata.pages,
      hasText: true
    });

    // Step 2: Analyze with AI (with retry logic)
    await analyzeWithRetry(sessionId, extractionResult.text, geminiService);

  } catch (error) {
    console.error(`Processing workflow error for session ${sessionId}:`, error);
    eventBroadcaster.broadcastError(sessionId, error.message, {
      code: 'WORKFLOW_ERROR',
      stage: 'processing',
      retryable: true
    });
  }
}

/**
 * AI analysis with retry logic
 * @param {string} sessionId - Session ID
 * @param {string} resumeText - Extracted resume text
 * @param {GeminiService} geminiService - Gemini service instance
 * @param {number} retryCount - Current retry attempt
 */
async function analyzeWithRetry(sessionId, resumeText, geminiService, retryCount = 0) {
  const maxRetries = 3;
  
  try {
    if (retryCount > 0) {
      eventBroadcaster.broadcastRetryStarted(sessionId, retryCount, 'analysis');
      // Exponential backoff delay
      const delay = Math.min(1000 * Math.pow(2, retryCount - 1), 10000);
      await new Promise(resolve => setTimeout(resolve, delay));
    } else {
      eventBroadcaster.broadcastAnalysisStarted(sessionId);
    }

    // Analyze with streaming
    const feedback = await geminiService.analyzeResumeStreaming(
      resumeText,
      (chunk) => {
        // Broadcast streaming chunks
        eventBroadcaster.broadcastAnalysisStreaming(sessionId, chunk);
      }
    );

    // Analysis completed successfully
    eventBroadcaster.broadcastAnalysisCompleted(sessionId, feedback);

  } catch (error) {
    console.error(`AI analysis error (attempt ${retryCount + 1}):`, error);
    
    if (retryCount < maxRetries) {
      // Retry
      await analyzeWithRetry(sessionId, resumeText, geminiService, retryCount + 1);
    } else {
      // Max retries exceeded
      eventBroadcaster.broadcastError(sessionId, 'AI analysis failed after multiple attempts', {
        code: 'AI_ANALYSIS_FAILED',
        stage: 'analysis',
        retryable: false,
        retryCount: retryCount + 1
      });
    }
  }
}

/**
 * GET /api/process/:sessionId/status
 * Get current processing status
 */
router.get('/process/:sessionId/status', (req, res) => {
  const { sessionId } = req.params;
  
  try {
    const session = sessionManager.getSession(sessionId);
    if (!session) {
      return res.status(404).json({
        error: 'Session not found',
        code: 'SESSION_NOT_FOUND'
      });
    }

    res.json({
      success: true,
      sessionId: sessionId,
      status: session.status,
      updatedAt: session.updatedAt,
      feedback: session.feedback || null,
      error: session.lastError || null
    });

  } catch (error) {
    console.error('Status check error:', error);
    res.status(500).json({
      error: 'Failed to get status',
      code: 'STATUS_ERROR'
    });
  }
});

/**
 * POST /api/process/:sessionId/retry
 * Retry failed processing
 */
router.post('/process/:sessionId/retry', async (req, res) => {
  const { sessionId } = req.params;
  
  try {
    console.log(`[PROCESS] Retry requested for session: ${sessionId}`);
    const session = sessionManager.getSession(sessionId);
    if (!session) {
      console.log(`[PROCESS] Session not found for retry: ${sessionId}`);
      return res.status(404).json({
        error: 'Session not found',
        code: 'SESSION_NOT_FOUND'
      });
    }
    console.log(`[PROCESS] Session found for retry: ${sessionId}`);

    // Reset session status for retry
    sessionManager.updateSession(sessionId, {
      status: 'retrying',
      lastError: null,
      retryCount: (session.retryCount || 0) + 1
    });

    res.json({
      success: true,
      sessionId: sessionId,
      message: 'Retry started',
      retryCount: session.retryCount + 1
    });

    // Start processing workflow again
    processResumeWorkflow(sessionId, session);

  } catch (error) {
    console.error('Retry error:', error);
    res.status(500).json({
      error: 'Failed to retry processing',
      code: 'RETRY_ERROR'
    });
  }
});

module.exports = router;