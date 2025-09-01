# Auto-Clean Tabs Feature Documentation

## Overview

The Auto-Clean Tabs feature automatically hides inactive tabs from the tab bar while keeping them functional and searchable. This helps reduce visual clutter by hiding tabs that haven't been used for a configurable period (default: 3 days) while maintaining their state and functionality.

## Key Features

### ✨ Core Functionality
- **Automatic tab hiding**: Tabs older than threshold are automatically hidden from the tab bar
- **Sparkle warning animation**: 3-second golden sparkle animation warns users before tabs are hidden
- **Persistent tab state**: Hidden tabs continue running in background (webviews stay active)
- **Tasks view visibility**: All tabs (hidden and visible) appear in the tasks overlay
- **Full searchability**: Hidden tabs remain searchable through tab search functionality
- **Manual override**: Users can manually hide/show individual tabs
- **Bulk operations**: Show all hidden tabs at once

### 🎯 User Experience
- **Non-destructive**: Tabs are never actually closed, only hidden from view
- **Instant access**: Hidden tabs can be revealed immediately via tasks view or search
- **Visual feedback**: Golden sparkle animation provides 3-second warning before hiding
- **Context-aware**: Selected tabs and recently active tabs are never auto-hidden
- **Settings integration**: Full settings panel with enable/disable and threshold configuration

## Architecture Overview

The feature uses a centralized module approach to minimize code complexity and maintain clean separation of concerns.

### Core Components

1. **`js/autoCleanTabs.js`** - Central management module (initialized from `js/default.js`)
2. **CSS animations** - Sparkle warning effects in `css/tabBar.css`
3. **Tab bar integration** - Filtering hidden tabs from display in `js/navbar/tabBar.js`
4. **Settings UI** - User configuration interface in `pages/settings/index.html` & `pages/settings/settings.js`
5. **Context menu** - Manual hide/show options in `js/navbar/tabContextMenu.js`
6. **Capabilities menu (testing)** - Quick actions in `main/menu.js`

### Design Principles

- **Minimal state changes**: Uses a simple Set to track hidden tab IDs instead of modifying individual tab objects
- **Event-driven**: Responds to tab activity, selection changes, and settings updates
- **Non-invasive**: Does not modify existing tab data structures
- **Centralized logic**: Single source of truth for hidden tab management

## File Structure & Implementation

### Main Module: `js/autoCleanTabs.js`
**Purpose**: Central coordinator for auto-clean; attaches listeners after tab state initializes.
**Key responsibilities**:
- Maintains `hiddenTabs` Set for tracking hidden tabs
- Periodic checking for old tabs (every hour)
- Animation management with 3-second sparkle warning
- Settings persistence and synchronization
- Integration with tab lifecycle events

**Core API**:
```javascript
autoCleanTabs.hideTab(tabId)           // Hide specific tab
autoCleanTabs.showTab(tabId)           // Show specific tab  
autoCleanTabs.toggleTab(tabId)         // Toggle visibility
autoCleanTabs.showAllTabs()            // Show all hidden tabs
autoCleanTabs.isHidden(tabId)          // Check if tab is hidden
autoCleanTabs.filterVisibleTabs(tabs)  // Filter array to visible only
autoCleanTabs.getHiddenTabCount()      // Count of hidden tabs
autoCleanTabs.runCheckNow()            // Manually run an age check now (test)
autoCleanTabs.demoHideOneTab()         // Animate + hide first eligible tab (test)
```

### CSS Styles: `css/tabBar.css`
**Purpose**: Sparkle animation and warning effects
**Key animations**:
- `.auto-clean-warning`: Applied to tabs about to be hidden
- `@keyframes sparkle-warning`: Golden sweep animation with glowing effects
- `@keyframes glow-pulse`: Subtle pulsing background glow
- Dark theme variations for consistent appearance

**Animation sequence**:
1. Tab becomes eligible for hiding (3+ days old)
2. `.auto-clean-warning` class added
3. 3-second sparkle animation plays
4. Tab is hidden and class removed

