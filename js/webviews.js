var urlParser = require('util/urlParser.js')
var settings = require('util/settings/settings.js')

/* implements selecting webviews, switching between them, and creating new ones. */

var placeholderImg = document.getElementById('webview-placeholder')

var hasSeparateTitlebar = settings.get('useSeparateTitlebar')
var windowIsMaximized = false // affects navbar height on Windows
var windowIsFullscreen = false

function captureCurrentTab (options) {
  if (tabs.get(tabs.getSelected()).private) {
    // don't capture placeholders for private tabs
    return
  }

  if (webviews.placeholderRequests.length > 0 && !(options && options.forceCapture === true)) {
    // capturePage doesn't work while the view is hidden
    return
  }

  ipc.send('getCapture', {
    id: webviews.selectedId,
    width: Math.round(window.innerWidth / 10),
    height: Math.round(window.innerHeight / 10)
  })
}

// called whenever a new page starts loading, or an in-page navigation occurs
function onPageURLChange (tab, url) {
  if (url.indexOf('https://') === 0 || url.indexOf('about:') === 0 || url.indexOf('chrome:') === 0 || url.indexOf('file://') === 0 || url.indexOf('min://') === 0) {
    tabs.update(tab, {
      secure: true,
      url: url
    })
  } else {
    tabs.update(tab, {
      secure: false,
      url: url
    })
  }

  webviews.callAsync(tab, 'setVisualZoomLevelLimits', [1, 3])
}

// called whenever a navigation finishes
function onNavigate (tabId, url, isInPlace, isMainFrame, frameProcessId, frameRoutingId) {
  if (isMainFrame) {
    onPageURLChange(tabId, url)
  }
}

// called whenever the page finishes loading
function onPageLoad (tabId) {
  console.log('📄 Page loaded for tab:', tabId, 'selected:', tabs.getSelected())

  // capture a preview image if a new page has been loaded
  if (tabId === tabs.getSelected()) {
    setTimeout(function () {
      // sometimes the page isn't visible until a short time after the did-finish-load event occurs
      captureCurrentTab()
    }, 250)

    // Check for auto-summarization after a short delay to ensure content is fully loaded
    setTimeout(function () {
      if (tabId === tabs.getSelected()) {
        console.log('⏰ Auto-summarization timer triggered for tab:', tabId)
        var aiSidebar = require('ai/aiSidebar.js')
        aiSidebar.analyzePageForAutoSummarization(function (err, result) {
          if (!err && result && result.shouldSummarize) {
            console.log('🎯 Auto-summarization conditions met for:', result.analysis.title)
            console.log('📊 Analysis details:', result.analysis)
            aiSidebar.triggerAutoSummarization()
          } else {
            console.log('📝 Auto-summarization check complete - no trigger')
          }
        })
      } else {
        console.log('⏰ Auto-summarization timer fired but tab is no longer selected')
      }
    }, 3000) // Wait 3 seconds for dynamic content to load
  }
}

function scrollOnLoad (tabId, scrollPosition) {
  const listener = function (eTabId) {
    if (eTabId === tabId) {
      // the scrollable content may not be available until some time after the load event, so attempt scrolling several times
      // but stop once we've successfully scrolled once so we don't overwrite user scroll attempts that happen later
      for (let i = 0; i < 3; i++) {
        var done = false
        setTimeout(function () {
          if (!done) {
            webviews.callAsync(tabId, 'executeJavaScript', `
            (function() {
              window.scrollTo(0, ${scrollPosition})
              return window.scrollY === ${scrollPosition}
            })()
            `, function (err, completed) {
              if (!err && completed) {
                done = true
              }
            })
          }
        }, 750 * i)
      }
      webviews.unbindEvent('did-finish-load', listener)
    }
  }
  webviews.bindEvent('did-finish-load', listener)
}

function setAudioMutedOnCreate (tabId, muted) {
  const listener = function () {
    webviews.callAsync(tabId, 'setAudioMuted', muted)
    webviews.unbindEvent('did-navigate', listener)
  }
  webviews.bindEvent('did-navigate', listener)
}

