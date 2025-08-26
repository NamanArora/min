// Simple direct API implementation for LLM providers
// This bypasses complex npm libraries and makes direct HTTP calls

var directApiProvider = {

  summarizeText: async function (text, pageTitle, pageUrl, llmConfig) {
    if (!llmConfig || !llmConfig.apiKey || !llmConfig.modelName) {
      throw new Error('LLM configuration missing: API key and model name required')
    }

    var provider = this.detectProvider(llmConfig.modelName)
    if (!provider) {
      throw new Error('Unable to detect provider for model: ' + llmConfig.modelName)
    }

    var prompt = `Please provide a concise summary of the following webpage content.

Page Title: ${pageTitle || 'Unknown'}
Page URL: ${pageUrl || 'Unknown'}

Content:
${text}

Please provide a 2-3 sentence summary focusing on the main points and key information.`

    try {
      var apiCall = this.getApiFunction(provider)
      var summary = await apiCall(prompt, llmConfig, provider)

      return {
        success: true,
        summary: summary,
        model: llmConfig.modelName,
        provider: provider
      }
    } catch (error) {
      return {
        success: false,
        error: error.message,
        model: llmConfig.modelName,
        provider: provider
      }
    }
  },

  detectProvider: function (modelName) {
    if (!modelName) return null

    var modelLower = modelName.toLowerCase()
    if (modelLower.includes('claude')) return 'anthropic'
    if (modelLower.includes('gpt') || modelLower.includes('openai')) return 'openai'
    if (modelLower.includes('gemini')) return 'google'
    if (modelLower.includes('groq')) return 'groq'

    // Default fallback
    return 'openai'
  },

  getApiFunction: function (provider) {
    switch (provider) {
      case 'openai':
        return this.callOpenAI
      case 'anthropic':
        return this.callAnthropic
      case 'google':
        return this.callGoogle
      case 'groq':
        return this.callGroq
      default:
        return this.callOpenAI
    }
  },

  callOpenAI: async function (prompt, llmConfig, provider) {
    var response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${llmConfig.apiKey}`
      },
      body: JSON.stringify({
        model: llmConfig.modelName,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 200,
        temperature: 0.3
      })
    })

    if (!response.ok) {
      var errorData = await response.json().catch(() => ({}))
      throw new Error(`OpenAI API error: ${response.status} - ${errorData.error?.message || 'Unknown error'}`)
    }

    var data = await response.json()
    return data.choices[0].message.content
  },

  callAnthropic: async function (prompt, llmConfig, provider) {
    var response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': llmConfig.apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: llmConfig.modelName,
        max_tokens: 200,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3
      })
    })

    if (!response.ok) {
      var errorData = await response.json().catch(() => ({}))
      throw new Error(`Anthropic API error: ${response.status} - ${errorData.error?.message || 'Unknown error'}`)
    }

    var data = await response.json()
    return data.content[0].text
  },

  callGoogle: async function (prompt, llmConfig, provider) {
    var apiKey = llmConfig.apiKey
    var model = llmConfig.modelName
    var url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`

    var response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: prompt }]
        }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 200
        }
      })
    })

    if (!response.ok) {
      var errorData = await response.json().catch(() => ({}))
      throw new Error(`Google API error: ${response.status} - ${errorData.error?.message || 'Unknown error'}`)
    }

    var data = await response.json()
    return data.candidates[0].content.parts[0].text
  },

  callGroq: async function (prompt, llmConfig, provider) {
    var response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${llmConfig.apiKey}`
      },
      body: JSON.stringify({
        model: llmConfig.modelName,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 200,
        temperature: 0.3
      })
    })

    if (!response.ok) {
      var errorData = await response.json().catch(() => ({}))
      throw new Error(`Groq API error: ${response.status} - ${errorData.error?.message || 'Unknown error'}`)
    }

    var data = await response.json()
    return data.choices[0].message.content
  },

  validateConfiguration: function (llmConfig) {
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

    var provider = this.detectProvider(llmConfig.modelName)
    if (!provider) {
      return {
        valid: false,
        message: 'Unable to detect provider for model: ' + llmConfig.modelName
      }
    }

    return {
      valid: true,
      provider: provider,
      model: llmConfig.modelName
    }
  }
}

module.exports = directApiProvider
