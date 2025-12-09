const { GoogleGenerativeAI } = require('@google/generative-ai');

class GeminiService {
  constructor() {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY environment variable is required');
    }
    
    this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    
    // Define fallback models in order of preference
    this.modelOptions = [
      {
        name: 'gemini-2.0-flash',
        generationConfig: {
          temperature: 0.7,
          topP: 0.8,
          topK: 40,
          maxOutputTokens: 4096,
        }
      },
      {
        name: 'gemini-2.5-flash',
        generationConfig: {
          temperature: 0.7,
          topP: 0.8,
          topK: 40,
          maxOutputTokens: 4096,
        }
      },
      {
        name: 'gemini-pro',
        generationConfig: {
          temperature: 0.7,
          topP: 0.8,
          topK: 40,
          maxOutputTokens: 4096,
        }
      }
    ];
    
    // Try to initialize the first available model
    this.model = this.initializeModel();
  }
  
  /**
   * Initialize the first available model from the fallback list
   * @returns {GenerativeModel} Initialized model
   */
  initializeModel() {
    for (const modelOption of this.modelOptions) {
      try {
        const model = this.genAI.getGenerativeModel({ 
          model: modelOption.name,
          generationConfig: modelOption.generationConfig
        });
        console.log(`Successfully initialized model: ${modelOption.name}`);
        return model;
      } catch (error) {
        console.warn(`Failed to initialize model ${modelOption.name}:`, error.message);
        continue;
      }
    }
    
    throw new Error('Failed to initialize any available AI model. Please check your API key and network connection.');
  }

  /**
   * Reinitialize the model with the next available fallback
   * @returns {boolean} True if reinitialization was successful
   */
  reinitializeModel() {
    try {
      this.model = this.initializeModel();
      return true;
    } catch (error) {
      console.error('Failed to reinitialize model:', error.message);
      return false;
    }
  }

  /**
   * Create structured prompt for resume analysis
   * @param {string} resumeText - Extracted text from PDF resume
   * @returns {string} Formatted prompt for AI analysis
   */
  createAnalysisPrompt(resumeText) {
    return `You are an expert resume reviewer and career advisor. Please analyze the following resume and provide comprehensive feedback in the exact JSON format specified below.

Resume Text:
${resumeText}

Please provide your analysis in the following JSON structure:

{
  "clarity": {
    "score": [number from 1-10],
    "suggestions": ["specific suggestion 1", "specific suggestion 2"],
    "strengths": ["strength 1", "strength 2"],
    "weaknesses": ["weakness 1", "weakness 2"]
  },
  "grammar": {
    "score": [number from 1-10],
    "corrections": ["correction 1", "correction 2"],
    "improvements": ["improvement 1", "improvement 2"]
  },
  "skills": {
    "relevantSkills": ["skill 1", "skill 2"],
    "missingSkills": ["missing skill 1", "missing skill 2"],
    "recommendations": ["recommendation 1", "recommendation 2"]
  },
  "improvements": [
    {
      "category": "formatting|content|skills|experience",
      "priority": "high|medium|low",
      "suggestion": "specific actionable suggestion",
      "example": "concrete example of how to implement this suggestion"
    }
  ]
}

Focus on:
1. Clarity and formatting - Is the resume well-structured and easy to read?
2. Grammar and writing quality - Are there any grammatical errors or awkward phrasing?
3. Skills relevance - What skills are highlighted and what might be missing?
4. Specific improvements - Actionable suggestions with examples

Provide only the JSON response, no additional text.`;
  }

  /**
   * Analyze resume with streaming support
   * @param {string} resumeText - Extracted text from PDF resume
   * @param {Function} onChunk - Callback for streaming chunks
   * @returns {Promise<Object>} Parsed feedback object
   */
  async analyzeResumeStreaming(resumeText, onChunk) {
    try {
      const prompt = this.createAnalysisPrompt(resumeText);
      
      // Generate streaming response
      const result = await this.model.generateContentStream(prompt);
      
      let fullResponse = '';
      
      // Process streaming chunks
      for await (const chunk of result.stream) {
        const chunkText = chunk.text();
        fullResponse += chunkText;
        
        // Call the chunk callback if provided
        if (onChunk && typeof onChunk === 'function') {
          onChunk(chunkText);
        }
      }
      
      // Parse the complete response
      const feedback = this.parseResponse(fullResponse);
      return feedback;
      
    } catch (error) {
      console.error('Error in Gemini AI analysis:', error);
      
      // Provide more specific error messages
      if (error.status === 404) {
        throw new Error('AI model not found. Please check if the model name is correct and available.');
      } else if (error.status === 401) {
        throw new Error('Unauthorized access to AI service. Please check your API key.');
      } else if (error.status === 429) {
        throw new Error('Rate limit exceeded. Please try again later.');
      } else if (error.status >= 500) {
        throw new Error('AI service temporarily unavailable. Please try again later.');
      }
      
      throw new Error(`AI analysis failed: ${error.message}`);
    }
  }

  /**
   * Parse AI response into structured feedback object
   * @param {string} response - Raw AI response
   * @returns {Object} Parsed feedback object
   */
  parseResponse(response) {
    try {
      // Clean the response - remove any markdown formatting or extra text
      let cleanResponse = response.trim();
      
      // Find JSON content between curly braces
      const jsonStart = cleanResponse.indexOf('{');
      const jsonEnd = cleanResponse.lastIndexOf('}');
      
      if (jsonStart === -1 || jsonEnd === -1) {
        throw new Error('No valid JSON found in response');
      }
      
      const jsonString = cleanResponse.substring(jsonStart, jsonEnd + 1);
      const parsed = JSON.parse(jsonString);
      
      // Validate the structure matches our expected format
      this.validateFeedbackStructure(parsed);
      
      return parsed;
      
    } catch (error) {
      console.error('Error parsing AI response:', error);
      console.error('Raw response:', response);
      
      // Return fallback structure if parsing fails
      return this.getFallbackFeedback();
    }
  }

  /**
   * Validate that feedback object has expected structure
   * @param {Object} feedback - Parsed feedback object
   * @throws {Error} If structure is invalid
   */
  validateFeedbackStructure(feedback) {
    const requiredFields = ['clarity', 'grammar', 'skills', 'improvements'];
    
    for (const field of requiredFields) {
      if (!feedback[field]) {
        throw new Error(`Missing required field: ${field}`);
      }
    }
    
    // Validate clarity structure
    if (!feedback.clarity.score || !Array.isArray(feedback.clarity.suggestions)) {
      throw new Error('Invalid clarity structure');
    }
    
    // Validate grammar structure
    if (!feedback.grammar.score || !Array.isArray(feedback.grammar.corrections)) {
      throw new Error('Invalid grammar structure');
    }
    
    // Validate skills structure
    if (!Array.isArray(feedback.skills.relevantSkills)) {
      throw new Error('Invalid skills structure');
    }
    
    // Validate improvements structure
    if (!Array.isArray(feedback.improvements)) {
      throw new Error('Invalid improvements structure');
    }
  }

  /**
   * Get fallback feedback structure when parsing fails
   * @returns {Object} Fallback feedback object
   */
  getFallbackFeedback() {
    return {
      clarity: {
        score: 5,
        suggestions: ['Unable to analyze clarity - please try again'],
        strengths: [],
        weaknesses: []
      },
      grammar: {
        score: 5,
        corrections: ['Unable to analyze grammar - please try again'],
        improvements: []
      },
      skills: {
        relevantSkills: [],
        missingSkills: [],
        recommendations: ['Unable to analyze skills - please try again']
      },
      improvements: [
        {
          category: 'content',
          priority: 'medium',
          suggestion: 'Analysis failed - please try uploading your resume again',
          example: 'Ensure your PDF is not password protected and contains readable text'
        }
      ]
    };
  }

  /**
   * Non-streaming analysis method for compatibility
   * @param {string} resumeText - Extracted text from PDF resume
   * @returns {Promise<Object>} Parsed feedback object
   */
  async analyzeResume(resumeText) {
    return this.analyzeResumeStreaming(resumeText);
  }
}

module.exports = GeminiService;