### Tab Bar Integration: `js/navbar/tabBar.js`
**Purpose**: Filter hidden tabs from visual display
**Key modifications**:
- `updateAll()`: Uses `filterVisibleTabs()` to exclude hidden tabs
- `addTab()`: Checks visibility and computes visible index before adding to DOM
- Import and integration of `autoCleanTabs` module

**Filtering logic**:
```javascript
var visibleTabs = autoCleanTabs.filterVisibleTabs(tabs.get())
visibleTabs.forEach(function (tab) {
  // Only render visible tabs
})
```

### Settings UI: `pages/settings/index.html` & `pages/settings/settings.js`
**Purpose**: User configuration interface
**Settings structure**:
```javascript
{
  enabled: false,          // Feature toggle
  daysThreshold: 3,        // Days before auto-hide
  hiddenTabIds: []         // Persisted hidden tabs list
}
```

**UI components**:
- Master enable/disable checkbox
- Days threshold number input (1-30 days)
- Hidden tabs counter display
- "Show All Hidden Tabs" button
- Auto-expanding options section

### Context Menu: `js/navbar/tabContextMenu.js`
**Purpose**: Manual tab visibility controls
**Menu additions** (when feature enabled):
- "Hide Tab" / "Show Tab" (context-dependent)
- "Show All Hidden Tabs (X)" (when hidden tabs exist)
- Separated section for auto-clean options

### Integration Points

**BrowserUI Integration**: `js/browserUI.js`
- Imports `autoCleanTabs`
- IPC handlers for `showAllHiddenTabs`, `autoCleanRunCheckNow`, `autoCleanDemoHideOneTab`, `setAutoCleanEnabled`

**Preload Script**: `js/preload/default.js`
- Routes `postMessage('showAllHiddenTabs')` from settings page → main process

**Main Process**: `main/main.js`
- Forwards `showAllHiddenTabs` IPC to the focused window's renderer

**Capabilities Menu**: `main/menu.js`
- Adds Auto‑Clean test items: Enable/Disable, Run Check Now, Demo Hide One Tab, Show All Hidden Tabs

## Data Flow & State Management

### Settings Persistence
```
User changes setting → settings.js → settings.json → settings.listen → autoCleanTabs.onSettingsChanged → behavior update
```

### Tab Hiding Process
```
Timer check → identify old tabs → start sparkle animation → 3s delay → hide tab → update UI
```

### Tab Activity Response
```
Tab activity event → check if hidden → auto-show if hidden → cancel pending animations
```

### Settings Page Communication
```
Settings UI → postMessage('showAllHiddenTabs') → preload → main → browserUI → autoCleanTabs.showAllTabs()
```

## Usage Guide

### Enabling the Feature
1. Open Min browser settings (hamburger menu → Settings)
2. Scroll to "Additional Features" section
3. Check "Auto-Clean Tabs" checkbox
4. Configure days threshold (default: 3 days)
5. Feature activates automatically

### Manual Control
- **Hide specific tab**: Right-click tab → "Hide Tab"
- **Show hidden tab**: Right-click any visible tab → "Show All Hidden Tabs"
- **Access hidden tabs**: Use task overlay (Cmd/Ctrl+Shift+E) or search
- **Bulk reveal**: Settings page → "Show All Hidden Tabs" button

### Monitoring
- Hidden tabs counter appears in settings when tabs are hidden
- Task overlay shows all tabs regardless of visibility
- Search functionality includes hidden tabs in results

## Technical Considerations

### Performance
- **Minimal overhead**: Only checks tabs once per hour when enabled
- **Efficient filtering**: Uses Set lookups for O(1) visibility checks  
- **No DOM manipulation**: Hidden tabs maintain webview state
- **Event-driven updates**: Only re-renders when visibility changes

### Memory Management
- **Cleanup on tab destruction**: Removes references to destroyed tabs
- **Timeout management**: Properly cancels animation timers
- **Settings synchronization**: Persists state changes immediately