const webviews = {
  viewFullscreenMap: {}, // tabId, isFullscreen
  selectedId: null,
  placeholderRequests: [],
  asyncCallbacks: {},
  internalPages: {
    error: 'min://app/pages/error/index.html'
  },
  events: [],
  IPCEvents: [],
  hasViewForTab: function (tabId) {
    return tabId && tasks.getTaskContainingTab(tabId) && tasks.getTaskContainingTab(tabId).tabs.get(tabId).hasWebContents
  },
  bindEvent: function (event, fn) {
    webviews.events.push({
      event: event,
      fn: fn
    })
  },
  unbindEvent: function (event, fn) {
    for (var i = 0; i < webviews.events.length; i++) {
      if (webviews.events[i].event === event && webviews.events[i].fn === fn) {
        webviews.events.splice(i, 1)
        i--
      }
    }
  },
  emitEvent: function (event, tabId, args) {
    if (!webviews.hasViewForTab(tabId)) {
      // the view could have been destroyed between when the event was occured and when it was recieved in the UI process, see https://github.com/minbrowser/min/issues/604#issuecomment-419653437
      return
    }
    webviews.events.forEach(function (ev) {
      if (ev.event === event) {
        ev.fn.apply(this, [tabId].concat(args))
      }
    })
  },
  bindIPC: function (name, fn) {
    webviews.IPCEvents.push({
      name: name,
      fn: fn
    })
  },
  viewMargins: [0, 0, 0, 0], // top, right, bottom, left
  adjustMargin: function (margins) {
    for (var i = 0; i < margins.length; i++) {
      webviews.viewMargins[i] += margins[i]
    }
    webviews.resize()
  },
  getViewBounds: function () {
    if (webviews.viewFullscreenMap[webviews.selectedId]) {
      return {
        x: 0,
        y: 0,
        width: window.innerWidth,
        height: window.innerHeight
      }
    } else {
      if (!hasSeparateTitlebar && (window.platformType === 'linux' || window.platformType === 'windows') && !windowIsMaximized && !windowIsFullscreen) {
        var navbarHeight = 48
      } else {
        var navbarHeight = 36
      }

      const viewMargins = webviews.viewMargins

      const position = {
        x: 0 + Math.round(viewMargins[3]),
        y: 0 + Math.round(viewMargins[0]) + navbarHeight,
        width: window.innerWidth - Math.round(viewMargins[1] + viewMargins[3]),
        height: window.innerHeight - Math.round(viewMargins[0] + viewMargins[2]) - navbarHeight
      }

      return position
    }
  },
  add: function (tabId, existingViewId) {
    var tabData = tabs.get(tabId)

    // needs to be called before the view is created to that its listeners can be registered
    if (tabData.scrollPosition) {
      scrollOnLoad(tabId, tabData.scrollPosition)
    }

    if (tabData.muted) {
      setAudioMutedOnCreate(tabId, tabData.muted)
    }

    // if the tab is private, we want to partition it. See http://electron.atom.io/docs/v0.34.0/api/web-view-tag/#partition
    // since tab IDs are unique, we can use them as partition names
    if (tabData.private === true) {
      var partition = tabId.toString() // options.tabId is a number, which remote.session.fromPartition won't accept. It must be converted to a string first
    }

    ipc.send('createView', {
      existingViewId,
      id: tabId,
      webPreferences: {
        partition: partition || 'persist:webcontent'
      },
      boundsString: JSON.stringify(webviews.getViewBounds()),
      events: webviews.events.map(e => e.event).filter((i, idx, arr) => arr.indexOf(i) === idx)
    })

    if (!existingViewId) {
      if (tabData.url) {
        ipc.send('loadURLInView', { id: tabData.id, url: urlParser.parse(tabData.url) })
      } else if (tabData.private) {
        // workaround for https://github.com/minbrowser/min/issues/872
        ipc.send('loadURLInView', { id: tabData.id, url: urlParser.parse('min://newtab') })
      }
    }

    tasks.getTaskContainingTab(tabId).tabs.update(tabId, {
      hasWebContents: true
    })
  },
  setSelected: function (id, options) { // options.focus - whether to focus the view. Defaults to true.
    webviews.emitEvent('view-hidden', webviews.selectedId)

    webviews.selectedId = id

    // create the view if it doesn't already exist
    if (!webviews.hasViewForTab(id)) {
      webviews.add(id)
    }

    if (webviews.placeholderRequests.length > 0) {
      // update the placeholder instead of showing the actual view
      webviews.requestPlaceholder()
      return
    }

    ipc.send('setView', {
      id: id,
      bounds: webviews.getViewBounds(),
      focus: !options || options.focus !== false
    })
    webviews.emitEvent('view-shown', id)
  },
  update: function (id, url) {
    ipc.send('loadURLInView', { id: id, url: urlParser.parse(url) })
  },
  destroy: function (id) {
    webviews.emitEvent('view-hidden', id)

    if (webviews.hasViewForTab(id)) {
      tasks.getTaskContainingTab(id).tabs.update(id, {
        hasWebContents: false
      })
    }
    // we may be destroying a view for which the tab object no longer exists, so this message should be sent unconditionally
    ipc.send('destroyView', id)

    delete webviews.viewFullscreenMap[id]
    if (webviews.selectedId === id) {
      webviews.selectedId = null
    }
  },
  requestPlaceholder: function (reason) {
    if (reason && !webviews.placeholderRequests.includes(reason)) {
      webviews.placeholderRequests.push(reason)
    }
    if (webviews.placeholderRequests.length >= 1) {
      // create a new placeholder

      var associatedTab = tasks.getTaskContainingTab(webviews.selectedId).tabs.get(webviews.selectedId)
      var img = associatedTab.previewImage
      if (img) {
        placeholderImg.src = img
        placeholderImg.hidden = false
      } else if (associatedTab && associatedTab.url) {
        captureCurrentTab({ forceCapture: true })
      } else {
        placeholderImg.hidden = true
      }
    }
    setTimeout(function () {
      // wait to make sure the image is visible before the view is hidden
      // make sure the placeholder was not removed between when the timeout was created and when it occurs
      if (webviews.placeholderRequests.length > 0) {
        ipc.send('hideCurrentView')
        webviews.emitEvent('view-hidden', webviews.selectedId)
      }
    }, 0)
  },
  hidePlaceholder: function (reason) {
    if (webviews.placeholderRequests.includes(reason)) {
      webviews.placeholderRequests.splice(webviews.placeholderRequests.indexOf(reason), 1)
    }

    if (webviews.placeholderRequests.length === 0) {
      // multiple things can request a placeholder at the same time, but we should only show the view again if nothing requires a placeholder anymore
      if (webviews.hasViewForTab(webviews.selectedId)) {
        ipc.send('setView', {
          id: webviews.selectedId,
          bounds: webviews.getViewBounds(),
          focus: true
        })
        webviews.emitEvent('view-shown', webviews.selectedId)
      }
      // wait for the view to be visible before removing the placeholder
      setTimeout(function () {
        if (webviews.placeholderRequests.length === 0) { // make sure the placeholder hasn't been re-enabled
          placeholderImg.hidden = true
        }
      }, 400)
    }
  },
  releaseFocus: function () {
    ipc.send('focusMainWebContents')
  },
  focus: function () {
    if (webviews.selectedId) {
      ipc.send('focusView', webviews.selectedId)
    }
  },
  resize: function () {
    ipc.send('setBounds', { id: webviews.selectedId, bounds: webviews.getViewBounds() })
  },
  goBackIgnoringRedirects: async function (id) {
    const navHistory = await webviews.getNavigationHistory(id)
    // If the current page is an internal page resulting from a redirect (error pages or reader mode), go back two pages

    var url = navHistory.entries[navHistory.activeIndex].url

    if (urlParser.isInternalURL(url) && navHistory.activeIndex > 1 && navHistory.entries[navHistory.activeIndex - 1].url === urlParser.getSourceURL(url)) {
      webviews.callAsync(id, 'canGoToOffset', -2, function (err, result) {
        if (!err && result === true) {
          webviews.callAsync(id, 'goToOffset', -2)
        } else {
          webviews.callAsync(id, 'goBack')
        }
      })
    } else {
      webviews.callAsync(id, 'goBack')
    }
  },
  /*
  Can be called as
  callAsync(id, method, args, callback) -> invokes method with args, runs callback with (err, result)
  callAsync(id, method, callback) -> invokes method with no args, runs callback with (err, result)
  callAsync(id, property, value, callback) -> sets property to value
  callAsync(id, property, callback) -> reads property, runs callback with (err, result)
   */
  callAsync: function (id, method, argsOrCallback, callback) {
    var args = argsOrCallback
    var cb = callback
    if (argsOrCallback instanceof Function && !cb) {
      args = []
      cb = argsOrCallback
    }
    if (!(args instanceof Array)) {
      args = [args]
    }
    if (cb) {
      var callId = Math.random()
      webviews.asyncCallbacks[callId] = cb
    }
    ipc.send('callViewMethod', { id: id, callId: callId, method: method, args: args })
  },
  getNavigationHistory: function (id) {
    return ipc.invoke('getNavigationHistory', id)
  }
}

