const express = require('express');
const { uploadConfig, handleMulterError } = require('../middleware/multerConfig');
const { validatePDFMiddleware } = require('../middleware/fileValidation');
const fileCleanupService = require('../services/fileCleanup');
const sessionManager = require('../services/sessionManager');
const eventBroadcaster = require('../services/eventBroadcaster');
const PDFExtractor = require('../services/pdfExtractor');
const GeminiService = require('../services/geminiService');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();

/**
 * POST /api/upload-and-process
 * Main processing workflow route - orchestrates upload → extract → analyze → stream
 * This is the primary endpoint that handles the complete resume analysis workflow
 */
router.post('/upload-and-process', 
  // Multer middleware for file upload
  uploadConfig.single('resume'),
  
  // Handle multer errors
  handleMulterError,
  
  // Validate PDF file
  validatePDFMiddleware,
  
  // Main workflow handler
  async (req, res) => {
    const sessionId = uuidv4();
    
    try {
      const file = req.file;
      
      if (!file) {
        return res.status(400).json({
          error: 'No file uploaded',
          code: 'NO_FILE'
        });
      }

      // Create session with file information
      console.log(`[UPLOAD] Creating session: ${sessionId}`);
      sessionManager.createSession({
        sessionId,
        status: 'uploaded',
        fileInfo: {
          originalName: file.originalname,
          filename: file.filename,
          size: file.size,
          mimetype: file.mimetype,
          path: file.path,
          uploadedAt: new Date().toISOString(),
          validatedAt: file.validatedAt
        }
      });
      console.log(`[UPLOAD] Session created successfully: ${sessionId}`);

      // Schedule cleanup for this file (30 minutes after upload)
      fileCleanupService.scheduleCleanup(sessionId, file.path, 30 * 60 * 1000);

      // Send immediate response with session info
      res.status(200).json({
        success: true,
        sessionId: sessionId,
        message: 'Processing started',
        status: 'processing',
        file: {
          originalName: file.originalname,
          size: file.size,
          uploadedAt: new Date().toISOString()
        }
      });

      // Log successful upload
      console.log(`File uploaded and processing started: ${file.originalname} (${file.size} bytes) - Session: ${sessionId}`);

      // Start the processing workflow asynchronously
      processResumeWorkflow(sessionId, file);

    } catch (error) {
      console.error('Upload and process handler error:', error);
      
      // Clean up file on error
      if (req.file && req.file.path) {
        await fileCleanupService.deleteFile(req.file.path);
      }
      
      // Update session status to error if session was created
      if (sessionManager.sessionExists(sessionId)) {
        sessionManager.updateSession(sessionId, {
          status: 'error',
          lastError: error.message
        });
        eventBroadcaster.broadcastError(sessionId, error.message, {
          code: 'UPLOAD_PROCESSING_ERROR',
          stage: 'upload',
          retryable: false
        });
      }
      
      res.status(500).json({
        error: 'Upload processing failed',
        code: 'UPLOAD_PROCESSING_ERROR'
      });
    }
  }
);

/**
 * POST /api/upload
 * Upload and validate PDF resume file (legacy endpoint - kept for compatibility)
 */
router.post('/upload', 
  // Multer middleware for file upload
  uploadConfig.single('resume'),
  
  // Handle multer errors
  handleMulterError,
  
  // Validate PDF file
  validatePDFMiddleware,
  
  // Main upload handler
  async (req, res) => {
    try {
      const file = req.file;
      
      if (!file) {
        return res.status(400).json({
          error: 'No file uploaded',
          code: 'NO_FILE'
        });
      }

      // Generate session ID for tracking
      const sessionId = uuidv4();
      
      // Store session with file information
      const sessionManager = require('../services/sessionManager');
      sessionManager.createSession({
        sessionId: sessionId,
        status: 'uploaded',
        fileInfo: {
          originalName: file.originalname,
          filename: file.filename,
          size: file.size,
          mimetype: file.mimetype,
          path: file.path,
          uploadedAt: new Date().toISOString(),
          validatedAt: file.validatedAt
        }
      });
      
      // Create response with file information
      const response = {
        success: true,
        sessionId: sessionId,
        file: {
          originalName: file.originalname,
          filename: file.filename,
          size: file.size,
          mimetype: file.mimetype,
          uploadedAt: new Date().toISOString(),
          validatedAt: file.validatedAt
        },
        message: 'File uploaded and validated successfully'
      };

      // Schedule cleanup for this file (5 minutes after upload)
      fileCleanupService.scheduleCleanup(sessionId, file.path, 5 * 60 * 1000);

      // Log successful upload
      console.log(`File uploaded successfully: ${file.originalname} (${file.size} bytes) - Session: ${sessionId}`);

      res.status(200).json(response);

    } catch (error) {
      console.error('Upload handler error:', error);
      
      // Clean up file on error
      if (req.file && req.file.path) {
        await fileCleanupService.deleteFile(req.file.path);
      }
      
      res.status(500).json({
        error: 'Upload processing failed',
        code: 'UPLOAD_PROCESSING_ERROR'
      });
    }
  }
);

