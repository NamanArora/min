const electron = require('electron')
const fs = require('fs')
const path = require('path')

const {
  app, // Module to control application life.
  protocol, // Module to control protocol handling
  BaseWindow, // Module to create native browser window.
  BrowserWindow,
  webContents,
  session,
  ipcMain: ipc,
  Menu, MenuItem,
  crashReporter,
  dialog,
  nativeTheme,
  shell,
  net,
  WebContentsView
} = electron

crashReporter.start({
  submitURL: 'https://minbrowser.org/',
  uploadToServer: false,
  compress: true
})

if (process.argv.some(arg => arg === '-v' || arg === '--version')) {
  console.log('Min: ' + app.getVersion())
  console.log('Chromium: ' + process.versions.chrome)
  process.exit()
}

let isInstallerRunning = false
const isDevelopmentMode = process.argv.some(arg => arg === '--development-mode')
const isDebuggingEnabled = process.argv.some(arg => arg === '--debug-browser')

function clamp (n, min, max) {
  return Math.max(Math.min(n, max), min)
}

if (process.platform === 'win32') {
  (async function () {
    var squirrelCommand = process.argv[1]
    if (squirrelCommand === '--squirrel-install' || squirrelCommand === '--squirrel-updated') {
      isInstallerRunning = true
      await registryInstaller.install()
    }
    if (squirrelCommand === '--squirrel-uninstall') {
      isInstallerRunning = true
      await registryInstaller.uninstall()
    }
    if (require('electron-squirrel-startup')) {
      app.quit()
    }
  })()
}

if (isDevelopmentMode) {
  app.setPath('userData', app.getPath('userData') + '-development')
}

// workaround for flicker when focusing app (https://github.com/electron/electron/issues/17942)
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows', 'true')

var userDataPath = app.getPath('userData')

settings.initialize(userDataPath)

if (settings.get('userSelectedLanguage')) {
  app.commandLine.appendSwitch('lang', settings.get('userSelectedLanguage'))
}

const browserPage = 'min://app/index.html'

var mainMenu = null
var secondaryMenu = null
var isFocusMode = false
var appIsReady = false

const isFirstInstance = app.requestSingleInstanceLock()

if (!isFirstInstance) {
  app.quit()
  return
}

var saveWindowBounds = function () {
  if (windows.getCurrent()) {
    var bounds = Object.assign(windows.getCurrent().getBounds(), {
      maximized: windows.getCurrent().isMaximized()
    })
    fs.writeFileSync(path.join(userDataPath, 'windowBounds.json'), JSON.stringify(bounds))
  }
}

function sendIPCToWindow (window, action, data) {
  if (window && window.isDestroyed()) {
    console.warn('ignoring message ' + action + ' sent to destroyed window')
    return
  }

  if (window && getWindowWebContents(window).isLoadingMainFrame()) {
    // immediately after a did-finish-load event, isLoading can still be true,
    // so wait a bit to confirm that the page is really loading
    setTimeout(function() {
      if (getWindowWebContents(window).isLoadingMainFrame()) {
        getWindowWebContents(window).once('did-finish-load', function () {
          getWindowWebContents(window).send(action, data || {})
        })
      } else {
         getWindowWebContents(window).send(action, data || {})
      }
    }, 0)
  } else if (window) {
    getWindowWebContents(window).send(action, data || {})
  } else {
    var window = createWindow()
    getWindowWebContents(window).once('did-finish-load', function () {
      getWindowWebContents(window).send(action, data || {})
    })
  }
}

function openTabInWindow (url) {
  sendIPCToWindow(windows.getCurrent(), 'addTab', {
    url: url
  })
}

