/* imports common modules */

var electron = require('electron')
var ipc = electron.ipcRenderer

var propertiesToClone = ['deltaX', 'deltaY', 'metaKey', 'ctrlKey', 'defaultPrevented', 'clientX', 'clientY']

function cloneEvent (e) {
  var obj = {}

  for (var i = 0; i < propertiesToClone.length; i++) {
    obj[propertiesToClone[i]] = e[propertiesToClone[i]]
  }
  return JSON.stringify(obj)
}

// workaround for Electron bug
setTimeout(function () {
  /* Used for swipe gestures */
  window.addEventListener('wheel', function (e) {
    ipc.send('wheel-event', cloneEvent(e))
  })

  var scrollTimeout = null

  window.addEventListener('scroll', function () {
    clearTimeout(scrollTimeout)
    scrollTimeout = setTimeout(function () {
      ipc.send('scroll-position-change', Math.round(window.scrollY))
    }, 200)
  })
}, 0)

/* Used for picture in picture item in context menu */
ipc.on('getContextMenuData', function (event, data) {
  // check for video element to show picture-in-picture menu
  var hasVideo = Array.from(document.elementsFromPoint(data.x, data.y)).some(el => el.tagName === 'VIDEO')
  ipc.send('contextMenuData', { hasVideo })
})

ipc.on('enterPictureInPicture', function (event, data) {
  var videos = Array.from(document.elementsFromPoint(data.x, data.y)).filter(el => el.tagName === 'VIDEO')
  if (videos[0]) {
    videos[0].requestPictureInPicture()
  }
})

window.addEventListener('message', function (e) {
  if (!e.origin.startsWith('min://')) {
    return
  }

  if (e.data?.message === 'showCredentialList') {
    ipc.send('showCredentialList')
  }

  if (e.data?.message === 'showUserscriptDirectory') {
    ipc.send('showUserscriptDirectory')
  }

  if (e.data?.message === 'downloadFile') {
    ipc.send('downloadFile', e.data.url)
  }

  // Import Wizard bridge messages from internal pages
  if (e.data?.message === 'importWizardChromeBookmarksAuto') {
    ipc.send('importWizardChromeBookmarksAuto', { profile: e.data.profile })
  }
  if (e.data?.message === 'importWizardBookmarksFromHTML') {
    ipc.send('importWizardBookmarksFromHTML')
  }
  if (e.data?.message === 'importWizardPasswordsCSV') {
    ipc.send('importWizardPasswordsCSV')
  }
  if (e.data?.message === 'importWizardHistory') {
    ipc.send('importWizardHistory', { browser: e.data.browser, profile: e.data.profile })
  }
  if (e.data?.message === 'importWizardListProfiles') {
    ipc.send('importWizardListProfiles', { browser: e.data.browser })
  }
})

// Forward results back into page context
ipc.on('importWizardResult', function (event, payload) {
  try {
    window.postMessage({ message: 'importWizardResult', payload }, window.location.toString())
  } catch (e) { /* no-op */ }
})

ipc.on('importWizardProfiles', function (event, payload) {
  try {
    window.postMessage({ message: 'importWizardProfiles', payload }, window.location.toString())
  } catch (e) { /* no-op */ }
})

