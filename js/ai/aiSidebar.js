var webviews = require('webviews.js')
var settings = require('util/settings/settings.js')
var llmProvider = require('./llmProvider.js')

// Global state for AI sidebar
var aiSidebar = {
  isOpen: false,
  conversations: [], // Array of {id, query, response, timestamp, loading}
  currentWidth: 0,
  animationDuration: 300,

  // DOM elements (will be initialized after DOM is ready)
  sidebarEl: null,
  conversationsEl: null,

  initialize: function () {
    this.sidebarEl = document.getElementById('ai-sidebar')
    this.conversationsEl = document.getElementById('ai-conversations')

    // Set up close button listener
    var closeButton = document.getElementById('ai-sidebar-close')
    if (closeButton) {
      closeButton.addEventListener('click', () => this.hide())
    }

    // Set up clear conversations button listener
    var clearButton = document.getElementById('ai-clear-conversations')
    if (clearButton) {
      clearButton.addEventListener('click', () => this.clearConversations())
    }

    // Handle window resize
    window.addEventListener('resize', () => this.handleResize())

    // Load saved state
    this.loadState()

    console.log('AI Sidebar initialized')
  },

  show: function () {
    if (this.isOpen) return

    this.isOpen = true
    this.currentWidth = Math.floor(window.innerWidth * 0.25) // 25% of window width

    if (this.sidebarEl) {
      this.sidebarEl.style.width = this.currentWidth + 'px'
      this.sidebarEl.classList.add('open')
      this.sidebarEl.removeAttribute('hidden')
    }

    // Adjust webview margins
    webviews.adjustMargin([0, this.currentWidth, 0, 0]) // top, right, bottom, left

    this.saveState()

    console.log('AI Sidebar shown, width:', this.currentWidth)
  },

  hide: function () {
    if (!this.isOpen) return

    this.isOpen = false

    if (this.sidebarEl) {
      this.sidebarEl.classList.remove('open')
      // Don't hide immediately - let animation finish
      setTimeout(() => {
        if (!this.isOpen) { // Make sure it wasn't reopened during animation
          this.sidebarEl.setAttribute('hidden', 'true')
        }
      }, this.animationDuration)
    }

    // Restore webview margins
    webviews.adjustMargin([0, -this.currentWidth, 0, 0])
    this.currentWidth = 0

    this.saveState()

    console.log('AI Sidebar hidden')
  },

  toggle: function () {
    if (this.isOpen) {
      this.hide()
    } else {
      this.show()
    }
  },

  handleResize: function () {
    if (this.isOpen) {
      var oldWidth = this.currentWidth
      var newWidth = Math.floor(window.innerWidth * 0.25)

      if (newWidth !== oldWidth) {
        this.currentWidth = newWidth

        if (this.sidebarEl) {
          this.sidebarEl.style.width = newWidth + 'px'
        }

        // Adjust webview margins for the difference
        var widthDiff = newWidth - oldWidth
        webviews.adjustMargin([0, widthDiff, 0, 0])

        console.log('AI Sidebar resized:', oldWidth, '→', newWidth)
      }
    }
  },

  addConversation: function (query, pageContext = null) {
    var conversationId = Date.now().toString()
    var conversation = {
      id: conversationId,
      query: query,
      response: null,
      timestamp: new Date(),
      loading: true,
      pageContext: pageContext
    }

    this.conversations.push(conversation)
    this.renderConversation(conversation)
    this.scrollToBottom()

    // Get LLM response
    this.getLLMResponse(conversationId, query, pageContext)

    return conversationId
  },

  getLLMResponse: async function (conversationId, query, pageContext) {
    var llmConfig = settings.get('llmProvider')

    if (!llmProvider.validateConfiguration(llmConfig).valid) {
      this.updateConversationResponse(conversationId, 'Please configure your LLM provider in Capabilities → Switch LLM... to use AI features.', true)
      return
    }

    try {
      // Create context-aware prompt
      var contextPrompt = query
      if (pageContext && pageContext.title && pageContext.text) {
        contextPrompt = `Context: I'm viewing a webpage titled "${pageContext.title}" with the following content:

${pageContext.text.substring(0, 2000)}...

Question: ${query}

Please answer based on the page content when relevant, or provide general assistance if the question is unrelated to the page.`
      }

      var result = await llmProvider.summarizeText(contextPrompt, pageContext?.title || 'AI Assistant', pageContext?.url || 'N/A', llmConfig)

      if (result.success) {
        this.updateConversationResponse(conversationId, result.summary, false)
      } else {
        this.updateConversationResponse(conversationId, `Error: ${result.error}`, true)
      }
    } catch (error) {
      console.error('AI Sidebar LLM Error:', error)
      this.updateConversationResponse(conversationId, `Error: ${error.message}`, true)
    }
  },

  updateConversationResponse: function (conversationId, response, isError = false) {
    var conversation = this.conversations.find(c => c.id === conversationId)
    if (conversation) {
      conversation.response = response
      conversation.loading = false
      conversation.isError = isError

      this.renderConversation(conversation)
      this.scrollToBottom()
      this.saveState()
    }
  },

  renderConversation: function (conversation) {
    if (!this.conversationsEl) return

    var existingEl = document.getElementById('conversation-' + conversation.id)
    if (existingEl) {
      existingEl.remove()
    }

    var conversationEl = document.createElement('div')
    conversationEl.className = 'ai-conversation'
    conversationEl.id = 'conversation-' + conversation.id

    // User query
    var queryEl = document.createElement('div')
    queryEl.className = 'ai-query' + (conversation.isAutoGenerated ? ' auto-generated' : '')
    var queryHeaderText = conversation.isAutoGenerated
      ? '<i class="i carbon:auto-fix"></i><span data-string="autoSummaryIndicator">Auto-generated summary</span>'
      : '<i class="i carbon:user"></i><span>You</span>'

    queryEl.innerHTML = `
      <div class="ai-message-header">
        ${queryHeaderText}
      </div>
      <div class="ai-message-content">${this.escapeHtml(conversation.query)}</div>
    `
    conversationEl.appendChild(queryEl)

    // AI response
    var responseEl = document.createElement('div')
    responseEl.className = 'ai-response' + (conversation.isError ? ' error' : '')

    if (conversation.loading) {
      responseEl.innerHTML = `
        <div class="ai-message-header">
          <i class="i carbon:ibm-watson"></i>
          <span>AI Assistant</span>
        </div>
        <div class="ai-message-content loading">
          <div class="ai-loading-spinner"></div>
          <span>Thinking...</span>
        </div>
      `
    } else {
      responseEl.innerHTML = `
        <div class="ai-message-header">
          <i class="i carbon:ibm-watson ${conversation.isError ? 'error' : ''}"></i>
          <span>AI Assistant</span>
        </div>
        <div class="ai-message-content">${this.escapeHtml(conversation.response || 'No response received.')}</div>
      `
    }

    conversationEl.appendChild(responseEl)
    this.conversationsEl.appendChild(conversationEl)
  },

  scrollToBottom: function () {
    if (this.conversationsEl) {
      this.conversationsEl.scrollTop = this.conversationsEl.scrollHeight
    }
  },

  clearConversations: function () {
    this.conversations = []
    if (this.conversationsEl) {
      this.conversationsEl.innerHTML = ''
    }
    this.saveState()
  },

  escapeHtml: function (text) {
    var div = document.createElement('div')
    div.textContent = text
    return div.innerHTML
  },

  saveState: function () {
    var state = {
      isOpen: this.isOpen,
      conversations: this.conversations.map(c => ({
        id: c.id,
        query: c.query,
        response: c.response,
        timestamp: c.timestamp,
        loading: false, // Don't persist loading state
        isError: c.isError,
        isAutoGenerated: c.isAutoGenerated
      }))
    }

    // Save to localStorage for persistence across sessions
    try {
      localStorage.setItem('aiSidebarState', JSON.stringify(state))
    } catch (e) {
      console.warn('Failed to save AI sidebar state:', e)
    }
  },

  loadState: function () {
    try {
      var savedState = localStorage.getItem('aiSidebarState')
      if (savedState) {
        var state = JSON.parse(savedState)

        // Restore conversations
        if (state.conversations && Array.isArray(state.conversations)) {
          this.conversations = state.conversations
          this.conversations.forEach(c => this.renderConversation(c))
        }

        // Restore sidebar state
        if (state.isOpen) {
          this.show()
        }
      }
    } catch (e) {
      console.warn('Failed to load AI sidebar state:', e)
    }
  },

  // Get current page context for AI queries
  getCurrentPageContext: function (callback) {
    if (!tabs.getSelected()) {
      callback(null)
      return
    }

    // Extract page content using same logic as Page Summarizer
    webviews.callAsync(tabs.getSelected(), 'executeJavaScript', `
      (function() {
        function isVisible(el) {
          return el.offsetWidth || el.offsetHeight || (el.getClientRects && el.getClientRects().length)
        }

        function extractPageText(doc, win) {
          var maybeNodes = [].slice.call(doc.body.childNodes)
          var textNodes = []
          var ignore = 'link, style, script, noscript, .hidden, .visually-hidden, .visuallyhidden, [role=presentation], [hidden], [style*="display:none"], [style*="display: none"], .ad, .dialog, .modal, select, svg, details:not([open]), header, nav, footer'

          while (maybeNodes.length) {
            var node = maybeNodes.shift()
            if (node.matches && node.matches(ignore)) {
              continue
            }
            if (node.nodeType === 3) {
              textNodes.push(node)
              continue
            }
            if (!isVisible(node)) {
              continue
            }
            var childNodes = node.childNodes
            var cnl = childNodes.length
            for (var i = cnl - 1; i >= 0; i--) {
              var childNode = childNodes[i]
              maybeNodes.unshift(childNode)
            }
          }

          var text = ''
          var tnl = textNodes.length
          for (var i = 0; i < tnl; i++) {
            text += textNodes[i].textContent + ' '
          }

          var mt = doc.head.querySelector('meta[name=description]')
          if (mt) {
            text += ' ' + mt.content
          }

          text = text.trim()
          text = text.replace(/[\\n\\t]/g, ' ')
          text = text.replace(/\\s{2,}/g, ' ')
          
          return text.substring(0, 5000) // Limit for performance
        }

        var text = extractPageText(document, window)
        
        return {
          title: document.title,
          url: window.location.href,
          text: text
        }
      })()
    `, function (err, pageData) {
      if (err) {
        console.warn('Failed to get page context:', err)
        callback(null)
      } else {
        callback(pageData)
      }
    })
  },

  // Analyze page content to determine if auto-summarization should be triggered
  analyzePageForAutoSummarization: function (callback) {
    console.log('🔍 Starting auto-summarization analysis...')

    if (!tabs.getSelected()) {
      console.log('❌ No tab selected, skipping analysis')
      callback(null, { shouldSummarize: false, analysis: null })
      return
    }

    // Get the sensitivity setting
    var sensitivityLevel = settings.get('autoSummarizationLevel')
    console.log('📋 Auto-summarization setting retrieved:', sensitivityLevel || 'undefined (defaulting to off)')

    if (!sensitivityLevel || sensitivityLevel === 'off') {
      console.log('❌ Auto-summarization is disabled')
      callback(null, { shouldSummarize: false, analysis: null })
      return
    }

    // Extract and analyze page content
    webviews.callAsync(tabs.getSelected(), 'executeJavaScript', `
        (function() {
          function isVisible(el) {
            return el.offsetWidth || el.offsetHeight || (el.getClientRects && el.getClientRects().length)
          }

          function analyzePageContent() {
            var body = document.body
            if (!body) return null

            // Count words in text content
            var textNodes = []
            var maybeNodes = [].slice.call(body.childNodes)
            var ignore = 'link, style, script, noscript, .hidden, .visually-hidden, .visuallyhidden, [role=presentation], [hidden], [style*="display:none"], [style*="display: none"], .ad, .dialog, .modal, select, svg, details:not([open]), header, nav, footer'

            while (maybeNodes.length) {
              var node = maybeNodes.shift()
              if (node.matches && node.matches(ignore)) {
                continue
              }
              if (node.nodeType === 3) {
                textNodes.push(node)
                continue
              }
              if (!isVisible(node)) {
                continue
              }
              var childNodes = node.childNodes
              var cnl = childNodes.length
              for (var i = cnl - 1; i >= 0; i--) {
                var childNode = childNodes[i]
                maybeNodes.unshift(childNode)
              }
            }

            var text = ''
            var tnl = textNodes.length
            for (var i = 0; i < tnl; i++) {
              text += textNodes[i].textContent + ' '
            }

            // Clean and normalize text
            text = text.trim()
            text = text.replace(/[\\n\\t]/g, ' ')
            text = text.replace(/\\s{2,}/g, ' ')

            // Count words (split by whitespace and filter empty strings)
            var wordCount = text.split(/\\s+/).filter(word => word.length > 0).length

            // Count images
            var images = document.querySelectorAll('img:not([hidden]):not([style*="display:none"]):not([style*="display: none"])')
            var visibleImages = 0
            for (var i = 0; i < images.length; i++) {
              if (isVisible(images[i])) {
                visibleImages++
              }
            }

            // Count videos
            var videos = document.querySelectorAll('video:not([hidden]):not([style*="display:none"]):not([style*="display: none"])')
            var visibleVideos = 0
            for (var i = 0; i < videos.length; i++) {
              if (isVisible(videos[i])) {
                visibleVideos++
              }
            }

            // Calculate content metrics
            var totalMediaElements = visibleImages + visibleVideos
            var textToMediaRatio = totalMediaElements > 0 ? wordCount / totalMediaElements : wordCount
            
            // Calculate text density (characters per line)
            var textLines = text.split('.').length
            var textDensity = textLines > 0 ? text.length / textLines : text.length

            return {
              wordCount: wordCount,
              imageCount: visibleImages,
              videoCount: visibleVideos,
              totalMediaElements: totalMediaElements,
              textToMediaRatio: textToMediaRatio,
              textDensity: textDensity,
              textLength: text.length,
              title: document.title,
              url: window.location.href
            }
          }

          return analyzePageContent()
        })()
      `, (err, analysis) => {
      if (err || !analysis) {
        console.warn('Failed to analyze page content:', err)
        callback(null, { shouldSummarize: false, analysis: null })
        return
      }

      // Log detailed analysis results
      console.log('=== AUTO-SUMMARIZATION ANALYSIS ===')
      console.log('Page:', analysis.title)
      console.log('URL:', analysis.url)
      console.log('Sensitivity Level:', sensitivityLevel)
      console.log('Analysis Results:')
      console.log('  - Word Count:', analysis.wordCount)
      console.log('  - Text Length:', analysis.textLength, 'characters')
      console.log('  - Images:', analysis.imageCount)
      console.log('  - Videos:', analysis.videoCount)
      console.log('  - Total Media:', analysis.totalMediaElements)
      console.log('  - Text-to-Media Ratio:', analysis.textToMediaRatio.toFixed(2))
      console.log('  - Text Density:', analysis.textDensity.toFixed(2))

      // Determine if page meets auto-summarization criteria
      var shouldSummarize = this.shouldAutoSummarizePage(analysis, sensitivityLevel)
      console.log('Should Auto-Summarize:', shouldSummarize)
      console.log('=== END ANALYSIS ===')

      callback(null, { shouldSummarize: shouldSummarize, analysis: analysis })
    })
  },

  // Determine if a page should be auto-summarized based on content analysis and sensitivity
  shouldAutoSummarizePage: function (analysis, sensitivityLevel) {
    console.log('--- THRESHOLD ANALYSIS ---')

    // Minimum requirements for any summarization
    if (analysis.wordCount < 200 || analysis.textLength < 1000) {
      console.log('❌ Failed minimum requirements:')
      console.log('   Word count:', analysis.wordCount, '(need >= 200)')
      console.log('   Text length:', analysis.textLength, '(need >= 1000)')
      return false
    }

    // Define thresholds based on sensitivity level
    var thresholds = {
      high: {
        minWordCount: 500,
        minTextToMediaRatio: 50,
        minTextDensity: 30
      },
      medium: {
        minWordCount: 700,
        minTextToMediaRatio: 100,
        minTextDensity: 40
      },
      low: {
        minWordCount: 1200,
        minTextToMediaRatio: 200,
        minTextDensity: 50
      }
    }

    var threshold = thresholds[sensitivityLevel] || thresholds.medium

    console.log('Using', sensitivityLevel, 'sensitivity thresholds:')
    console.log('  - Min Word Count:', threshold.minWordCount)
    console.log('  - Min Text-to-Media Ratio:', threshold.minTextToMediaRatio)
    console.log('  - Min Text Density:', threshold.minTextDensity)

    // Check each criteria individually
    var wordCountMet = analysis.wordCount >= threshold.minWordCount
    var ratioMet = analysis.textToMediaRatio >= threshold.minTextToMediaRatio
    var densityMet = analysis.textDensity >= threshold.minTextDensity

    console.log('Threshold Checks:')
    console.log('  ✓ Word Count:', wordCountMet ? '✅' : '❌', analysis.wordCount, '>=', threshold.minWordCount)
    console.log('  ✓ Text-to-Media Ratio:', ratioMet ? '✅' : '❌', analysis.textToMediaRatio.toFixed(2), '>=', threshold.minTextToMediaRatio)
    console.log('  ✓ Text Density:', densityMet ? '✅' : '❌', analysis.textDensity.toFixed(2), '>=', threshold.minTextDensity)

    var result = wordCountMet && ratioMet && densityMet
    console.log('Final Result:', result ? '✅ TRIGGER' : '❌ NO TRIGGER')

    return result
  },

  // Trigger auto-summarization for the current page
  triggerAutoSummarization: function () {
    this.getCurrentPageContext((pageContext) => {
      if (pageContext && pageContext.text && pageContext.text.length > 200) {
        // Add auto-summarization with indicator
        var query = "Please provide a concise summary of this page's main content and key points."
        var conversationId = this.addConversation(query, pageContext)
        // Mark this conversation as auto-generated
        var conversation = this.conversations.find(c => c.id === conversationId)
        if (conversation) {
          conversation.isAutoGenerated = true
        }

        // Show the sidebar if it's not already open
        if (!this.isOpen) {
          this.show()
        }

        console.log('Auto-summarization triggered for:', pageContext.title)
      }
    })
  }
}

module.exports = aiSidebar