function handleCommandLineArguments (argv) {
  // the "ready" event must occur before this function can be used
  if (argv) {
    argv.forEach(function (arg, idx) {
      if (arg && arg.toLowerCase() !== __dirname.toLowerCase()) {
        // URL
        if (arg.indexOf('://') !== -1) {
          sendIPCToWindow(windows.getCurrent(), 'addTab', {
            url: arg
          })
        } else if (idx > 0 && argv[idx - 1] === '-s') {
          // search
          sendIPCToWindow(windows.getCurrent(), 'addTab', {
            url: arg
          })
        } else if (/\.(m?ht(ml)?|pdf)$/.test(arg) && fs.existsSync(arg)) {
          // local files (.html, .mht, mhtml, .pdf)
          sendIPCToWindow(windows.getCurrent(), 'addTab', {
            url: 'file://' + path.resolve(arg)
          })
        }
      }
    })
  }
}

function createWindow (customArgs = {}) {
  var bounds;

  try {
    var data = fs.readFileSync(path.join(userDataPath, 'windowBounds.json'), 'utf-8')
    bounds = JSON.parse(data)
  } catch (e) {}

  if (!bounds) { // there was an error, probably because the file doesn't exist
    var size = electron.screen.getPrimaryDisplay().workAreaSize
    bounds = {
      x: 0,
      y: 0,
      width: size.width,
      height: size.height,
      maximized: true
    }
  }

  // make the bounds fit inside a currently-active screen
  // (since the screen Min was previously open on could have been removed)
  // see: https://github.com/minbrowser/min/issues/904
  var containingRect = electron.screen.getDisplayMatching(bounds).workArea

  bounds = {
    x: clamp(bounds.x, containingRect.x, (containingRect.x + containingRect.width) - bounds.width),
    y: clamp(bounds.y, containingRect.y, (containingRect.y + containingRect.height) - bounds.height),
    width: clamp(bounds.width, 0, containingRect.width),
    height: clamp(bounds.height, 0, containingRect.height),
    maximized: bounds.maximized
  }

  return createWindowWithBounds(bounds, customArgs)
}