window.addEventListener('resize', throttle(function () {
  if (webviews.placeholderRequests.length > 0) {
    // can't set view bounds if the view is hidden
    return
  }
  webviews.resize()
}, 75))

// leave HTML fullscreen when leaving window fullscreen
ipc.on('leave-full-screen', function () {
  // electron normally does this automatically (https://github.com/electron/electron/pull/13090/files), but it doesn't work for BrowserViews
  for (var view in webviews.viewFullscreenMap) {
    if (webviews.viewFullscreenMap[view]) {
      webviews.callAsync(view, 'executeJavaScript', 'document.exitFullscreen()')
    }
  }
})

webviews.bindEvent('enter-html-full-screen', function (tabId) {
  webviews.viewFullscreenMap[tabId] = true
  webviews.resize()
})

webviews.bindEvent('leave-html-full-screen', function (tabId) {
  webviews.viewFullscreenMap[tabId] = false
  webviews.resize()
})

ipc.on('maximize', function () {
  windowIsMaximized = true
  webviews.resize()
})

ipc.on('unmaximize', function () {
  windowIsMaximized = false
  webviews.resize()
})

ipc.on('enter-full-screen', function () {
  windowIsFullscreen = true
  webviews.resize()
})

ipc.on('leave-full-screen', function () {
  windowIsFullscreen = false
  webviews.resize()
})

