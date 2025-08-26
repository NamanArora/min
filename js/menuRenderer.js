/* Handles messages that get sent from the menu bar in the main process */

var webviews = require('webviews.js')
var webviewGestures = require('webviewGestures.js')
var browserUI = require('browserUI.js')
var focusMode = require('focusMode.js')
var modalMode = require('modalMode.js')
var findinpage = require('findinpage.js')
var PDFViewer = require('pdfViewer.js')
var tabEditor = require('navbar/tabEditor.js')
var readerView = require('readerView.js')
var taskOverlay = require('taskOverlay/taskOverlay.js')
var settings = require('util/settings/settings.js')
var llmProvider = require('ai/llmProvider.js')

module.exports = {
  initialize: function () {
    ipc.on('zoomIn', function () {
      webviewGestures.zoomWebviewIn(tabs.getSelected())
    })

    ipc.on('zoomOut', function () {
      webviewGestures.zoomWebviewOut(tabs.getSelected())
    })

    ipc.on('zoomReset', function () {
      webviewGestures.resetWebviewZoom(tabs.getSelected())
    })

    ipc.on('print', function () {
      if (PDFViewer.isPDFViewer(tabs.getSelected())) {
        PDFViewer.printPDF(tabs.getSelected())
      } else if (readerView.isReader(tabs.getSelected())) {
        readerView.printArticle(tabs.getSelected())
      } else if (webviews.placeholderRequests.length === 0) {
        // work around #1281 - calling print() when the view is hidden crashes on Linux in Electron 12
        // TODO figure out why webContents.print() doesn't work in Electron 4
        webviews.callAsync(tabs.getSelected(), 'executeJavaScript', 'window.print()')
      }
    })

    ipc.on('findInPage', function () {
      /* Page search is not available in modal mode. */
      if (modalMode.enabled()) {
        return
      }

      findinpage.start()
    })

    ipc.on('inspectPage', function () {
      webviews.callAsync(tabs.getSelected(), 'toggleDevTools')
    })

    ipc.on('openEditor', function () {
      tabEditor.show(tabs.getSelected())
    })

    ipc.on('showBookmarks', function () {
      tabEditor.show(tabs.getSelected(), '!bookmarks ')
    })

    ipc.on('showHistory', function () {
      tabEditor.show(tabs.getSelected(), '!history ')
    })

    ipc.on('addTab', function (e, data) {
      /* new tabs can't be created in modal mode */
      if (modalMode.enabled()) {
        return
      }

      /* new tabs can't be created in focus mode */
      if (focusMode.enabled()) {
        focusMode.warn()
        return
      }

      var newTab = tabs.add({
        url: data.url || ''
      })

      browserUI.addTab(newTab, {
        enterEditMode: !data.url // only enter edit mode if the new tab is empty
      })
    })

    ipc.on('saveCurrentPage', async function () {
      var currentTab = tabs.get(tabs.getSelected())

      // new tabs cannot be saved
      if (!currentTab.url) {
        return
      }

      // if the current tab is a PDF, let the PDF viewer handle saving the document
      if (PDFViewer.isPDFViewer(tabs.getSelected())) {
        PDFViewer.savePDF(tabs.getSelected())
        return
      }

      if (tabs.get(tabs.getSelected()).isFileView) {
        webviews.callAsync(tabs.getSelected(), 'downloadURL', [tabs.get(tabs.getSelected()).url])
      } else {
        var savePath = await ipc.invoke('showSaveDialog', {
          defaultPath: currentTab.title.replace(/[/\\]/g, '_')
        })

        // savePath will be undefined if the save dialog is canceled
        if (savePath) {
          if (!savePath.endsWith('.html')) {
            savePath = savePath + '.html'
          }
          webviews.callAsync(tabs.getSelected(), 'savePage', [savePath, 'HTMLComplete'])
        }
      }
    })

    ipc.on('addPrivateTab', function () {
      /* new tabs can't be created in modal mode */
      if (modalMode.enabled()) {
        return
      }

      /* new tabs can't be created in focus mode */
      if (focusMode.enabled()) {
        focusMode.warn()
        return
      }

      browserUI.addTab(tabs.add({
        private: true
      }))
    })

    ipc.on('toggleTaskOverlay', function () {
      taskOverlay.toggle()
    })

    ipc.on('goBack', function () {
      webviews.callAsync(tabs.getSelected(), 'goBack')
    })

    ipc.on('goForward', function () {
      webviews.callAsync(tabs.getSelected(), 'goForward')
    })

    ipc.on('summarizePage', function () {
      // Check LLM configuration
      var llmConfig = settings.get('llmProvider')
      var validation = llmProvider.validateConfiguration(llmConfig)
      
      // Check if using fallback API implementation
      if (llmProvider.isUsingFallback()) {
        console.log('ℹ️  Using direct API implementation (llm.js library unavailable)')
        var loadError = llmProvider.getLoadError()
        if (loadError) {
          console.log('   Library load error:', loadError.error)
          if (loadError.error.includes('Maximum call stack size exceeded')) {
            console.log('   ⚠️  Circular dependency in build system - using reliable fallback')
          }
        }
        console.log('   ✅ AI summarization still available via direct API calls')
      } else {
        console.log('✅ LLM.js library loaded successfully')
      }

      if (!validation.valid) {
        console.log('⚠️  LLM Provider not configured')
        console.log('   ' + validation.message)
        console.log('   Use Capabilities → Switch LLM... to configure AI models')
      } else {
        console.log('✅ LLM Provider configured')
        console.log('   Model:', llmConfig.modelName)
        console.log('   Provider:', validation.provider)
        console.log('   API Key:', llmConfig.apiKey ? 'Present' : 'Missing')
      }
      
      // Extract page content using the same logic as textExtractor.js
      webviews.callAsync(tabs.getSelected(), 'executeJavaScript', `
        (function() {
          // Reuse the page text extraction logic from textExtractor.js
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

            // Add meta description if available
            var mt = doc.head.querySelector('meta[name=description]')
            if (mt) {
              text += ' ' + mt.content
            }

            text = text.trim()
            text = text.replace(/[\\n\\t]/g, ' ')
            text = text.replace(/\\s{2,}/g, ' ')
            
            // Limit to 300KB like the original textExtractor
            return text.substring(0, 300000)
          }

          var text = extractPageText(document, window)
          
          // Try to extract from same-origin iframes
          var frames = document.querySelectorAll('iframe')
          for (var x = 0; x < frames.length; x++) {
            try {
              text += '. ' + extractPageText(frames[x].contentDocument, frames[x].contentWindow)
            } catch (e) {}
          }

          return {
            title: document.title,
            url: window.location.href,
            textLength: text.length,
            extractedText: text
          }
        })()
      `, function (err, pageData) {
        if (err) {
          console.error('Failed to extract page content:', err)
          return
        }
        
        if (!pageData || !pageData.extractedText) {
          console.log('Page Summarizer: No content could be extracted from this page')
          return
        }

        // Display extraction results
        console.log('=== PAGE SUMMARIZER RESULTS ===')
        console.log('Page Title:', pageData.title)
        console.log('Page URL:', pageData.url)
        console.log('Content Length:', pageData.textLength, 'characters')

        // If LLM is configured, generate AI summary
        if (validation.valid && pageData.extractedText.length > 50) {
          console.log('\\n🤖 Generating AI Summary...')
          
          llmProvider.summarizeText(
            pageData.extractedText, 
            pageData.title, 
            pageData.url, 
            llmConfig
          ).then(function (result) {
            console.log('\\n--- AI SUMMARY ---')
            if (result.success) {
              var method = result.method || (llmProvider.isUsingFallback() ? 'direct-api' : 'llm.js')
              console.log('✅ Summary generated by', result.model, '(' + result.provider + ') via', method + ':')
              console.log(result.summary)
            } else {
              console.log('❌ Failed to generate summary:', result.error)
              console.log('   Model:', result.model, '(' + result.provider + ')')
            }
            
            console.log('\\n--- EXTRACTED CONTENT ---')
            console.log(pageData.extractedText)
            console.log('\\n=== END SUMMARIZER RESULTS ===')
          }).catch(function (error) {
            console.log('\\n--- AI SUMMARY ---')
            console.log('❌ Error generating summary:', error.message)
            
            console.log('\\n--- EXTRACTED CONTENT ---')
            console.log(pageData.extractedText)
            console.log('\\n=== END SUMMARIZER RESULTS ===')
          })
        } else {
          // Just show extracted content without AI summary
          console.log('\\n--- EXTRACTED CONTENT ---')
          console.log(pageData.extractedText)
          console.log('\\n=== END SUMMARIZER RESULTS ===')
        }
      })
    })

    ipc.on('toggleAISidebar', function () {
      var aiSidebar = require('ai/aiSidebar.js')
      aiSidebar.toggle()
      console.log('AI Sidebar toggled:', aiSidebar.isOpen ? 'opened' : 'closed')
    })
  }
}
