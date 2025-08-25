var LLM = null
var LLM_LOAD_ERROR = null
var directApiProvider = require('./directApiProvider.js')

// Try to load LLM.js - handle browserify vs Node.js contexts
try {
  LLM = require('@themaximalist/llm.js')
} catch (e) {
  // Store the error for debugging
  LLM_LOAD_ERROR = {
    error: e.message,
    stack: e.stack
  }
  // Don't log warnings during build - only when actually used
}

var llmProvider = {
  isAvailable: function () {
    // Always available - either via LLM.js or direct API fallback
    return true
  },

  isUsingFallback: function () {
    return LLM === null || typeof LLM === 'undefined'
  },

  getLoadError: function () {
    return LLM_LOAD_ERROR
  },

  mapModelToProvider: function (modelName) {
    if (!modelName) return null

    var modelLower = modelName.toLowerCase()

    if (modelLower.includes('claude')) {
      return {
        provider: 'anthropic',
        model: modelName
      }
    } else if (modelLower.includes('gpt') || modelLower.includes('openai')) {
      return {
        provider: 'openai',
        model: modelName
      }
    } else if (modelLower.includes('gemini')) {
      return {
        provider: 'google',
        model: modelName
      }
    } else if (modelLower.includes('groq')) {
      return {
        provider: 'groq',
        model: modelName
      }
    } else if (modelLower.includes('ollama')) {
      return {
        provider: 'ollama',
        model: modelName
      }
    }

    return {
      provider: 'openai',
      model: modelName
    }
  },

  summarizeText: async function (text, pageTitle, pageUrl, llmConfig) {
    // Use direct API fallback if LLM.js library isn't available
    if (this.isUsingFallback()) {
      return await directApiProvider.summarizeText(text, pageTitle, pageUrl, llmConfig)
    }

    if (!llmConfig || !llmConfig.apiKey || !llmConfig.modelName) {
      throw new Error('LLM configuration missing: API key and model name required')
    }

    var mappedConfig = this.mapModelToProvider(llmConfig.modelName)
    if (!mappedConfig) {
      throw new Error('Unable to detect LLM provider from model name: ' + llmConfig.modelName)
    }

    var prompt = `Please provide a concise summary of the following webpage content.

Page Title: ${pageTitle || 'Unknown'}
Page URL: ${pageUrl || 'Unknown'}

Content:
${text}

Please provide a 2-3 sentence summary focusing on the main points and key information.`

    try {
      var options = {
        provider: mappedConfig.provider,
        model: mappedConfig.model,
        api_key: llmConfig.apiKey,
        temperature: 0.3,
        max_tokens: 200
      }

      var summary = await LLM(prompt, options)
      return {
        success: true,
        summary: summary,
        model: llmConfig.modelName,
        provider: mappedConfig.provider,
        method: 'llm.js'
      }
    } catch (error) {
      return {
        success: false,
        error: error.message,
        model: llmConfig.modelName,
        provider: mappedConfig.provider,
        method: 'llm.js'
      }
    }
  },

  validateConfiguration: function (llmConfig) {
    // Use direct API provider validation when in fallback mode
    if (this.isUsingFallback()) {
      return directApiProvider.validateConfiguration(llmConfig)
    }

    if (!llmConfig) {
      return {
        valid: false,
        message: 'No LLM configuration found. Use Capabilities → Switch LLM... to configure.'
      }
    }

    if (!llmConfig.apiKey) {
      return {
        valid: false,
        message: 'API key missing. Please configure your API key in settings.'
      }
    }

    if (!llmConfig.modelName) {
      return {
        valid: false,
        message: 'Model name missing. Please select a model in settings.'
      }
    }

    var mappedConfig = this.mapModelToProvider(llmConfig.modelName)
    if (!mappedConfig) {
      return {
        valid: false,
        message: 'Unable to detect provider for model: ' + llmConfig.modelName
      }
    }

    return {
      valid: true,
      provider: mappedConfig.provider,
      model: mappedConfig.model
    }
  }
}

module.exports = llmProvider
