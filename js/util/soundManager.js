/**
 * Sound Manager - Generic configurable sound system for Min Browser
 * Provides centralized sound functionality that can be used across different components
 */

var settings = require('./settings/settings.js')

var soundManager = {

  // Available sound options with their data URIs (small embedded sounds)
  availableSounds: {
    notification: {
      name: 'Notification',
      dataUri: 'data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmAcBjuR1/LNeSsFJHfH8N2QQAoUXrPp66hVFApGnt/yvmAcBjiP1uu0dSgEKnq+8dF5HgIhc8bxzn0iBC17xfDGcQ=='
    },
    chime: {
      name: 'Chime',
      dataUri: 'data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmAcBjuR1/LNeSsFJHfH8N2QQAoUXrPp66hVFApGnt/yvmAcBjiP1uu0dSgEKnq+8dF5HgIhc8bxzn0iBC17xfDGcR8DH4PL8diNOwkWZbjt6oM8BBBN'
    },
    pop: {
      name: 'Pop',
      dataUri: 'data:audio/wav;base64,UklGRn4AAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YVoAAAAyQCE4QCE4QCE4QCE4QCE4QCE4QCE4QCE4QCE4QCE4QCE4QCE4QCE4QCE4QCE4QCE4QCE4QCE4QCE4QCE4QCE4QCE4QCE4QCE4QCE4QCE4QCE4QCE4QCE4QCE4QCE4QCE4QCE4QCE4QCE4QCE4QCE4QCE4QCE='
    },
    ping: {
      name: 'Ping',
      dataUri: 'data:audio/wav;base64,UklGRt4AAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YboAAAC/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/'
    },
    off: {
      name: 'Off (No Sound)',
      dataUri: null
    }
  },

  /**
   * Play a configured sound based on user settings
   * @param {string} soundType - The type of sound to play (e.g., 'aiResponse', 'notification')
   * @param {number} volume - Optional volume override (0.0 to 1.0)
   */
  playSound: function (soundType, volume = null) {
    try {
      // Get sound settings
      var soundSettings = settings.get('soundSettings') || {}
      var soundEnabled = soundSettings.enabled !== false // Default to enabled

      // If sounds are disabled globally, return early
      if (!soundEnabled) {
        console.log('🔇 Sound disabled in settings')
        return
      }

      // Get the specific sound setting for this sound type
      var soundSetting = soundSettings[soundType] || 'notification'

      // If this sound type is set to 'off', return early
      if (soundSetting === 'off') {
        console.log('🔇 Sound type', soundType, 'set to off')
        return
      }

      // Get the sound definition
      var soundDef = this.availableSounds[soundSetting]
      if (!soundDef || !soundDef.dataUri) {
        console.warn('🔊 Invalid sound setting:', soundSetting)
        return
      }

      // Create and play the audio
      var audio = new Audio(soundDef.dataUri)

      // Set volume
      var finalVolume = volume !== null ? volume : (soundSettings.volume || 0.5)
      audio.volume = Math.max(0, Math.min(1, finalVolume))

      // Play with error handling
      audio.play().then(() => {
        console.log('🔊 Played sound:', soundSetting, 'for', soundType)
      }).catch((error) => {
        console.warn('🔊 Failed to play sound:', error.message)
      })
    } catch (error) {
      console.warn('🔊 Sound playback error:', error.message)
    }
  },

  /**
   * Play AI response notification sound
   * This is a convenience method for the most common use case
   */
  playAiResponseSound: function () {
    this.playSound('aiResponse')
  },

  /**
   * Play general notification sound
   */
  playNotificationSound: function () {
    this.playSound('notification')
  },

  /**
   * Test a specific sound (used in settings)
   * @param {string} soundId - ID of the sound to test
   * @param {number} volume - Volume level to test with
   */
  testSound: function (soundId, volume = 0.5) {
    var soundDef = this.availableSounds[soundId]
    if (!soundDef || !soundDef.dataUri) {
      console.log('🔇 Cannot test sound:', soundId)
      return
    }

    try {
      var audio = new Audio(soundDef.dataUri)
      audio.volume = Math.max(0, Math.min(1, volume))
      audio.play().then(() => {
        console.log('🔊 Test played:', soundId)
      }).catch((error) => {
        console.warn('🔊 Test sound failed:', error.message)
      })
    } catch (error) {
      console.warn('🔊 Test sound error:', error.message)
    }
  },

  /**
   * Get current sound settings with defaults
   * @returns {Object} Current sound settings
   */
  getSoundSettings: function () {
    var defaults = {
      enabled: true,
      volume: 0.5,
      aiResponse: 'notification',
      notification: 'notification'
    }

    var saved = settings.get('soundSettings') || {}
    return Object.assign({}, defaults, saved)
  },

  /**
   * Update sound settings
   * @param {Object} newSettings - New sound settings to save
   */
  updateSoundSettings: function (newSettings) {
    var current = this.getSoundSettings()
    var updated = Object.assign({}, current, newSettings)
    settings.set('soundSettings', updated)
    console.log('🔊 Sound settings updated:', updated)
  }
}

module.exports = soundManager