webviews.bindEvent('did-start-navigation', onNavigate)
webviews.bindEvent('will-redirect', onNavigate)
webviews.bindEvent('did-navigate', function (tabId, url, httpResponseCode, httpStatusText) {
  onPageURLChange(tabId, url)
})

webviews.bindEvent('did-finish-load', onPageLoad)

webviews.bindEvent('page-title-updated', function (tabId, title, explicitSet) {
  tabs.update(tabId, {
    title: title
  })
})

webviews.bindEvent('did-fail-load', function (tabId, errorCode, errorDesc, validatedURL, isMainFrame) {
  if (errorCode && errorCode !== -3 && isMainFrame && validatedURL) {
    webviews.update(tabId, webviews.internalPages.error + '?ec=' + encodeURIComponent(errorCode) + '&url=' + encodeURIComponent(validatedURL))
  }
})

webviews.bindEvent('crashed', function (tabId, isKilled) {
  var url = tabs.get(tabId).url

  tabs.update(tabId, {
    url: webviews.internalPages.error + '?ec=crash&url=' + encodeURIComponent(url)
  })

  // the existing process has crashed, so we can't reuse it
  webviews.destroy(tabId)
  webviews.add(tabId)

  if (tabId === tabs.getSelected()) {
    webviews.setSelected(tabId)
  }
})

webviews.bindIPC('getSettingsData', function (tabId, args) {
  if (!urlParser.isInternalURL(tabs.get(tabId).url)) {
    throw new Error()
  }
  webviews.callAsync(tabId, 'send', ['receiveSettingsData', settings.list])
})
webviews.bindIPC('setSetting', function (tabId, args) {
  if (!urlParser.isInternalURL(tabs.get(tabId).url)) {
    throw new Error()
  }
  settings.set(args[0].key, args[0].value)
})

settings.listen(function () {
  tasks.forEach(function (task) {
    task.tabs.forEach(function (tab) {
      if (tab.url.startsWith('min://')) {
        try {
          webviews.callAsync(tab.id, 'send', ['receiveSettingsData', settings.list])
        } catch (e) {
          // webview might not actually exist
        }
      }
    })
  })
})

webviews.bindIPC('scroll-position-change', function (tabId, args) {
  tabs.update(tabId, {
    scrollPosition: args[0]
  })
})

webviews.bindIPC('downloadFile', function (tabId, args) {
  if (tabs.get(tabId).url.startsWith('min://')) {
    webviews.callAsync(tabId, 'downloadURL', [args[0]])
  }
})