function createWindowWithBounds (bounds, customArgs) {
  const newWin = new BaseWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    minWidth: (process.platform === 'win32' ? 400 : 320), // controls take up more horizontal space on Windows
    minHeight: 350,
    titleBarStyle: settings.get('useSeparateTitlebar') ? 'default' : 'hidden',
    trafficLightPosition: { x: 12, y: 10 },
    icon: __dirname + '/icons/icon256.png',
    frame: settings.get('useSeparateTitlebar'),
    alwaysOnTop: settings.get('windowAlwaysOnTop'),
    backgroundColor: '#fff', // the value of this is ignored, but setting it seems to work around https://github.com/electron/electron/issues/10559
  })

  // windows and linux always use a menu button in the upper-left corner instead
  // if frame: false is set, this won't have any effect, but it does apply on Linux if "use separate titlebar" is enabled
  if (process.platform !== 'darwin') {
    newWin.setMenuBarVisibility(false)
  }

  const mainView = new WebContentsView({
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      nodeIntegrationInWorker: true, // used by ProcessSpawner
      additionalArguments: [
        '--user-data-path=' + userDataPath,
        '--app-version=' + app.getVersion(),
        '--app-name=' + app.getName(),
        ...((isDevelopmentMode ? ['--development-mode'] : [])),
        '--window-id=' + windows.nextId,
        ...((windows.getAll().length === 0 ? ['--initial-window'] : [])),
        ...(windows.hasEverCreatedWindow ? [] : ['--launch-window']),
        ...(customArgs.initialTask ? ['--initial-task=' + customArgs.initialTask] : [])
      ]
    }
  })
  mainView.webContents.loadURL(browserPage)

  if (bounds.maximized) {
    newWin.maximize()

    mainView.webContents.once('did-finish-load', function () {
      sendIPCToWindow(newWin, 'maximize')
    })
  }

  const winBounds = newWin.getContentBounds()

  mainView.setBounds({x: 0, y: 0, width: winBounds.width, height: winBounds.height})
  newWin.contentView.addChildView(mainView)

  // sometimes getContentBounds doesn't provide correct bounds until after the window has finished loading
  mainView.webContents.once('did-finish-load', function () {
    const winBounds = newWin.getContentBounds()
    mainView.setBounds({x: 0, y: 0, width: winBounds.width, height: winBounds.height})
  })

  newWin.on('resize', function () {
    // The result of getContentBounds doesn't update until the next tick
    setTimeout(function () {
      const winBounds = newWin.getContentBounds()
      mainView.setBounds({x: 0, y: 0, width: winBounds.width, height: winBounds.height})
    }, 0)
  })

  newWin.on('close', function () {
    // save the window size for the next launch of the app
    saveWindowBounds()
  })

  newWin.on('focus', function () {
    if (!windows.getState(newWin).isMinimized) {
      sendIPCToWindow(newWin, 'windowFocus')
    }
  })

  newWin.on('minimize', function () {
    sendIPCToWindow(newWin, 'minimize')
    windows.getState(newWin).isMinimized = true
  })

  newWin.on('restore', function () {
    windows.getState(newWin).isMinimized = false
  })

  newWin.on('maximize', function () {
    sendIPCToWindow(newWin, 'maximize')
  })

  newWin.on('unmaximize', function () {
    sendIPCToWindow(newWin, 'unmaximize')
  })
  
  newWin.on('focus', function () {
    sendIPCToWindow(newWin, 'focus')
  })

  newWin.on('blur', function () {
    // if the devtools for this window are focused, this check will be false, and we keep the focused class on the window
    if (BaseWindow.getFocusedWindow() !== newWin) {
      sendIPCToWindow(newWin, 'blur')
    }
  })

  newWin.on('enter-full-screen', function () {
    sendIPCToWindow(newWin, 'enter-full-screen')
  })

  newWin.on('leave-full-screen', function () {
    sendIPCToWindow(newWin, 'leave-full-screen')
    // https://github.com/minbrowser/min/issues/1093
    newWin.setMenuBarVisibility(false)
  })

  newWin.on('enter-html-full-screen', function () {
    sendIPCToWindow(newWin, 'enter-html-full-screen')
  })

  newWin.on('leave-html-full-screen', function () {
    sendIPCToWindow(newWin, 'leave-html-full-screen')
    // https://github.com/minbrowser/min/issues/952
    newWin.setMenuBarVisibility(false)
  })

  /*
  Handles events from mouse buttons
  Unsupported on macOS, and on Linux, there is a default handler already,
  so registering a handler causes events to happen twice.
  See: https://github.com/electron/electron/issues/18322
  */
  if (process.platform === 'win32') {
    newWin.on('app-command', function (e, command) {
      if (command === 'browser-backward') {
        sendIPCToWindow(newWin, 'goBack')
      } else if (command === 'browser-forward') {
        sendIPCToWindow(newWin, 'goForward')
      }
    })
  }

  // prevent remote pages from being loaded using drag-and-drop, since they would have node access
  mainView.webContents.on('will-navigate', function (e, url) {
    if (url !== browserPage) {
      e.preventDefault()
    }
  })

  mainView.webContents.on('before-input-event', function(e, input) {
    sendIPCToWindow(newWin, 'before-input-event', input)
  })

  newWin.setTouchBar(buildTouchBar())

  windows.addWindow(newWin)

  return newWin
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
app.on('ready', function () {
  settings.set('restartNow', false)
  appIsReady = true

  /* the installer launches the app to install registry items and shortcuts,
  but if that's happening, we shouldn't display anything */
  if (isInstallerRunning) {
    return
  }

  registerBundleProtocol(session.defaultSession)

  // Initialize AI Spotlight IPC handlers
  initializeSpotlightIPC()

  // AI Spotlight IPC handler
  ipc.on('showAISpotlight', function (e) {
    const senderWindow = windows.windowFromContents(e.sender)
    if (senderWindow && senderWindow.win) {
      showSpotlight(senderWindow.win)
    }
  })

  const newWin = createWindow()

  getWindowWebContents(newWin).on('did-finish-load', function () {
    // if a URL was passed as a command line argument (probably because Min is set as the default browser on Linux), open it.
    handleCommandLineArguments(process.argv)

    // there is a URL from an "open-url" event (on Mac)
    if (global.URLToOpen) {
      // if there is a previously set URL to open (probably from opening a link on macOS), open it
      sendIPCToWindow(newWin, 'addTab', {
        url: global.URLToOpen
      })
      global.URLToOpen = null
    }
  })

  mainMenu = buildAppMenu()
  Menu.setApplicationMenu(mainMenu)
  createDockMenu()
})

