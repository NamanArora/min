// Note: BrowserWindow and ipc are already available from main.js

let spotlightWindow = null

const aiSpotlightPage = 'min://app/pages/aiSpotlight/index.html'

function createSpotlightWindow (parent) {
  if (spotlightWindow) {
    spotlightWindow.focus()
    return spotlightWindow
  }

  spotlightWindow = new BrowserWindow({
    width: 600,
    height: 200,
    minWidth: 400,
    minHeight: 150,
    maxWidth: 800,
    maxHeight: 400,
    parent: parent,
    modal: true,
    show: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true,
      webSecurity: false
    }
  })

  spotlightWindow.loadURL(aiSpotlightPage)

  // Auto-resize based on content
  spotlightWindow.webContents.on('did-finish-load', () => {
    spotlightWindow.webContents.executeJavaScript(`
      const updateSize = () => {
        const body = document.body;
        const html = document.documentElement;
        const height = Math.max(
          body.scrollHeight, body.offsetHeight,
          html.clientHeight, html.scrollHeight, html.offsetHeight
        );
        const width = Math.max(
          body.scrollWidth, body.offsetWidth,
          html.clientWidth, html.scrollWidth, html.offsetWidth
        );
        window.electronAPI.resizeWindow(Math.max(400, Math.min(800, width)), Math.max(150, Math.min(400, height)));
      };
      
      // Initial size update
      setTimeout(updateSize, 100);
      
      // Update size when content changes
      const observer = new MutationObserver(updateSize);
      observer.observe(document.body, { childList: true, subtree: true });
    `)
  })

  // Center on parent window
  if (parent) {
    const [parentX, parentY] = parent.getPosition()
    const [parentWidth, parentHeight] = parent.getSize()
    const [width, height] = spotlightWindow.getSize()

    spotlightWindow.setPosition(
      parentX + Math.round((parentWidth - width) / 2),
      parentY + Math.round((parentHeight - height) / 3) // Slightly above center
    )
  }

  // Clean up when window is closed
  spotlightWindow.on('closed', () => {
    spotlightWindow = null
  })

  // Hide on blur unless clicking within the window
  spotlightWindow.on('blur', () => {
    if (spotlightWindow && !spotlightWindow.isDestroyed()) {
      spotlightWindow.hide()
    }
  })

  return spotlightWindow
}

function showSpotlight (parentWindow) {
  const window = createSpotlightWindow(parentWindow)

  if (window) {
    // Center the window on the parent
    if (parentWindow) {
      const [parentX, parentY] = parentWindow.getPosition()
      const [parentWidth, parentHeight] = parentWindow.getSize()
      const [width, height] = window.getSize()

      window.setPosition(
        parentX + Math.round((parentWidth - width) / 2),
        parentY + Math.round((parentHeight - height) / 3)
      )
    }

    window.show()
    window.focus()

    // Focus the input field after showing
    window.webContents.executeJavaScript('document.querySelector("#ai-spotlight-input")?.focus()')
  }
}

function hideSpotlight () {
  if (spotlightWindow && !spotlightWindow.isDestroyed()) {
    spotlightWindow.hide()
  }
}

function destroySpotlight () {
  if (spotlightWindow && !spotlightWindow.isDestroyed()) {
    spotlightWindow.destroy()
    spotlightWindow = null
  }
}

// Initialize IPC handlers - called after ipc is available
function initializeSpotlightIPC () {
  ipc.on('ai-spotlight-submit', (event, query) => {
    // Forward the query to the main window using Min's window management
    try {
      const currentWindow = windows.getCurrent()
      if (currentWindow) {
        const webContents = getWindowWebContents(currentWindow)
        if (webContents) {
          webContents.send('ai-spotlight-query', query)
        } else {
          console.error('AI Spotlight: Could not get webContents for current window')
        }
      } else {
        console.error('AI Spotlight: Could not get current window')
      }
    } catch (error) {
      console.error('AI Spotlight: Error forwarding query to main window:', error)
    }
    hideSpotlight()
  })

  ipc.on('ai-spotlight-hide', () => {
    hideSpotlight()
  })

  ipc.on('resize-spotlight-window', (event, width, height) => {
    if (spotlightWindow && !spotlightWindow.isDestroyed()) {
      spotlightWindow.setSize(width, height)
    }
  })
}

// Functions are available globally in the concatenated build
// No module.exports needed since this is concatenated with main.js
