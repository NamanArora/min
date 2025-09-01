/* Import Wizard internal page: communicates with host via postMessage */

function setStatus (text) {
  document.getElementById('import-status').textContent = text || ''
}

function setHelp (html) {
  const el = document.getElementById('import-help')
  el.innerHTML = html || ''
}

function requestChromeBookmarksAuto (profile) {
  setStatus('Importing Chrome bookmarks...')
  window.postMessage({ message: 'importWizardChromeBookmarksAuto', profile }, window.location.toString())
}

function requestBookmarksFromHTML () {
  setStatus('Select a bookmarks export HTML...')
  window.postMessage({ message: 'importWizardBookmarksFromHTML' }, window.location.toString())
}

function requestPasswordsFromCSV () {
  setStatus('Select a passwords CSV export...')
  window.postMessage({ message: 'importWizardPasswordsCSV' }, window.location.toString())
}

function updateHelpText () {
  const browser = document.getElementById('browser-select').value
  let help = ''
  if (browser === 'chrome') {
    help = 'Automatic bookmarks import is supported. For passwords, export a CSV from Chrome Password Manager and use the button below.'
  } else if (browser === 'firefox') {
    help = 'Use “Import Bookmarks from HTML...” to select a Firefox bookmarks export. For passwords, export a CSV from Firefox Lockwise and import it here.'
  } else if (browser === 'safari') {
    help = 'Safari bookmarks can be exported via File → Export Bookmarks… and imported here. Passwords can be exported from Keychain Access as CSV then imported here.'
  }
  setHelp(help)
  requestProfiles()
}

function requestProfiles () {
  const browser = document.getElementById('browser-select').value
  const profileSelect = document.getElementById('profile-select')
  profileSelect.innerHTML = '<option value="">Detecting...</option>'
  window.postMessage({ message: 'importWizardListProfiles', browser }, window.location.toString())
}

async function startImport () {
  const browser = document.getElementById('browser-select').value
  const profile = document.getElementById('profile-select').value || ''
  const doBookmarks = document.getElementById('import-bookmarks').checked
  const doHistory = document.getElementById('import-history').checked
  const doPasswords = document.getElementById('import-passwords').checked

  setStatus('Starting import...')

  // Bookmarks
  if (doBookmarks) {
    if (browser === 'chrome') {
      requestChromeBookmarksAuto(profile)
    } else {
      requestBookmarksFromHTML()
    }
  }

  // History (not implemented yet)
  if (doHistory) {
    setStatus('Importing history...')
    window.postMessage({ message: 'importWizardHistory', browser, profile }, window.location.toString())
  }

  // Passwords
  if (doPasswords) {
    requestPasswordsFromCSV()
  }

  // Completion messages arrive via importWizardResult
}

document.getElementById('browser-select').addEventListener('change', updateHelpText)
document.getElementById('start-import').addEventListener('click', startImport)
document.getElementById('select-bookmarks-html').addEventListener('click', requestBookmarksFromHTML)
document.getElementById('select-passwords-csv').addEventListener('click', requestPasswordsFromCSV)

// Receive results from host
window.addEventListener('message', function (e) {
  if (!e.data || e.data.message !== 'importWizardResult') return
  const payload = e.data.payload || {}
  if (payload.type === 'chromeBookmarks') {
    setStatus(payload.ok ? `Imported ${payload.count || 0} bookmarks from Chrome.` : 'Chrome bookmarks not found or failed.')
  } else if (payload.type === 'bookmarksHTML') {
    setStatus(payload.ok ? 'Imported bookmarks from HTML.' : 'Bookmarks import canceled or failed.')
  } else if (payload.type === 'passwordsCSV') {
    setStatus(payload.ok ? `Imported ${payload.count || 0} passwords.` : 'Password import canceled or failed.')
  } else if (payload.type === 'history') {
    if (payload.ok) {
      setStatus(`Imported ${payload.count || 0} history items from ${payload.browser}.`)
    } else if (payload.error === 'unknown_browser') {
      setStatus('History import: unknown browser.')
    } else if (payload.error === 'not_found') {
      setStatus('History database not found. Try closing the browser and retry.')
    } else if (payload.error === 'sqlite3_missing') {
      setStatus('sqlite3 not found. Please install sqlite3 (CLI) and retry.')
    } else {
      setStatus('History import failed. Ensure sqlite3 is installed and retry.')
    }
  }
})

updateHelpText()

// Populate profile list responses
window.addEventListener('message', function (e) {
  if (!e.data || e.data.message !== 'importWizardProfiles') return
  const payload = e.data.payload || { profiles: [] }
  const select = document.getElementById('profile-select')
  select.innerHTML = ''
  if (!payload.profiles || payload.profiles.length === 0) {
    const opt = document.createElement('option')
    opt.value = ''
    opt.textContent = 'Default'
    select.appendChild(opt)
    return
  }
  let defaultIndex = 0
  payload.profiles.forEach((p, idx) => {
    const opt = document.createElement('option')
    opt.value = p.id
    opt.textContent = p.label || p.id
    select.appendChild(opt)
    if (/\(default\)/i.test(opt.textContent) || p.id === 'Default' || /default-release/i.test(p.id)) {
      defaultIndex = idx
    }
  })
  select.selectedIndex = defaultIndex
})
