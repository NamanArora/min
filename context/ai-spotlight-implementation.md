# AI Spotlight Implementation Guide

## Overview

The AI Spotlight is a macOS Spotlight-style modal dialog that allows users to quickly ask AI questions about the current page or get general assistance. It's activated via a keyboard shortcut (`Cmd+Shift+Enter` on Mac, `Ctrl+Shift+Enter` on other platforms) and appears as a modal overlay above all browser content.

## Key Features

- **Global keyboard shortcut** - Works from any tab, regardless of focus
- **Modal window overlay** - Appears above all content including web pages
- **Page context aware** - Extracts content from the current page for context-aware responses
- **Seamless integration** - Forwards queries to the existing AI sidebar system
- **Modern UI** - Glassmorphism design with smooth animations

## Architecture

### The Challenge

Min Browser uses Electron's WebContentsView system for tabs, which creates a layering issue:
- **DOM Elements** (like overlays) render in the main UI layer
- **WebContentsViews** (actual web pages) render above the main UI layer
- **Result**: Traditional DOM overlays cannot appear above web page content

### The Solution

We implemented a **modal window approach**:
1. **Global shortcut** registered in main process captures keyboard events system-wide
2. **Separate BrowserWindow** created as modal dialog that overlays everything
3. **IPC communication** bridges modal window and main UI for seamless integration

## File Structure

### Core Files

```
main/
├── aiSpotlightWindow.js        # Modal window management
├── main.js                     # Global shortcut registration + IPC init

js/ai/
├── aiSpotlight.js              # Renderer-side IPC handling
├── aiSidebar.js                # Existing AI sidebar (receives queries)

pages/aiSpotlight/
└── index.html                  # Modal window UI

scripts/
└── buildMain.js                # Build configuration (module order)
```

### File Responsibilities

#### `main/aiSpotlightWindow.js`
- **Purpose**: Manages the modal window lifecycle
- **Key Functions**:
  - `showSpotlight(parentWindow)` - Creates and shows modal
  - `hideSpotlight()` - Hides modal window
  - `createSpotlightWindow(parent)` - Window creation with proper styling
  - `initializeSpotlightIPC()` - Sets up IPC message handlers
- **Important**: Uses Min's `windows.getCurrent()` and `getWindowWebContents()` for reliable IPC communication

#### `main/main.js`
- **Purpose**: Application initialization and global shortcut
- **Key Additions**:
  - Global shortcut registration in `app.on('ready')` handler
  - Calls `initializeSpotlightIPC()` after IPC is available
  - Calls `showSpotlight(currentWindow)` on shortcut activation

#### `js/ai/aiSpotlight.js`
- **Purpose**: Renderer-side communication handling
- **Key Function**:
  - `handleQueryFromModal(query)` - Receives queries from modal and forwards to sidebar

#### `pages/aiSpotlight/index.html`
- **Purpose**: Modal window user interface
- **Features**:
  - Auto-resizing textarea
  - Keyboard navigation (Enter to submit, Escape to close)
  - Modern glassmorphism styling with dark mode support
  - IPC communication to main process

## Data Flow

```
1. User presses Cmd+Shift+Enter
   ↓
2. Keybinding system triggers showAISpotlight
   ↓
3. showSpotlight(currentWindow) called
   ↓
4. Modal BrowserWindow created and shown
   ↓
5. User types query and presses Enter
   ↓
6. Modal sends 'ai-spotlight-submit' IPC message
   ↓
7. Main process forwards as 'ai-spotlight-query' to renderer
   ↓
8. aiSpotlight.js receives and forwards to aiSidebar.js
   ↓
9. AI conversation added to sidebar
   ↓
10. Modal window hides automatically
```

## Build System Integration

Min uses a **concatenation-based build system** rather than traditional bundlers:

### Key Points:
- All main process files are concatenated into `main.build.js`
- **Module order matters** - functions must be defined before use
- **No `require()` statements** in concatenated files
- **Shared global scope** across all concatenated modules

### Build Configuration (`scripts/buildMain.js`):
```javascript
const modules = [
  // ... other modules
  'main/aiSpotlightWindow.js',  // Must come BEFORE main.js
  'main/main.js',               // Uses functions from aiSpotlightWindow.js
  // ... other modules
]
```

## Implementation Challenges & Solutions