// Import Wizard handlers for internal page bridge
webviews.bindIPC('importWizardChromeBookmarksAuto', async function (tabId, args) {
  try {
    const fs = require('fs')
    const path = require('path')
    const os = require('os')
    const places = require('places/places.js')
    const req = (args && args[0]) || {}
    const profile = req.profile || 'Default'

    function getChromeProfileDir (profileName) {
      const home = os.homedir()
      if (process.platform === 'darwin') {
        return path.join(home, 'Library', 'Application Support', 'Google', 'Chrome', profileName || 'Default')
      } else if (process.platform === 'win32') {
        const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local')
        return path.join(localAppData, 'Google', 'Chrome', 'User Data', profileName || 'Default')
      } else {
        return path.join(home, '.config', 'google-chrome', profileName || 'Default')
      }
    }

    const bookmarksPath = path.join(getChromeProfileDir(profile), 'Bookmarks')
    if (!fs.existsSync(bookmarksPath)) {
      webviews.callAsync(tabId, 'send', ['importWizardResult', { ok: false, type: 'chromeBookmarks', error: 'not_found' }])
      return
    }

    function parseChromeTime (microsecondsStr) {
      try {
        const micro = BigInt(microsecondsStr || '0')
        if (micro === 0n) return Date.now()
        const epochDiffMs = 11644473600000n
        const ms = micro / 1000n - epochDiffMs
        return Number(ms)
      } catch { return Date.now() }
    }

    function traverse (node, parents, out) {
      if (!node) return
      if (node.type === 'url' && node.url) {
        const data = {
          title: node.name || node.url,
          isBookmarked: true,
          tags: parents.filter(Boolean).map(t => String(t).replace(/\s/g, '-')),
          lastVisit: parseChromeTime(node.date_added)
        }
        out.push({ url: node.url, data })
      } else if (node.type === 'folder' && Array.isArray(node.children)) {
        const newParents = parents.concat(node.name || null)
        node.children.forEach(child => traverse(child, newParents, out))
      } else if (Array.isArray(node)) {
        node.forEach(child => traverse(child, parents, out))
      } else if (node.roots) {
        traverse(node.roots.bookmark_bar, parents, out)
        traverse(node.roots.other, parents, out)
        traverse(node.roots.synced, parents, out)
      }
    }

    const raw = fs.readFileSync(bookmarksPath, 'utf-8')
    const json = JSON.parse(raw)
    const collected = []
    traverse(json, [], collected)
    let count = 0
    for (const item of collected) {
      await places.updateItem(item.url, item.data)
      count++
    }
    webviews.callAsync(tabId, 'send', ['importWizardResult', { ok: true, type: 'chromeBookmarks', count }])
  } catch (e) {
    console.error('[ImportWizard] Chrome bookmarks import failed:', e)
    webviews.callAsync(tabId, 'send', ['importWizardResult', { ok: false, type: 'chromeBookmarks', error: 'exception' }])
  }
})

webviews.bindIPC('importWizardBookmarksFromHTML', async function (tabId) {
  try {
    const fs = require('fs')
    const bookmarkConverter = require('bookmarkConverter.js')
    const files = await ipc.invoke('showOpenDialog', { properties: ['openFile'], filters: [{ name: 'HTML', extensions: ['html', 'htm'] }] })
    if (!files || files.length === 0) {
      webviews.callAsync(tabId, 'send', ['importWizardResult', { ok: false, type: 'bookmarksHTML', error: 'cancelled' }])
      return
    }
    const contents = fs.readFileSync(files[0], 'utf-8')
    bookmarkConverter.import(contents)
    webviews.callAsync(tabId, 'send', ['importWizardResult', { ok: true, type: 'bookmarksHTML' }])
  } catch (e) {
    console.error('[ImportWizard] Bookmarks HTML import failed:', e)
    webviews.callAsync(tabId, 'send', ['importWizardResult', { ok: false, type: 'bookmarksHTML', error: 'exception' }])
  }
})

webviews.bindIPC('importWizardPasswordsCSV', async function (tabId) {
  try {
    const fs = require('fs')
    const Keychain = require('passwordManager/keychain.js')
    const keychain = new Keychain()
    const files = await ipc.invoke('showOpenDialog', { properties: ['openFile'], filters: [{ name: 'CSV', extensions: ['csv'] }] })
    if (!files || files.length === 0) {
      webviews.callAsync(tabId, 'send', ['importWizardResult', { ok: false, type: 'passwordsCSV', error: 'cancelled' }])
      return
    }
    const contents = fs.readFileSync(files[0], 'utf-8')
    const results = await keychain.importCredentials(contents)
    webviews.callAsync(tabId, 'send', ['importWizardResult', { ok: true, type: 'passwordsCSV', count: results.length }])
  } catch (e) {
    console.error('[ImportWizard] Passwords CSV import failed:', e)
    webviews.callAsync(tabId, 'send', ['importWizardResult', { ok: false, type: 'passwordsCSV', error: 'exception' }])
  }
})