app.on('open-url', function (e, url) {
  if (appIsReady) {
    sendIPCToWindow(windows.getCurrent(), 'addTab', {
      url: url
    })
  } else {
    global.URLToOpen = url // this will be handled later in the createWindow callback
  }
})

// handoff support for macOS
app.on('continue-activity', function(e, type, userInfo, details) {
  if (type === 'NSUserActivityTypeBrowsingWeb' && details.webpageURL) {
    e.preventDefault()
    sendIPCToWindow(windows.getCurrent(), 'addTab', {
      url: details.webpageURL
    })
  }
})

app.on('second-instance', function (e, argv, workingDir) {
  if (windows.getCurrent()) {
    if (windows.getCurrent().isMinimized()) {
      windows.getCurrent().restore()
    }
    windows.getCurrent().focus()
    // add a tab with the new URL
    handleCommandLineArguments(argv)
  }
})

/**
 * Emitted when the application is activated, which usually happens when clicks on the applications's dock icon
 * https://github.com/electron/electron/blob/master/docs/api/app.md#event-activate-os-x
 *
 * Opens a new tab when all tabs are closed, and min is still open by clicking on the application dock icon
 */
app.on('activate', function (/* e, hasVisibleWindows */) {
  if (!windows.getCurrent() && appIsReady) { // sometimes, the event will be triggered before the app is ready, and creating new windows will fail
    createWindow()
  }
})

ipc.on('focusMainWebContents', function () {
  getWindowWebContents(windows.getCurrent()).focus()
})

// Auto-Clean Tabs: route requests from settings/preload to the current window
ipc.on('showAllHiddenTabs', function (e) {
  const senderWindow = windows.windowFromContents(e.sender)
  sendIPCToWindow(senderWindow || windows.getCurrent(), 'showAllHiddenTabs')
})

ipc.on('showSecondaryMenu', function (event, data) {
  if (!secondaryMenu) {
    secondaryMenu = buildAppMenu({ secondary: true })
  }
  secondaryMenu.popup({
    x: data.x,
    y: data.y
  })
})

ipc.on('handoffUpdate', function(e, data) {
  if (app.setUserActivity && data.url && data.url.startsWith('http')) {
    app.setUserActivity('NSUserActivityTypeBrowsingWeb', {}, data.url)
  } else if (app.invalidateCurrentActivity) {
    app.invalidateCurrentActivity()
  }
})

ipc.on('quit', function () {
  app.quit()
})

ipc.on('tab-state-change', function(e, events) {
  const sourceWindowId = windows.windowFromContents(e.sender)?.id
  if (!sourceWindowId) {
    console.warn('warning: received tab state update from window after destruction, ignoring')
    return
  }
  windows.getAll().forEach(function(window) {
    if (getWindowWebContents(window).id !== e.sender.id) {
      getWindowWebContents(window).send('tab-state-change-receive', {
        sourceWindowId,
        events
      })
    }
  })
})

ipc.on('request-tab-state', function(e) {
  const otherWindow = windows.getAll().find(w => getWindowWebContents(w).id !== e.sender.id)
  if (!otherWindow) {
    throw new Error('secondary window doesn\'t exist as source for tab state')
  }
  ipc.once('return-tab-state', function(e2, data) {
    e.returnValue = data
  })
  getWindowWebContents(otherWindow).send('read-tab-state')
})

// Link preview fetcher: returns OG image or first image from target page
// simple in-memory cache
const linkPreviewCache = new Map()

