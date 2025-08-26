var aiSidebar = require('./aiSidebar.js')

/* global ipc */

// AI Spotlight dialog manager
var aiSpotlight = {
  initialize: function () {
    // Set up event listeners
    this.setupEventListeners()

    console.log('AI Spotlight initialized (modal window mode)')
  },

  setupEventListeners: function () {
    // Listen for queries from the modal spotlight window
    ipc.on('ai-spotlight-query', (event, query) => {
      this.handleQueryFromModal(query)
    })
  },

  handleQueryFromModal: function (query) {
    console.log('AI Spotlight: Received query from modal:', query)

    // Ensure sidebar is open
    if (!aiSidebar.isOpen) {
      aiSidebar.show()
    }

    // Get current page context and add conversation
    aiSidebar.getCurrentPageContext((pageContext) => {
      aiSidebar.addConversation(query, pageContext)
    })

    console.log('AI Spotlight: Query processed, added to sidebar')
  }
}

module.exports = aiSpotlight
