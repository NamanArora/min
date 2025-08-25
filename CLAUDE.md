# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Build Commands
- `npm run build` - Build all components (main, browser, styles, preload)
- `npm run buildMain` - Build main process files
- `npm run buildBrowser` - Build browser UI files  
- `npm run buildBrowserStyles` - Build CSS files
- `npm run buildPreload` - Build preload scripts

### Development Workflow
- `npm run start` - Build and start development mode with file watching
- `npm run watch` - Watch files and rebuild on changes
- `npm run startElectron` - Start Electron in development mode
- Development mode: `electron . --development-mode`
- Reload UI during development: `alt+ctrl+r` (or `opt+cmd+r` on Mac)

### Testing & Quality
- `npm run test` - Run StandardJS linter on all JS files
- `npm run lint` - Format code with Prettier and fix StandardJS issues
- Code style: Uses [StandardJS](https://standardjs.com/) with Prettier formatting

### Binary Building
- `npm run buildWindows` - Build Windows executable
- `npm run buildMacIntel` - Build macOS Intel binary
- `npm run buildMacArm` - Build macOS ARM binary  
- `npm run buildDebian` - Build Debian package
- `npm run buildRedhat` - Build RPM package
- `npm run buildAppImage` - Build AppImage for Linux
- `npm run buildAll` - Build all platform binaries

### Maintenance Commands
- `npm run updateFilters` - Update ad blocking filters
- `npm run updateHttpsList` - Update HTTPS upgrade lists
- `npm run updateSuffixes` - Update public suffix list

## Architecture Overview

Min is an Electron-based browser with a modular architecture:

### Main Process (`main/`)
- `main.js` - Application lifecycle and window management
- `viewManager.js` - WebContentsView management for tabs
- `windowManagement.js` - Window creation and management
- `filtering.js` - Ad blocking and content filtering
- `download.js` - Download management
- `permissionManager.js` - Website permission handling

### Renderer Process (`js/`)
- `browserUI.js` - Core UI coordination and tab management
- `webviews.js` - Tab content management
- `tabBar.js`, `tabEditor.js` - Tab interface components
- `searchbar/` - Search functionality and plugins
- `navbar/` - Navigation bar components
- `places/` - History and bookmark management with full-text search

### Build System (`scripts/`)
- Custom build scripts that concatenate and bundle files
- `watch.js` - File watching for development
- Platform-specific build scripts for distribution

### Key Concepts
- **Tasks**: Tab groups that can be switched between
- **Places**: Unified history/bookmark system with full-text search
- **Webviews**: Individual tab instances using WebContentsView
- **Preload Scripts**: Injected into web pages for functionality like password management

### Module Loading
- Uses CommonJS-style `require()` for module organization
- Custom build system bundles files rather than using a bundler
- Global variables like `tabs`, `tasks`, `webviews` coordinate between modules

### Database
- Uses Dexie.js (IndexedDB wrapper) for local data storage
- Full-text search capabilities for visited pages
- Bookmark tagging and organization system