ipc.on('requestLinkPreview', async function (e, data) {
  try {
    if (!data || !data.href) {
      console.log('[LinkPreview] request missing href')
      return
    }
    const href = data.href
    console.log('[LinkPreview] request for', href)
    const cached = linkPreviewCache.get(href)
    if (cached && (Date.now() - cached.t) < 5 * 60 * 1000) {
      console.log('[LinkPreview] cache hit')
      e.sender.send('linkPreviewData', cached.data)
      return
    }

    // Try offscreen capture first
    let dataUrl = null
    let title = null
    try {
      console.log('[LinkPreview] creating offscreen window')
      const off = new BrowserWindow({ show: false, webPreferences: { offscreen: true, contextIsolation: true, sandbox: true } })
      off.setSize(1024, 768)
      const nav = off.loadURL(href)
      const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000))
      await Promise.race([nav, timeout])
      console.log('[LinkPreview] offscreen loaded:', href)
      // small delay to allow layout
      await new Promise(r => setTimeout(r, 400))
      try { title = await off.webContents.executeJavaScript('document.title').catch(() => null) } catch (e2) { console.log('[LinkPreview] title eval failed', e2 && e2.message) }
      const img = await off.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 768 })
      dataUrl = img.toDataURL()
      console.log('[LinkPreview] capture success, length:', dataUrl ? dataUrl.length : 0)
      off.destroy()
    } catch (e1) {
      console.log('[LinkPreview] offscreen failed, fallback to OG scrape:', e1 && e1.message)
      // fallback to OG scraping
      try {
        console.log('[LinkPreview] fetching for OG image', href)
        const res = await fetch(href)
        if (res.ok) {
          const html = await res.text()
          const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)
          const ogMatch = /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i.exec(html) || /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i.exec(html)
          let image = ogMatch ? ogMatch[1] : null
          if (!image) {
            const imgMatch = /<img[^>]+src=["']([^"']+)["'][^>]*>/i.exec(html)
            if (imgMatch) image = imgMatch[1]
          }
          try { if (image) dataUrl = new URL(image, href).toString() } catch (e2) {}
          if (titleMatch) title = titleMatch[1].trim()
          console.log('[LinkPreview] OG parse result image?', !!dataUrl, 'title?', !!title)
        } else {
          console.log('[LinkPreview] fetch not ok', res.status)
        }
      } catch (e2) {
        console.log('[LinkPreview] fetch OG failed', e2 && e2.message)
      }
    }

    const payload = { href, imageUrl: dataUrl || null, title: title || null }
    linkPreviewCache.set(href, { t: Date.now(), data: payload })
    e.sender.send('linkPreviewData', payload)
  } catch (err) {
    console.warn('[LinkPreview] error:', err && err.message)
  }
})

// Preload setting request
ipc.on('getSettingValue', function (e, key) {
  try {
    const value = settings.get(key)
    e.sender.send('settingValue', { key, value })
  } catch (err) {
    e.sender.send('settingValue', { key, value: undefined })
  }
})

/* places service */

const placesPage = 'file://' + __dirname + '/js/places/placesService.html'

let placesWindow = null
app.once('ready', function() {
  placesWindow = new BrowserWindow({
    width: 300,
    height: 300,
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  })

  placesWindow.loadURL(placesPage)
})

ipc.on('places-connect', function (e) {
  placesWindow.webContents.postMessage('places-connect', null, e.ports)
})

function getWindowWebContents (win) {
  return win.getContentView().children[0].webContents
}

/* translate service */

const translatePage = 'min://app/pages/translateService/index.html'
const translatePreload = __dirname + '/pages/translateService/translateServicePreload.js'

app.on('ready', function() {
  ipc.on('page-translation-session-create', function(e) {
    let translateWindow = new BrowserWindow({
      width: 300,
      height: 300,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: translatePreload
      }
    })
  
    translateWindow.loadURL(translatePage)
    // translateWindow.webContents.openDevTools({mode: 'detach'})

    translateWindow.webContents.once('did-finish-load', function() {
      translateWindow.webContents.postMessage('page-translation-session-create', null, e.ports)
    })
  })
})
