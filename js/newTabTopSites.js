/* Simple, clean renderer: reads daily-maintained Top Sites and displays them */

const path = require('path')
const fs = require('fs')
const webviews = require('webviews.js')
const settings = require('util/settings/settings.js')
const { fileURLToPath } = require('url')

const DATA_FILE = path.join(window.globalArgs['user-data-path'], 'topSites.json')
const MAX_ALLOWED = 10
const DEFAULT_COUNT = 5

function clampCount (n) {
  n = parseInt(n || DEFAULT_COUNT)
  if (isNaN(n)) n = DEFAULT_COUNT
  return Math.min(Math.max(n, 1), MAX_ALLOWED)
}

function desiredCount () {
  return clampCount(settings.get('newTabPreviewCount') || DEFAULT_COUNT)
}

function readTopSites () {
  try {
    console.log('[TopSites][UI] Reading data file:', DATA_FILE)
    const raw = fs.readFileSync(DATA_FILE, 'utf-8')
    console.log('[TopSites][UI] Data file size:', raw.length)
    const j = JSON.parse(raw)
    let arr = (j && Array.isArray(j.items)) ? j.items : []
    console.log('[TopSites][UI] Items in file:', arr.length)
    // Dedupe by hostname (one entry per site)
    const seen = new Set()
    const deduped = []
    for (const it of arr) {
      try {
        const h = new URL(it.url).hostname.replace(/^www\./, '')
        if (!seen.has(h)) {
          seen.add(h)
          deduped.push(it)
        }
      } catch (e) {
        // invalid URL, skip
      }
    }
    console.log('[TopSites][UI] After dedupe count:', deduped.length)
    return deduped
  } catch (e) {
    console.warn('[TopSites][UI] Failed to read topSites.json:', e && e.message)
    return []
  }
}

function createCard (item) {
  console.log('[TopSites][UI] Creating card:', item && item.url)
  const a = document.createElement('a')
  a.className = 'ntp-site-card'
  a.href = item.url
  a.addEventListener('click', function (e) {
    e.preventDefault()
    webviews.update(tabs.getSelected(), item.url)
  })

  const imgWrap = document.createElement('div')
  imgWrap.className = 'ntp-site-img'
  const img = document.createElement('img')
  if (item.image) {
    try {
      if (item.image.startsWith('data:')) {
        img.src = item.image
        console.log('[TopSites][UI] Using data URL for', item.url)
      } else if (item.image.startsWith('file:')) {
        const p = fileURLToPath(item.image)
        const buf = fs.readFileSync(p)
        const blob = new Blob([buf], { type: 'image/png' })
        const objURL = URL.createObjectURL(blob)
        img.src = objURL
        console.log('[TopSites][UI] Loaded file image for', item.url)
      } else {
        // Fallback: treat as normal URL
        img.src = item.image
        console.log('[TopSites][UI] Using http(s) image for', item.url)
      }
    } catch (e) {
      console.warn('[TopSites][UI] Failed to load image for', item.url, e && e.message)
      img.alt = ''
    }
  } else {
    img.alt = ''
    console.log('[TopSites][UI] No image found for', item.url)
  }
  imgWrap.appendChild(img)

  const title = document.createElement('div')
  title.className = 'ntp-site-title'
  title.textContent = item.title || item.url

  a.appendChild(imgWrap)
  a.appendChild(title)
  return a
}

function render () {
  console.log('[TopSites][UI] Render start')
  const grid = document.getElementById('ntp-sites-grid')
  const heading = document.getElementById('ntp-heading')
  const wrapper = document.getElementById('ntp-top-sites')
  if (!grid || !heading || !wrapper) return

  grid.textContent = ''

  const count = desiredCount()
  console.log('[TopSites][UI] Desired count:', count)
  // simple layout: 4 or 5 columns depending on count group
  grid.style.gridTemplateColumns = (count === 4 || count === 8)
    ? 'repeat(4, minmax(0, 1fr))'
    : 'repeat(5, minmax(0, 1fr))'

  // Show all available, cap at 10
  const allItems = readTopSites()
  const items = allItems.slice(0, Math.min(count, 10))
  console.log('[TopSites][UI] Loaded items (post-slice):', items.length)
  if (items.length > 0) {
    heading.hidden = false
    wrapper.hidden = false
    const frag = document.createDocumentFragment()
    items.forEach(it => frag.appendChild(createCard(it)))
    grid.appendChild(frag)
    console.log('[TopSites][UI] Rendered cards:', items.length)
  } else {
    heading.hidden = true
    wrapper.hidden = true
    console.log('[TopSites][UI] Hiding UI, no items available')
  }
}

function initialize () {
  console.log('[TopSites][UI] Initialize')
  const obs = new MutationObserver(() => {
    const isNtp = document.body.classList.contains('is-ntp')
    if (isNtp) {
      console.log('[TopSites][UI] Mutation observed: is-ntp true, rendering')
      render()
    }
  })
  obs.observe(document.body, { attributes: true, attributeFilter: ['class'] })

  if (document.body.classList.contains('is-ntp')) {
    console.log('[TopSites][UI] Initial state is-ntp true, rendering')
    render()
  } else {
    console.log('[TopSites][UI] Initial state is-ntp false, waiting')
  }

  settings.listen('newTabPreviewCount', function (v) {
    console.log('[TopSites][UI] Setting changed newTabPreviewCount=', v)
    render()
  })
}

module.exports = { initialize, render }