### Challenge 1: Keyboard Events Captured by WebViews
**Problem**: When a web page has focus, renderer-side keyboard listeners don't receive events.

**Solution**: Use Min's proper keybinding system with `keybindings.defineShortcut()` which works with `before-input-event` forwarding.

### Challenge 2: DOM Overlays Can't Cover WebContentsViews
**Problem**: CSS overlays appear below web page content due to Electron's rendering layers.

**Solution**: Create separate modal `BrowserWindow` that renders above all content.

### Challenge 3: Variable Initialization Order
**Problem**: Concatenated build system caused `ipc` to be used before declaration.

**Solution**: Wrap IPC handlers in initialization function called after variables are available.

## How to Modify

### Changing the Keyboard Shortcut
**File**: `js/util/keyMap.js`
```javascript
// Change this line in defaultKeyMap:
showAISpotlight: 'shift+mod+enter'  // mod = Cmd on Mac, Ctrl on others
```

### Modifying Modal Appearance
**File**: `pages/aiSpotlight/index.html`
- Update CSS styles in the `<style>` section
- Modify HTML structure in the `<body>` section

### Changing Modal Behavior
**File**: `main/aiSpotlightWindow.js`
- Modify window properties in `createSpotlightWindow()`
- Adjust positioning, sizing, or modal behavior
- Update IPC message handling

### Adding New Features
1. **Add IPC handlers** in `initializeSpotlightIPC()` function
2. **Update modal UI** in `pages/aiSpotlight/index.html`
3. **Handle responses** in `js/ai/aiSpotlight.js`

## Debugging Tips

### Common Issues:

1. **"Cannot find module" errors**
   - Check if new files are added to `scripts/buildMain.js` modules array
   - Verify correct file paths

2. **"Variable not defined" errors**
   - Check module order in `scripts/buildMain.js`
   - Ensure functions are defined before use

3. **IPC messages not received**
   - Verify `initializeSpotlightIPC()` is called in `main.js`
   - Check IPC message names match between sender and receiver

4. **"Cannot read properties of undefined (reading 'send')" error**
   - This happens when IPC communication fails
   - Ensure using `windows.getCurrent()` and `getWindowWebContents()` patterns
   - Avoid direct `window.webContents.send()` calls

5. **Global shortcut interference**
   - If shortcut works when other apps are focused, check that proper keybinding system is used
   - Should use `keybindings.defineShortcut()` not `globalShortcut.register()`

6. **Keyboard shortcut not working**
   - Check key name consistency - use `enter` not `return` in keyMap.js
   - Min's other shortcuts use `'mod+enter'`, `'shift+mod+enter'` format
   - Verify the key combination doesn't conflict with existing shortcuts

7. **Modal not appearing**
   - Check global shortcut registration
   - Verify `showSpotlight()` function is being called
   - Check console for JavaScript errors in modal window

### Debugging Commands:
```bash
# Rebuild after changes
npm run build

# Start in development mode
npm run start

# Check for linting issues
npx standard js/ai/*.js main/aiSpotlightWindow.js
```

## Future Enhancements

Potential improvements that could be added:

1. **Multiple Spotlight Windows** - Allow multiple queries simultaneously
2. **Query History** - Remember recent queries for quick access
3. **Custom Shortcuts** - Allow users to configure keyboard shortcuts
4. **Positioning Options** - Let users choose modal placement
5. **Quick Actions** - Add preset query buttons
6. **Voice Input** - Support speech-to-text for queries

## Integration Points

The AI Spotlight integrates with existing Min Browser systems:

- **AI Sidebar** (`js/ai/aiSidebar.js`) - Receives and processes queries
- **LLM Provider** (`js/ai/llmProvider.js`) - Uses existing AI backend
- **Settings System** - Respects existing AI configuration
- **Localization** - Uses existing translation system
- **Theme System** - Automatically adapts to dark/light mode

## Testing Checklist

When making modifications, test:

- [ ] Keyboard shortcut works from any tab
- [ ] Modal appears above web page content
- [ ] Query submission works correctly
- [ ] AI sidebar opens with conversation
- [ ] Modal closes after submission
- [ ] Escape key closes modal
- [ ] Dark mode styling works
- [ ] Window resizing works properly
- [ ] No console errors
- [ ] Build system works correctly

---

*This implementation successfully overcame Electron's WebContentsView layering limitations and Min's custom build system constraints to deliver a polished, system-level AI interaction feature.*