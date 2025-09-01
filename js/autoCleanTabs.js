var settings = require('util/settings/settings.js')

/**
 * Auto Clean Tabs Module
 * Hides inactive tabs from the tab bar while keeping them functional.
 * Tabs are hidden based on a configurable age threshold (in days).
 */

const autoCleanTabs = {
  hiddenTabs: new Set(),
  animatingTabs: new Set(),
  animationTimeouts: new Map(),
  checkIntervalId: null,
  listenersAttached: false,
  defaultSettings: {
    enabled: false,
    daysThreshold: 3,
    hiddenTabIds: []
  },

  init: function () {
    console.log('[AutoCleanTabs] init()')
    this.loadSettings()

    if (this.isEnabled()) {
      console.log('[AutoCleanTabs] Enabled. Starting periodic checks…')
      this.startPeriodicCheck()
    }

    // React to settings changes
    settings.listen('autoCleanTabs', (value) => {
      console.log('[AutoCleanTabs] settings.listen ->', value)
      this.onSettingsChanged(value)
    })

    // Attach tab lifecycle listeners (when available)
    this.ensureTaskListeners()
  },

  ensureTaskListeners: function () {
    if (this.listenersAttached) return
    if (typeof tasks === 'undefined' || !tasks || typeof tasks.on !== 'function') {
      // try again shortly
      setTimeout(() => this.ensureTaskListeners(), 200)
      return
    }
    try {
      tasks.on('tab-updated', (tabId, key, value) => {
        if (key === 'lastActivity') {
          if (this.isHidden(tabId)) {
            console.log('[AutoCleanTabs] Activity; showing hidden tab:', tabId)
            this.showTab(tabId)
          }
          this.cancelAnimation(tabId)
        }
      })

      tasks.on('tab-selected', (tabId) => {
        if (this.isHidden(tabId)) {
          console.log('[AutoCleanTabs] Selected was hidden; showing:', tabId)
          this.showTab(tabId)
        }
        this.cancelAnimation(tabId)
      })

      tasks.on('tab-destroyed', (tabId) => {
        this.hiddenTabs.delete(tabId)
        this.animatingTabs.delete(tabId)
        this.cancelAnimation(tabId)
        console.log('[AutoCleanTabs] Cleaned up destroyed tab:', tabId)
        this.saveSettings()
      })
      this.listenersAttached = true
      console.log('[AutoCleanTabs] Task listeners attached')
    } catch (e) {
      console.warn('[AutoCleanTabs] Failed attaching task listeners, retrying soon:', e?.message)
      setTimeout(() => this.ensureTaskListeners(), 500)
    }
  },

  loadSettings: function () {
    var s = settings.get('autoCleanTabs') || this.defaultSettings
    console.log('[AutoCleanTabs] loadSettings()', s)
    if (s.hiddenTabIds && Array.isArray(s.hiddenTabIds)) {
      this.hiddenTabs = new Set(s.hiddenTabIds)
    }
    this.cleanupNonExistentTabs()
  },

  saveSettings: function () {
    var current = Object.assign({}, this.defaultSettings, settings.get('autoCleanTabs'))
    current.hiddenTabIds = Array.from(this.hiddenTabs)
    console.log('[AutoCleanTabs] saveSettings()', current)
    settings.set('autoCleanTabs', current)
  },

  updateTabBarUI: function () {
    try {
      var tb = require('navbar/tabBar.js')
      if (tb && typeof tb.updateAll === 'function') {
        console.log('[AutoCleanTabs] Triggering tabBar.updateAll()')
        tb.updateAll()
      } else {
        console.log('[AutoCleanTabs] tabBar.updateAll() not available yet')
      }
    } catch (e) {
      console.warn('[AutoCleanTabs] Unable to update tab bar UI:', e && e.message)
    }
  },

  onSettingsChanged: function (newSettings) {
    if (!newSettings) return
    if (newSettings.enabled) {
      console.log('[AutoCleanTabs] onSettingsChanged -> enabled=true')
      this.startPeriodicCheck()
    } else {
      console.log('[AutoCleanTabs] onSettingsChanged -> enabled=false; stopping checks and showing all')
      this.stopPeriodicCheck()
      this.showAllTabs()
    }
  },

  isEnabled: function () {
    var s = settings.get('autoCleanTabs') || this.defaultSettings
    return !!s.enabled
  },

  getDaysThreshold: function () {
    var s = settings.get('autoCleanTabs') || this.defaultSettings
    return s.daysThreshold || 3
  },

  startPeriodicCheck: function () {
    if (this.checkIntervalId) clearInterval(this.checkIntervalId)
    this.checkIntervalId = setInterval(() => {
      console.log('[AutoCleanTabs] Periodic check triggered')
      this.checkAndHideOldTabs()
    }, 60 * 60 * 1000) // hourly

    setTimeout(() => {
      console.log('[AutoCleanTabs] Initial delayed check (5s after startup)')
      this.checkAndHideOldTabs()
    }, 5000)
  },

  stopPeriodicCheck: function () {
    if (this.checkIntervalId) {
      clearInterval(this.checkIntervalId)
      this.checkIntervalId = null
      console.log('[AutoCleanTabs] Periodic checks stopped')
    }
  },

  checkAndHideOldTabs: function () {
    if (!this.isEnabled()) {
      console.log('[AutoCleanTabs] check skipped (disabled)')
      return
    }
    if (typeof tasks === 'undefined' || !tasks || typeof tasks.get !== 'function') {
      console.log('[AutoCleanTabs] check skipped (tasks not ready)')
      return
    }
    var now = Date.now()
    var thresholdMs = this.getDaysThreshold() * 24 * 60 * 60 * 1000
    var candidates = 0
    console.log('[AutoCleanTabs] Running check. thresholdDays=', this.getDaysThreshold())
    var allTasks = tasks.get()
    if (!Array.isArray(allTasks)) {
      console.log('[AutoCleanTabs] tasks.get() not ready; skipping')
      return
    }
    allTasks.forEach(task => {
      var tabList = (task && task.tabs && typeof task.tabs.get === 'function') ? task.tabs.get() : []
      tabList.forEach(tab => {
        var shouldHide = (now - tab.lastActivity) > thresholdMs
        if (shouldHide && !this.isHidden(tab.id) && !tab.selected && !this.isAnimating(tab.id)) {
          candidates++
          this.hideTabWithAnimation(tab.id)
        }
      })
    })
    console.log('[AutoCleanTabs] Check complete. candidatesStarted=', candidates)
  },

  hideTabWithAnimation: function (tabId) {
    if (this.isHidden(tabId) || this.isAnimating(tabId)) {
      console.log('[AutoCleanTabs] hideTabWithAnimation skipped (already hidden/animating):', tabId)
      return
    }
    this.animatingTabs.add(tabId)
    console.log('[AutoCleanTabs] Starting warning animation for tab:', tabId)

    var tabElement = document.querySelector(`.tab-item[data-tab="${tabId}"]`)
    if (tabElement) tabElement.classList.add('auto-clean-warning')

    var timeoutId = setTimeout(() => {
      this.hideTab(tabId)
      this.animatingTabs.delete(tabId)
      this.animationTimeouts.delete(tabId)
      if (tabElement) tabElement.classList.remove('auto-clean-warning')
      console.log('[AutoCleanTabs] Animation complete; tab hidden:', tabId)
    }, 3000)
    this.animationTimeouts.set(tabId, timeoutId)
  },

  cancelAnimation: function (tabId) {
    if (this.animationTimeouts.has(tabId)) {
      clearTimeout(this.animationTimeouts.get(tabId))
      this.animationTimeouts.delete(tabId)
      console.log('[AutoCleanTabs] Animation canceled for tab:', tabId)
    }
    this.animatingTabs.delete(tabId)
    var tabElement = document.querySelector(`.tab-item[data-tab="${tabId}"]`)
    if (tabElement) tabElement.classList.remove('auto-clean-warning')
  },

  hideTab: function (tabId) {
    var tab = tabs.get(tabId)
    if (tab && tab.selected) {
      console.log('[AutoCleanTabs] hideTab skipped (selected):', tabId)
      return false
    }
    this.hiddenTabs.add(tabId)
    this.cancelAnimation(tabId)
    this.saveSettings()
    console.log('[AutoCleanTabs] Tab hidden:', tabId)

    this.updateTabBarUI()
    return true
  },

  showTab: function (tabId) {
    var wasHidden = this.hiddenTabs.has(tabId)
    this.hiddenTabs.delete(tabId)
    this.cancelAnimation(tabId)
    if (wasHidden) {
      this.saveSettings()
      console.log('[AutoCleanTabs] Tab shown:', tabId)
      this.updateTabBarUI()
    }
    return wasHidden
  },

  toggleTab: function (tabId) {
    if (this.isHidden(tabId)) return this.showTab(tabId)
    else return this.hideTab(tabId)
  },

  showAllTabs: function () {
    var hadHidden = this.hiddenTabs.size > 0
    this.hiddenTabs.clear()
    this.animatingTabs.forEach(id => this.cancelAnimation(id))
    this.animatingTabs.clear()
    if (hadHidden) {
      this.saveSettings()
      console.log('[AutoCleanTabs] All hidden tabs shown')
      this.updateTabBarUI()
    }
    return hadHidden
  },

  isHidden: function (tabId) { return this.hiddenTabs.has(tabId) },
  isAnimating: function (tabId) { return this.animatingTabs.has(tabId) },
  getHiddenTabIds: function () { return Array.from(this.hiddenTabs) },
  getHiddenTabCount: function () { return this.hiddenTabs.size },
  filterVisibleTabs: function (tabsArray) { return tabsArray.filter(t => !this.isHidden(t.id)) },

  cleanupNonExistentTabs: function () {
    // If tasks not available yet, skip cleanup
    if (typeof tasks === 'undefined' || !tasks || typeof tasks.get !== 'function') {
      return
    }
    var allTasks = tasks.get()
    if (!Array.isArray(allTasks)) return
    var existing = new Set()
    allTasks.forEach(task => {
      var tabList = (task && task.tabs && typeof task.tabs.get === 'function') ? task.tabs.get() : []
      if (Array.isArray(tabList)) {
        tabList.forEach(tab => existing.add(tab.id))
      }
    })
    var removedAny = false
    for (var id of this.hiddenTabs) {
      if (!existing.has(id)) {
        console.log('[AutoCleanTabs] Removing non-existent from hidden set:', id)
        this.hiddenTabs.delete(id)
        removedAny = true
      }
    }
    if (removedAny) this.saveSettings()
  },

  getDebugInfo: function () {
    return {
      enabled: this.isEnabled(),
      daysThreshold: this.getDaysThreshold(),
      hiddenTabsCount: this.hiddenTabs.size,
      hiddenTabIds: Array.from(this.hiddenTabs),
      animatingTabsCount: this.animatingTabs.size,
      animatingTabIds: Array.from(this.animatingTabs),
      checkIntervalActive: !!this.checkIntervalId
    }
  },

  // Test helpers
  runCheckNow: function () {
    console.log('[AutoCleanTabs][TEST] runCheckNow()')
    this.checkAndHideOldTabs()
  },
  demoHideOneTab: function () {
    console.log('[AutoCleanTabs][TEST] demoHideOneTab()')
    var task = tasks.getSelected()
    console.log(task)
    if (!task || task.tabs.count() === 0) return false
    var candidate = task.tabs.get().find(t => !t.selected && !this.isHidden(t.id) && !this.isAnimating(t.id))
    if (!candidate) {
      console.log('[AutoCleanTabs][TEST] No eligible tab to demo hide')
      return false
    }
    this.hideTabWithAnimation(candidate.id)
    return true
  }
}

module.exports = autoCleanTabs