// Link Preview (hover on <a> shows preview image from target page)
;(function setupLinkPreview () {
  try {
    var previewEl = null
    var hideTimer = null
    var hoverTimer = null
    var lastHref = null
    var currentAnchor = null
    var linkPreviewEnabled = true

    function ensurePreviewEl () {
      if (previewEl) return previewEl
      previewEl = document.createElement('div')
      previewEl.id = 'min-link-preview'
      Object.assign(previewEl.style, {
        position: 'fixed', zIndex: 999999, pointerEvents: 'none',
        width: '300px', maxWidth: '40vw', maxHeight: '40vh',
        background: 'rgba(0,0,0,0.8)', color: '#fff', borderRadius: '8px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.35)', padding: '6px', display: 'none'
      })
      var skeleton = document.createElement('div')
      skeleton.className = 'min-link-skeleton'
      Object.assign(skeleton.style, {
        width: '100%', height: '170px', borderRadius: '4px',
        background: 'linear-gradient(90deg, rgba(255,255,255,0.08), rgba(255,255,255,0.18), rgba(255,255,255,0.08))',
        backgroundSize: '200% 100%', animation: 'minlinkshimmer 1.2s infinite'
      })
      var img = document.createElement('img')
      img.style.width = '100%'
      img.style.height = 'auto'
      img.style.display = 'block'
      img.style.borderRadius = '4px'
      var cap = document.createElement('div')
      cap.style.fontSize = '12px'
      cap.style.opacity = '0.85'
      cap.style.marginTop = '4px'
      // inject simple keyframes once
      if (!document.getElementById('min-link-preview-style')) {
        var st = document.createElement('style')
        st.id = 'min-link-preview-style'
        st.textContent = '@keyframes minlinkshimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}'
        document.head && document.head.appendChild(st)
      }
      previewEl.appendChild(skeleton)
      previewEl.appendChild(img)
      previewEl.appendChild(cap)
      document.documentElement.appendChild(previewEl)
      return previewEl
    }

    function qualifies (href, anchor) {
      if (!href) return false
      var h = href.trim()
      if (h.startsWith('#')) return false
      var lower = h.toLowerCase()
      if (!(lower.startsWith('http://') || lower.startsWith('https://'))) return false
      if (lower.startsWith('javascript:') || lower.startsWith('data:') || lower.startsWith('mailto:') || lower.startsWith('tel:')) return false
      if (anchor && (anchor.getAttribute('role') === 'button' || anchor.closest('button, form'))) return false
      return true
    }

    function showPreviewAt (x, y) {
      var el = ensurePreviewEl()
      // approximate position; adjust to viewport
      var left = Math.min(Math.max(8, x + 12), window.innerWidth - el.offsetWidth - 8)
      var top = Math.min(Math.max(8, y + 12), window.innerHeight - el.offsetHeight - 8)
      el.style.left = left + 'px'
      el.style.top = top + 'px'
      el.style.display = 'block'
    }

    function hidePreviewSoon () {
      if (hideTimer) clearTimeout(hideTimer)
      hideTimer = setTimeout(function () {
        if (previewEl) previewEl.style.display = 'none'
      }, 120)
    }

    document.addEventListener('mouseover', function (e) {
      if (!linkPreviewEnabled) return
      var a = e.target && e.target.closest ? e.target.closest('a') : null
      if (!a) { hidePreviewSoon(); return }
      var href = a.getAttribute('href')
      if (!qualifies(href, a)) { hidePreviewSoon(); return }

      currentAnchor = a
      if (hideTimer) clearTimeout(hideTimer)
      if (hoverTimer) clearTimeout(hoverTimer)
      hoverTimer = setTimeout(function () {
        // still hovering same anchor?
        var stillOver = document.querySelector(':hover') === a || (a.matches(':hover'))
        if (!stillOver) return
        console.log('[LinkPreview][Preload] hover qualified for', href)
        var el = ensurePreviewEl()
        var img = el.querySelector('img')
        var skeleton = el.querySelector('.min-link-skeleton')
        var cap = el.querySelector('div:last-child')
        showPreviewAt(e.clientX, e.clientY)
        try { cap.textContent = new URL(href, window.location.href).hostname } catch (e) { cap.textContent = href }
        if (lastHref === href && img.getAttribute('src')) {
          console.log('[LinkPreview][Preload] using cached image')
          return
        }
        if (skeleton) skeleton.style.display = 'block'
        if (img) { img.removeAttribute('src'); img.style.display = 'none' }
        lastHref = href
        try {
          var abs = new URL(href, window.location.href).toString()
          console.log('[LinkPreview][Preload] requesting', abs)
          ipc.send('requestLinkPreview', { href: abs })
        } catch (e) {
          // invalid URL
          console.log('[LinkPreview][Preload] invalid url', href)
        }
      }, 300)
    }, true)

    document.addEventListener('mousemove', function (e) {
      if (!linkPreviewEnabled) return
      if (previewEl && previewEl.style.display === 'block') {
        showPreviewAt(e.clientX, e.clientY)
      }
    })

    document.addEventListener('mouseout', function (e) {
      if (!linkPreviewEnabled) return
      if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null }
      if (!e.relatedTarget || !(e.relatedTarget.closest && e.relatedTarget.closest('a'))) {
        hidePreviewSoon()
      }
    }, true)

    ipc.on('linkPreviewData', function (event, data) {
      try {
        console.log('[LinkPreview][Preload] received payload', data && Object.keys(data))
        if (!previewEl || previewEl.style.display === 'none') return
        if (!data || (data.href !== new URL(lastHref, window.location.href).toString())) return
        var img = previewEl.querySelector('img')
        var skeleton = previewEl.querySelector('.min-link-skeleton')
        var cap = previewEl.querySelector('div:last-child')
        if (data.title) cap.textContent = data.title
        if (data.imageUrl) {
          console.log('[LinkPreview][Preload] setting imageUrl')
          img.src = data.imageUrl
          img.style.display = 'block'
          if (skeleton) skeleton.style.display = 'none'
        } else {
          console.log('[LinkPreview][Preload] no imageUrl')
          img.removeAttribute('src')
          img.style.display = 'none'
          if (skeleton) skeleton.style.display = 'none'
        }
      } catch (e) {
        // ignore
      }
    })

    // Request initial setting value
    ipc.send('getSettingValue', 'linkPreviewEnabled')
    ipc.on('settingValue', function (event, payload) {
      if (payload && payload.key === 'linkPreviewEnabled') {
        linkPreviewEnabled = (payload.value !== false)
      }
    })
    // Listen to live changes
    ipc.on('settingChanged', function (event, key, value) {
      if (key === 'linkPreviewEnabled') {
        linkPreviewEnabled = (value !== false)
        if (!linkPreviewEnabled && previewEl) previewEl.style.display = 'none'
      }
    })
  } catch (e) {
    // ignore
  }
})()