// List available profiles for browser
webviews.bindIPC('importWizardListProfiles', async function (tabId, args) {
  try {
    const fs = require('fs')
    const path = require('path')
    const os = require('os')
    const req = (args && args[0]) || {}
    const browser = (req.browser || '').toLowerCase()
    let profiles = []
    if (browser === 'chrome') {
      const home = os.homedir()
      let base
      if (process.platform === 'darwin') base = path.join(home, 'Library', 'Application Support', 'Google', 'Chrome')
      else if (process.platform === 'win32') base = path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Google', 'Chrome', 'User Data')
      else base = path.join(home, '.config', 'google-chrome')
      try {
        const dirs = fs.readdirSync(base, { withFileTypes: true }).filter(d => d.isDirectory())
        const candidates = dirs.map(d => d.name).filter(n => n === 'Default' || /^Profile \d+$/i.test(n))

        // Read Local State for friendly names
        let labels = {}
        try {
          const lsPath = path.join(base, 'Local State')
          if (fs.existsSync(lsPath)) {
            const data = JSON.parse(fs.readFileSync(lsPath, 'utf-8'))
            const cache = (data && data.profile && data.profile.info_cache) || {}
            Object.keys(cache).forEach(id => {
              const name = cache[id] && cache[id].name
              if (name) labels[id] = name
            })
          }
        } catch (e) { /* ignore parse errors */ }

        profiles = candidates.map(id => {
          const friendly = labels[id]
          const label = friendly ? `${friendly} (${id})` : id
          return { id, label }
        })
      } catch {}
      if (profiles.length === 0) profiles = [{ id: 'Default', label: 'Default' }]
    } else if (browser === 'firefox') {
      const home = os.homedir()
      // Root directory containing profiles.ini
      let root
      if (process.platform === 'darwin') root = path.join(home, 'Library', 'Application Support', 'Firefox')
      else if (process.platform === 'win32') root = path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Mozilla', 'Firefox')
      else root = path.join(home, '.mozilla', 'firefox')
      const profilesIni = path.join(root, 'profiles.ini')
      // Profiles directory (mac/win use Profiles subdir; linux usually uses root)
      const profilesDir = process.platform === 'darwin' || process.platform === 'win32' ? path.join(root, 'Profiles') : root
      try {
        if (fs.existsSync(profilesIni)) {
          const content = fs.readFileSync(profilesIni, 'utf-8')
          const lines = content.split(/\r?\n/)
          let current = null
          const sections = []
          lines.forEach(line => {
            const trimmed = line.trim()
            if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('#')) return
            if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
              if (current) sections.push(current)
              current = { name: trimmed.slice(1, -1), props: {} }
            } else if (current && trimmed.includes('=')) {
              const idx = trimmed.indexOf('=')
              const key = trimmed.slice(0, idx).trim()
              const val = trimmed.slice(idx + 1).trim()
              current.props[key] = val
            }
          })
          if (current) sections.push(current)

          const profs = sections.filter(s => s.name.toLowerCase().startsWith('profile'))
          profiles = profs.map(s => {
            const p = s.props
            const isRel = String(p.IsRelative || '1') === '1'
            const pPath = p.Path || ''
            const abs = isRel ? path.join(root, pPath) : pPath
            const id = path.basename(abs)
            const isDefault = String(p.Default || '0') === '1'
            const label = p.Name ? (isDefault ? `${p.Name} (default)` : p.Name) : id
            return { id, label, isDefault }
          })
          // Filter to existing directories only
          profiles = profiles.filter(pr => fs.existsSync(path.join(profilesDir, pr.id)) || fs.existsSync(path.join(root, pr.id)))
          // Sort: default first, then default-release, then alphabetical label
          profiles.sort((a, b) => {
            if (a.isDefault && !b.isDefault) return -1
            if (!a.isDefault && b.isDefault) return 1
            const aDR = /default-release/.test(a.id)
            const bDR = /default-release/.test(b.id)
            if (aDR && !bDR) return -1
            if (!aDR && bDR) return 1
            return a.label.localeCompare(b.label)
          })
        } else {
          // Fallback: list directories
          const base = profilesDir
          const dirs = fs.readdirSync(base, { withFileTypes: true }).filter(d => d.isDirectory())
          profiles = dirs.map(d => ({ id: d.name, label: d.name }))
          profiles.sort((a, b) => (/default-release/.test(b.id) - /default-release/.test(a.id)))
        }
      } catch {}
    } else if (browser === 'safari') {
      profiles = [{ id: '', label: 'Default' }]
    }
    webviews.callAsync(tabId, 'send', ['importWizardResult', { ok: true, type: 'profiles', browser, profiles }])
    // Also send a dedicated message to populate profiles quickly
    webviews.callAsync(tabId, 'send', ['importWizardProfiles', { profiles }])
  } catch (e) {
    webviews.callAsync(tabId, 'send', ['importWizardProfiles', { profiles: [] }])
  }
})