### Edge Cases Handled
- **Selected tab protection**: Never hides currently selected tab
- **Recent activity**: Cancels hide for tabs with recent activity
- **Animation interruption**: Gracefully handles user interactions during animation
- **Settings disable**: Reveals all hidden tabs when feature disabled
- **Initialization order**: Defers listeners until tab state (`tasks`) is ready; guards tasks access
- **Multiple windows**: Hidden tab state is currently shared globally, not window-scoped

### Browser Compatibility
- **Electron-specific**: Built for Min browser's Electron environment
- **Modern JavaScript**: Uses ES6+ features (Set, arrow functions)
- **CSS animations**: Requires modern CSS animation support

## Debugging & Development

### Debug Information
```javascript
// Get comprehensive debug info
autoCleanTabs.getDebugInfo()
// Returns: enabled state, threshold, hidden tabs, animations, interval state
```

### Testing
- Use Capabilities menu for quick tests (Enable/Disable, Run Check Now, Demo Hide One Tab, Show All Hidden)
- Console: `autoCleanTabs.runCheckNow()` or `autoCleanTabs.demoHideOneTab()`
- Settings: live hidden count and "Show All Hidden Tabs" button
- Logs: `[AutoCleanTabs] …`, `[Settings][AutoCleanTabs] …`, `[Menu] …`

### Common Issues
1. **Initialization errors**: Check browser console for "System not ready" messages - module will retry automatically
2. **Tabs not hiding**: Check if feature is enabled and threshold is appropriate
3. **Animation not showing**: Verify CSS is loaded and tab is visible
4. **Settings not persisting**: Check settings.json permissions and format
5. **IPC communication failing**: Verify preload script loading
6. **Null reference errors**: Fixed with defensive programming and system readiness checks

### Initialization Notes
- `autoCleanTabs.init()` is invoked from `js/default.js` after tab state initializes.
- The module guards against early access to `tasks` and retries attaching listeners until ready.

### Development Workflow
1. Modify `js/autoCleanTabs.js` for core logic changes (initialized from `js/default.js`)
2. Update CSS for animation adjustments  
3. Test via Capabilities menu and console helpers
4. Verify settings integration
5. Check all usage scenarios (manual, automatic, bulk operations)
6. Monitor browser console for detailed logs

## Future Enhancement Opportunities

### Potential Features
- **Custom animation styles**: User-selectable warning animations
- **Domain-based rules**: Never hide tabs from specific domains
- **Activity-based hiding**: Consider scroll, typing, or interaction patterns
- **Bulk management UI**: Advanced hidden tabs management interface
- **Export/import**: Save and restore hidden tabs configuration

### Architecture Improvements
- **Worker-based checking**: Move periodic checks to background worker
- **Smarter filtering**: Machine learning for usage pattern recognition
- **Performance monitoring**: Built-in metrics for feature impact

## Code Style & Conventions

### Naming Conventions
- **Module**: `autoCleanTabs` (camelCase)
- **CSS classes**: `auto-clean-warning` (kebab-case)
- **Settings keys**: `autoCleanTabs` (camelCase)
- **Functions**: `hideTabWithAnimation()` (camelCase, descriptive)

### Error Handling
- **Graceful degradation**: Feature fails silently if not supported
- **Validation**: Input validation for settings (1-30 day range)
- **Safe defaults**: Sensible fallbacks for all configuration

### Documentation Standards
- **Comprehensive comments**: Every major function documented
- **Example usage**: Code examples for complex APIs
- **Change tracking**: Document all modifications and reasoning

---

## Summary

The Auto-Clean Tabs feature provides a sophisticated yet user-friendly solution to tab clutter without sacrificing functionality. Its non-destructive approach, combined with clear visual feedback and flexible controls, makes it a valuable addition to the Min browser's productivity features.

**Key Success Factors:**
- ✅ Simple, centralized architecture
- ✅ Non-invasive implementation  
- ✅ Rich user feedback (sparkle animation)
- ✅ Complete manual override capability
- ✅ Seamless integration with existing features
- ✅ Comprehensive settings and monitoring

This documentation serves as the definitive guide for understanding, maintaining, and extending the Auto-Clean Tabs feature.