/**
 * Main processing workflow function
 * Orchestrates the complete flow: extract → analyze → stream
 * @param {string} sessionId - Session ID
 * @param {Object} file - Uploaded file object
 */
async function processResumeWorkflow(sessionId, file) {
  const pdfExtractor = new PDFExtractor();
  let geminiService;
  
  try {
    // Initialize Gemini service
    geminiService = new GeminiService();
  } catch (error) {
    console.error(`Gemini service initialization failed for session ${sessionId}:`, error);
    sessionManager.updateSession(sessionId, {
      status: 'error',
      lastError: 'AI service initialization failed'
    });
    eventBroadcaster.broadcastError(sessionId, 'AI service initialization failed', {
      code: 'AI_INIT_ERROR',
      stage: 'initialization',
      retryable: false
    });
    return;
  }

  try {
    // Step 1: Update status to extracting
    sessionManager.updateSession(sessionId, { status: 'extracting' });
    eventBroadcaster.broadcastExtractionStarted(sessionId);
    
    // Extract text from PDF
    const extractionResult = await pdfExtractor.extractText(file.path);
    
    if (!extractionResult.success) {
      sessionManager.updateSession(sessionId, {
        status: 'error',
        lastError: extractionResult.error.message
      });
      eventBroadcaster.broadcastError(sessionId, extractionResult.error.message, {
        code: extractionResult.error.type,
        stage: 'extraction',
        retryable: false
      });
      return;
    }

    // Step 2: Extraction completed
    sessionManager.updateSession(sessionId, { 
      status: 'extracted',
      extractedText: extractionResult.text
    });
    eventBroadcaster.broadcastExtractionCompleted(sessionId, {
      text: extractionResult.text,
      textLength: extractionResult.metadata.textLength,
      pageCount: extractionResult.metadata.pages,
      hasText: true
    });

    // Step 3: Start AI analysis with retry logic
    await analyzeWithRetry(sessionId, extractionResult.text, geminiService);

  } catch (error) {
    console.error(`Processing workflow error for session ${sessionId}:`, error);
    sessionManager.updateSession(sessionId, {
      status: 'error',
      lastError: error.message
    });
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
      // Update session for retry
      sessionManager.updateSession(sessionId, { 
        status: 'retrying',
        retryCount: retryCount
      });
      eventBroadcaster.broadcastRetryStarted(sessionId, retryCount, 'analysis');
      
      // Exponential backoff delay
      const delay = Math.min(1000 * Math.pow(2, retryCount - 1), 10000);
      await new Promise(resolve => setTimeout(resolve, delay));
    } else {
      // First attempt
      sessionManager.updateSession(sessionId, { status: 'analyzing' });
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
    sessionManager.updateSession(sessionId, {
      status: 'completed',
      feedback: feedback,
      completedAt: new Date().toISOString()
    });
    eventBroadcaster.broadcastAnalysisCompleted(sessionId, feedback);

  } catch (error) {
    console.error(`AI analysis error (attempt ${retryCount + 1}):`, error);
    
    // Don't retry for certain error types that won't be fixed by retrying
    const isRetryableError = !(error.message.includes('model not found') || 
                              error.message.includes('Unauthorized') || 
                              error.message.includes('API key'));
    
    // If it's a model-related error, try to reinitialize the model
    if (error.message.includes('model not found') && typeof geminiService.reinitializeModel === 'function') {
      console.log('Attempting to reinitialize AI model...');
      const reinitSuccess = geminiService.reinitializeModel();
      if (reinitSuccess && retryCount < maxRetries) {
        // If reinitialization was successful, retry the analysis
        await analyzeWithRetry(sessionId, resumeText, geminiService, retryCount + 1);
        return;
      }
    }
    
    if (isRetryableError && retryCount < maxRetries) {
      // Retry for retryable errors
      await analyzeWithRetry(sessionId, resumeText, geminiService, retryCount + 1);
    } else {
      // Max retries exceeded or non-retryable error
      sessionManager.updateSession(sessionId, {
        status: 'error',
        lastError: error.message,
        retryCount: retryCount + 1
      });
      eventBroadcaster.broadcastError(sessionId, error.message, {
        code: 'AI_ANALYSIS_FAILED',
        stage: 'analysis',
        retryable: isRetryableError,
        retryCount: retryCount + 1
      });
    }
  }
}

/**
 * GET /api/upload/stats
 * Get upload directory statistics (for monitoring)
 */
router.get('/stats', (req, res) => {
  try {
    const stats = fileCleanupService.getUploadStats();
    res.json({
      success: true,
      stats: stats,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error getting upload stats:', error);
    res.status(500).json({
      error: 'Failed to get upload statistics',
      code: 'STATS_ERROR'
    });
  }
});

module.exports = router;