// History import (Chrome, Firefox, Safari) using sqlite3 CLI if available
webviews.bindIPC('importWizardHistory', async function (tabId, args) {
  const req = (args && args[0]) || {}
  const browser = (req.browser || '').toLowerCase()
  try {
    const fs = require('fs')
    const path = require('path')
    const os = require('os')
    const { spawn } = require('child_process')
    const papaparse = require('papaparse')
    const places = require('places/places.js')
    const req = (args && args[0]) || {}
    const selectedProfile = req.profile || ''

    function runSqliteQuery (dbPath, query) {
      return new Promise((resolve, reject) => {
        let stdout = ''
        let stderr = ''
        const child = spawn('sqlite3', ['-header', '-csv', dbPath, query])
        child.stdout.on('data', chunk => { stdout += chunk.toString('utf8') })
        child.stderr.on('data', chunk => { stderr += chunk.toString('utf8') })
        child.on('error', (err) => {
          if (err && err.code === 'ENOENT') return reject(new Error('sqlite3_missing'))
          reject(err)
        })
        child.on('close', (code) => {
          if (code !== 0) {
            return reject(new Error('sqlite3_exit_' + code + ':' + stderr))
          }
          try {
            const parsed = papaparse.parse(stdout, { header: true, skipEmptyLines: true })
            resolve(parsed.data)
          } catch (e) {
            reject(e)
          }
        })
      })
    }

    function tempCopy (dbPath) {
      const tmp = path.join(os.tmpdir(), `min-import-${Date.now()}-${Math.random().toString(36).slice(2)}.db`)
      fs.copyFileSync(dbPath, tmp)
      return tmp
    }

    function chromeProfile (profileName) {
      const home = os.homedir()
      if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Google', 'Chrome', profileName || 'Default')
      if (process.platform === 'win32') return path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Google', 'Chrome', 'User Data', profileName || 'Default')
      return path.join(home, '.config', 'google-chrome', profileName || 'Default')
    }

    function firefoxProfile () {
      const home = os.homedir()
      if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Firefox', 'Profiles')
      if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Mozilla', 'Firefox', 'Profiles')
      return path.join(home, '.mozilla', 'firefox')
    }

    function findFirefoxPlacesDb (profileName) {
      try {
        const base = firefoxProfile()
        const entries = fs.readdirSync(base, { withFileTypes: true }).filter(e => e.isDirectory())
        let preferred
        if (profileName) {
          preferred = entries.find(e => e.name === profileName)
        }
        if (!preferred) {
          preferred = entries.find(e => /default-release/i.test(e.name)) || entries[0]
        }
        if (!preferred) return null
        const db = path.join(base, preferred.name, 'places.sqlite')
        return fs.existsSync(db) ? db : null
      } catch { return null }
    }

    function safariHistoryDb () {
      if (process.platform !== 'darwin') return null
      const home = os.homedir()
      const p = path.join(home, 'Library', 'Safari', 'History.db')
      return fs.existsSync(p) ? p : null
    }

    function chromeTimeToUnixMs (microStr) {
      try {
        const micro = BigInt(microStr || '0')
        if (micro === 0n) return Date.now()
        const epochDiffMs = 11644473600000n
        return Number(micro / 1000n - epochDiffMs)
      } catch { return Date.now() }
    }

    function safariTimeToUnixMs (secondsSince2001) {
      try {
        const s = Number(secondsSince2001 || 0)
        return Math.round((s + 978307200) * 1000)
      } catch { return Date.now() }
    }

    let rows = []
    if (browser === 'chrome') {
      const db = path.join(chromeProfile(selectedProfile), 'History')
      if (!fs.existsSync(db)) throw new Error('not_found')
      const tmp = tempCopy(db)
      rows = await runSqliteQuery(tmp, 'SELECT url, title, last_visit_time, visit_count FROM urls ORDER BY last_visit_time DESC LIMIT 5000;')
      for (const r of rows) {
        const url = r.url
        const title = r.title || r.url
        const lastVisit = chromeTimeToUnixMs(r.last_visit_time)
        const visitCount = parseInt(r.visit_count || '1') || 1
        await places.updateItem(url, { title, lastVisit, visitCount, isBookmarked: false })
      }
      webviews.callAsync(tabId, 'send', ['importWizardResult', { ok: true, type: 'history', browser: 'chrome', count: rows.length }])
      return
    }
    if (browser === 'firefox') {
      const db = findFirefoxPlacesDb(selectedProfile)
      if (!db) throw new Error('not_found')
      const tmp = tempCopy(db)
      rows = await runSqliteQuery(tmp, 'SELECT url, title, last_visit_date, visit_count FROM moz_places WHERE last_visit_date IS NOT NULL ORDER BY last_visit_date DESC LIMIT 5000;')
      for (const r of rows) {
        const url = r.url
        const title = r.title || r.url
        // Firefox stores microseconds since Unix epoch
        const lastVisit = Math.round((parseInt(r.last_visit_date || '0') || 0) / 1000)
        const visitCount = parseInt(r.visit_count || '1') || 1
        await places.updateItem(url, { title, lastVisit, visitCount, isBookmarked: false })
      }
      webviews.callAsync(tabId, 'send', ['importWizardResult', { ok: true, type: 'history', browser: 'firefox', count: rows.length }])
      return
    }
    if (browser === 'safari') {
      const db = safariHistoryDb()
      if (!db) throw new Error('not_found')
      const tmp = tempCopy(db)
      rows = await runSqliteQuery(tmp, 'SELECT history_items.url as url, history_items.title as title, MAX(history_visits.visit_time) as last_time, COUNT(history_visits.id) as cnt FROM history_items LEFT JOIN history_visits ON history_items.id = history_visits.history_item GROUP BY url, title ORDER BY last_time DESC LIMIT 5000;')
      for (const r of rows) {
        const url = r.url
        const title = r.title || r.url
        const lastVisit = safariTimeToUnixMs(r.last_time)
        const visitCount = parseInt(r.cnt || '1') || 1
        await places.updateItem(url, { title, lastVisit, visitCount, isBookmarked: false })
      }
      webviews.callAsync(tabId, 'send', ['importWizardResult', { ok: true, type: 'history', browser: 'safari', count: rows.length }])
      return
    }

    webviews.callAsync(tabId, 'send', ['importWizardResult', { ok: false, type: 'history', browser, error: 'unknown_browser' }])
  } catch (e) {
    console.error('[ImportWizard] History import failed:', e)
    const msg = (e && e.message) || 'exception'
    const errorType = msg.includes('sqlite3_missing') ? 'sqlite3_missing' : msg
    webviews.callAsync(tabId, 'send', ['importWizardResult', { ok: false, type: 'history', error: errorType }])
  }
})

