/* Maintains a daily Top 10 most visited list with title + cached image */

const fs = require('fs')
const path = require('path')
const { fileURLToPath } = require('url')

const places = require('places/places.js')

const PREVIEW_DIR = path.join(window.globalArgs['user-data-path'], 'topPreviews')
const DATA_FILE = path.join(window.globalArgs['user-data-path'], 'topSites.json')
const PREVIEW_TTL = 7 * 24 * 60 * 60 * 1000 // 7 days
const DAILY = 24 * 60 * 60 * 1000

const pending = new Set()

function ensureDir (dir) {
  try { fs.mkdirSync(dir, { recursive: true }) } catch (e) {}
}

function saveJSON (file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2))
    console.log('[TopSites][Service] Saved JSON to', file, 'items=', (data && data.items && data.items.length))
  } catch (e) {
    console.warn('[TopSites][Service] Failed saving JSON:', e && e.message)
  }
}

function loadJSON (file) {
  try {
    const raw = fs.readFileSync(file, 'utf-8')
    console.log('[TopSites][Service] Loaded JSON', file, 'size=', raw.length)
    return JSON.parse(raw)
  } catch (e) { return null }
}

function fileFresh (p) {
  try {
    const st = fs.statSync(p)
    return (Date.now() - st.mtimeMs) < PREVIEW_TTL
  } catch (e) { return false }
}

function getPreviewPath (url) {
  const crypto = require('crypto')
  const hash = crypto.createHash('sha1').update(url).digest('hex')
  return path.join(PREVIEW_DIR, hash + '.png')
}

function getOrRequestPreview (url) {
  ensureDir(PREVIEW_DIR)
  const p = getPreviewPath(url)
  if (fileFresh(p)) {
    // Convert fresh file to data URL for embedding in JSON
    try {
      const b64 = fs.readFileSync(p).toString('base64')
      return 'data:image/png;base64,' + b64
    } catch (e) {
      // fall through to request
    }
  }
  // request background preview from main
  try { pending.add(url); ipc.send('requestLinkPreview', { href: url }); console.log('[TopSites][Service] Preview requested for', url) } catch (e) {}
  return null
}

async function computeTopSites () {
  try {
    console.log('[TopSites][Service] Computing top sites...')
    const items = await places.getAllItems()
    console.log('[TopSites][Service] Places items:', items && items.length)
    const nonInternal = items.filter(i => i && i.url && !i.url.startsWith('min://'))
    nonInternal.sort((a, b) => (b.visitCount || 0) - (a.visitCount || 0))
    const top = nonInternal.slice(0, 10)
    console.log('[TopSites][Service] Top candidates:', top.length)

    const data = top.map(i => {
      return {
        url: i.url,
        title: i.title || i.url,
        image: getOrRequestPreview(i.url)
      }
    })
    saveJSON(DATA_FILE, { updatedAt: Date.now(), items: data })
  } catch (e) {
    console.warn('[TopSites][Service] computeTopSites failed:', e && e.message)
  }
}

function schedule () {
  console.log('[TopSites][Service] Schedule daily refresh')
  computeTopSites()
  setInterval(computeTopSites, DAILY)
}

function migrateFileUrlsToDataUrls () {
  try {
    const js = loadJSON(DATA_FILE)
    if (!js || !Array.isArray(js.items)) return
    let changed = false
    js.items = js.items.map((it) => {
      try {
        if (it && typeof it.image === 'string' && it.image.startsWith('file:')) {
          const p = fileURLToPath(it.image)
          const b64 = fs.readFileSync(p).toString('base64')
          const dataUrl = 'data:image/png;base64,' + b64
          changed = true
          return { ...it, image: dataUrl }
        }
      } catch (e) {
        console.warn('[TopSites][Service] Migration failed for', it && it.url, e && e.message)
      }
      return it
    })
    if (changed) {
      js.updatedAt = js.updatedAt || Date.now()
      saveJSON(DATA_FILE, js)
      console.log('[TopSites][Service] Migration complete: converted file:// images to data URLs')
    } else {
      console.log('[TopSites][Service] Migration: no file:// images found')
    }
  } catch (e) {
    console.warn('[TopSites][Service] Migration error:', e && e.message)
  }
}

function setupPreviewListener () {
  ipc.on('linkPreviewData', function (event, payload) {
    try {
      if (!payload || !payload.href || !pending.has(payload.href)) return
      pending.delete(payload.href)
      if (payload.imageUrl && payload.imageUrl.startsWith('data:')) {
        ensureDir(PREVIEW_DIR)
        const p = getPreviewPath(payload.href)
        const base64 = payload.imageUrl.split(',')[1]
        if (base64) {
          fs.writeFile(p, Buffer.from(base64, 'base64'), function () {
            // Update JSON file entry if present with data URL (not file path)
            const js = loadJSON(DATA_FILE) || { items: [] }
            const dataUrl = 'data:image/png;base64,' + base64
            js.items = (js.items || []).map(it => it.url === payload.href ? { ...it, image: dataUrl } : it)
            js.updatedAt = js.updatedAt || Date.now()
            saveJSON(DATA_FILE, js)
            console.log('[TopSites][Service] Preview saved for', payload.href)
          })
        }
      }
    } catch (e) {}
  })
}

function initialize () {
  console.log('[TopSites][Service] Initialize')
  ensureDir(PREVIEW_DIR)
  migrateFileUrlsToDataUrls()
  schedule()
  setupPreviewListener()
}

module.exports = { initialize }