ipc.on('view-event', function (e, args) {
  webviews.emitEvent(args.event, args.tabId, args.args)
})

ipc.on('async-call-result', function (e, args) {
  webviews.asyncCallbacks[args.callId](args.error, args.result)
  delete webviews.asyncCallbacks[args.callId]
})

ipc.on('view-ipc', function (e, args) {
  if (!webviews.hasViewForTab(args.id)) {
    // the view could have been destroyed between when the event was occured and when it was recieved in the UI process, see https://github.com/minbrowser/min/issues/604#issuecomment-419653437
    return
  }
  webviews.IPCEvents.forEach(function (item) {
    if (item.name === args.name) {
      item.fn(args.id, [args.data], args.frameId, args.frameURL)
    }
  })
})

setInterval(function () {
  captureCurrentTab()
}, 15000)

ipc.on('captureData', function (e, data) {
  tabs.update(data.id, { previewImage: data.url })
  if (data.id === webviews.selectedId && webviews.placeholderRequests.length > 0) {
    placeholderImg.src = data.url
    placeholderImg.hidden = false
  }
})

/* focus the view when the window is focused */

ipc.on('windowFocus', function () {
  if (webviews.placeholderRequests.length === 0 && document.activeElement.tagName !== 'INPUT') {
    webviews.focus()
  }
})

module.exports = webviews
