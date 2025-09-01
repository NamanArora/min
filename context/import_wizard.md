# Import Wizard: Cross-Browser Personal Data Import

This document explains how the Import Wizard works end-to-end: UI, IPC bridges, renderer logic, browser-specific handling, and implementation details. It is intended to give new contributors enough context to modify, extend, or debug the feature confidently.

---

## Overview

- Goal: Make it easy to import personal data (bookmarks, history, passwords) from Chrome, Firefox, or Safari.
- Entry point: Menu → Capabilities → "Import From Other Browsers...".
- Scope (current):
  - Bookmarks
    - Chrome: automatic (reads native `Bookmarks` JSON)
    - Any browser: manual via bookmarks HTML export
  - Passwords: manual via CSV export (imported into the built‑in password manager)
  - History: automatic from Chrome/Firefox/Safari via their SQLite databases
  - Profiles: selectable for Chrome and Firefox (friendly names)

---

## Files & Responsibilities

High-level components and their responsibilities:

- Main menu (entry point)
  - `main/menu.js`
    - Adds menu item: `Capabilities → Import From Other Browsers...`
    - Opens internal page: `min://app/pages/import/index.html`

- Internal page (UI)
  - `pages/import/index.html`
    - Wizard UI: browser + profile selectors, data checkboxes, buttons
  - `pages/import/import.css`
    - Styling and layout (grid, buttons, card container, labels)
  - `pages/import/import.js`
    - Runs in an internal page without Node.js
    - Sends/receives messages via `window.postMessage` to communicate with the renderer through preload

- Preload bridge (internal page <-> host renderer)
  - `js/preload/default.js`
  - `dist/preload.js` (generated bundle, patched for immediate functionality)
    - Forwards page messages to renderer with IPC
    - Forwards renderer’s results back to the page via `window.postMessage`

- Renderer-side handlers (Node-capable)
  - `js/webviews.js`
    - Binds IPC message names from internal page
    - Performs file system access, database queries, and writes data into Places or Password Store

- Existing helpers used
  - `js/bookmarkConverter.js`
    - Import Bookmarks from HTML into Places
  - `js/passwordManager/keychain.js`
    - Import credentials from CSV into built‑in password store (uses `papaparse`)
  - `js/places/places.js` and `js/places/placesService.js`
    - API and service to update places (history/bookmark entries)

---

## UI Flow (User Experience)

1. User opens `Capabilities → Import From Other Browsers...`.
2. Wizard loads with:
   - Browser selector: Chrome, Firefox, Safari
   - Profile selector: auto-populated for Chrome/Firefox with friendly names
   - Checkboxes: Bookmarks, History, Passwords
   - Actions: Start Import; manual import for Bookmarks HTML and Passwords CSV
3. Start Import sends requests based on selected data types and browser/profile.
4. Status messages update inline (e.g., counts imported or errors like sqlite3 missing).

---

## Message/IPC Protocol

All internal page ↔ renderer communication uses `window.postMessage` routed via the preload script to Electron IPC.

Page → Preload → Renderer (js/webviews.js):
- `importWizardListProfiles` { browser }
- `importWizardChromeBookmarksAuto` { profile }
- `importWizardBookmarksFromHTML`
- `importWizardPasswordsCSV`
- `importWizardHistory` { browser, profile }

Renderer → Preload → Page:
- `importWizardProfiles` { profiles: [{ id, label }] }
- `importWizardResult` { type, ok, count?, browser?, error? }
  - `type`: `chromeBookmarks` | `bookmarksHTML` | `passwordsCSV` | `history`
  - `error`: `not_found` | `sqlite3_missing` | `unknown_browser` | custom message

Files:
- Bridge forwarding is implemented in `js/preload/default.js` and mirrored in `dist/preload.js`.
- Renderer binding in `js/webviews.js` via `webviews.bindIPC(name, handler)`.

---

## Internal Page (UI) Details

- `pages/import/index.html`: markup for selectors, checkboxes, and actions.
- `pages/import/import.css`: layout (grid), card container, button styles, readable checkbox labels.
- `pages/import/import.js`:
  - No Node: uses `window.postMessage` only.
  - On browser change, requests profiles via `importWizardListProfiles`.
  - Populates the profile dropdown on receiving `importWizardProfiles`.
  - On Start Import:
    - Chrome bookmarks: `importWizardChromeBookmarksAuto` with selected profile
    - History: `importWizardHistory` with selected browser/profile
    - Passwords: prompts via `importWizardPasswordsCSV`
    - Bookmarks (manual): prompts via `importWizardBookmarksFromHTML`
  - Displays status via `importWizardResult` messages.

---

## Profiles (Chrome/Firefox) Detection

Implemented in `js/webviews.js` under `importWizardListProfiles`.

- Chrome
  - Base path:
    - macOS: `~/Library/Application Support/Google/Chrome`
    - Windows: `%LOCALAPPDATA%/Google/Chrome/User Data`
    - Linux: `~/.config/google-chrome`
  - Directories considered: `Default`, `Profile N`
  - Friendly names: parses `Local State` (`profile.info_cache`) to map id → display name; label shown as `"<name> (Profile N)"` when available.

- Firefox
  - Root path for `profiles.ini`:
    - macOS: `~/Library/Application Support/Firefox`
    - Windows: `%APPDATA%/Mozilla/Firefox`
    - Linux: `~/.mozilla/firefox`
  - Parse `[ProfileX]` sections: `Name`, `Path`, `IsRelative`, `Default`.
  - Compute `id` from the directory name in `Path`; label from `Name` (appends `"(default)"` when `Default=1`).
  - Filter to directories that actually exist. Sort: default first → default-release → A–Z.

- Safari
  - Single default profile (no UI change on selection).

The selected `id` is passed to import handlers to target the correct filesystem location.

---

## Imports by Data Type

### Bookmarks

- Chrome (automatic):
  - Handler: `importWizardChromeBookmarksAuto` in `js/webviews.js`
  - Reads native JSON at `<ChromeProfile>/Bookmarks`.
  - Traverses `roots.bookmark_bar`, `roots.other`, `roots.synced` and pushes entries to Places with `isBookmarked: true`, `tags` from folder names, `lastVisit` parsed from Chrome’s epoch.

- Manual HTML (any browser):
  - Handler: `importWizardBookmarksFromHTML`
  - Opens file dialog, reads chosen HTML file, and calls `bookmarkConverter.import()`
  - Implementation in `js/bookmarkConverter.js` handles HTML-to-Places mapping.

### Passwords (CSV)

- Handler: `importWizardPasswordsCSV`
- Opens file dialog to select a CSV (from Chrome/Firefox/Safari exports).
- Calls `Keychain.importCredentials(csv)` from `js/passwordManager/keychain.js`.
  - Uses `papaparse` to parse
  - De-duplicates against existing entries before bulk-save to local password store via main process IPC.

### History

- Handler: `importWizardHistory`
- Uses the system `sqlite3` CLI (spawned) to query browser history databases. Output is streamed to avoid buffer limits.
- Copies DB to a temporary file to avoid locks, then queries with `-header -csv` for easy parsing by `papaparse`.
- Inserts into Places via `places.updateItem(url, { title, lastVisit, visitCount, isBookmarked: false })`.

Queries and time conversion:
- Chrome
  - DB: `<ChromeProfile>/History`
  - Query: `SELECT url, title, last_visit_time, visit_count FROM urls ORDER BY last_visit_time DESC LIMIT 5000;`
  - Time: microseconds since Windows epoch (1601‑01‑01) → Unix ms (`last_visit_time / 1000 - 11644473600000`).

- Firefox
  - DB: `<FirefoxProfilesRoot>/<profileId>/places.sqlite`
  - Query: `SELECT url, title, last_visit_date, visit_count FROM moz_places WHERE last_visit_date IS NOT NULL ORDER BY last_visit_date DESC LIMIT 5000;`
  - Time: microseconds since Unix epoch → ms (`last_visit_date / 1000`).

- Safari (macOS)
  - DB: `~/Library/Safari/History.db`
  - Query: `SELECT history_items.url AS url, history_items.title AS title, MAX(history_visits.visit_time) AS last_time, COUNT(history_visits.id) AS cnt FROM history_items LEFT JOIN history_visits ON history_items.id = history_visits.history_item GROUP BY url, title ORDER BY last_time DESC LIMIT 5000;`
  - Time: seconds since 2001‑01‑01 → Unix ms (`(visit_time + 978307200) * 1000`).

Errors returned to UI:
- `sqlite3_missing`: sqlite3 CLI not found on PATH.
- `not_found`: database file missing or path not detected.
- `unknown_browser`: unsupported browser key.

---

## Renderer Implementation (js/webviews.js)

Bound handlers:
- `importWizardListProfiles(tabId, [ { browser } ])`
  - Detects and returns `{ profiles: [{ id, label }] }` via `importWizardProfiles`.
- `importWizardChromeBookmarksAuto(tabId, [ { profile } ])`
  - Parses `<ChromeProfile>/Bookmarks` and writes bookmarks to Places.
- `importWizardBookmarksFromHTML(tabId)`
  - Prompts for HTML file, calls `bookmarkConverter.import()`.
- `importWizardPasswordsCSV(tabId)`
  - Prompts for CSV file, calls `Keychain.importCredentials()`.
- `importWizardHistory(tabId, [ { browser, profile } ])`
  - Detects database paths and runs sqlite queries (using `spawn('sqlite3', ...)`).

Notes:
- Streaming `spawn` avoids `maxBuffer` errors from `execFile`.
- DBs are copied to a temp file to avoid locks.
- Minimal sanitization; arguments are fixed strings with no user-provided SQL.

---

## Preload Bridge (js/preload/default.js & dist/preload.js)

Forwards page messages to the renderer using `ipc.send`:
- From page to main renderer:
  - `importWizardListProfiles`, `importWizardChromeBookmarksAuto`, `importWizardBookmarksFromHTML`, `importWizardPasswordsCSV`, `importWizardHistory`.
- From renderer back to page via `window.postMessage`:
  - `importWizardProfiles` (list of profiles)
  - `importWizardResult` (status updates)

This ensures the internal page has no direct Node.js access, aligning with the app’s security posture (context isolation).

---

## UI & Styling Notes

- Wizard UI lives in `pages/import/` and uses a minimal, clean style:
  - Grid alignment for Browser/Profile
  - Card container with shadow, rounded corners
  - Clear labels and accessible form controls
  - Primary action and subdued secondary buttons
- To keep text next to checkboxes visible, the wizard avoids `setting-section` CSS pattern that sets `font-size: 0`.

---

## How to Test

1. Dev setup: `npm install` (first time), then `npm start`.
2. Open the wizard: Menu → Capabilities → Import From Other Browsers...
3. Profiles:
   - Switch Browser selector; confirm profile dropdown populates
   - Chrome should show friendly names from Local State (e.g., "Alice (Profile 2)")
   - Firefox should show names from `profiles.ini` with “(default)” when relevant
4. Bookmarks:
   - Chrome automatic: select Chrome + profile, check Bookmarks, Start Import
   - Manual HTML: click “Import Bookmarks from HTML...” and select a `.html` export
5. Passwords:
   - Click “Import Passwords from CSV...” and select an exported CSV
6. History:
   - Check History and Start Import (ensure sqlite3 is installed and on PATH)
7. Watch the status text for progress/errors; review console logs for details.

---

## Limitations & Future Improvements

- sqlite3 dependency: history import requires sqlite3 CLI in PATH; consider bundling a WASM sqlite reader or a Node module for portability.
- Progress reporting: currently updates on completion; could add incremental counts for large imports.
- Chrome variants: add detection for Chromium, Chrome Beta/Canary, and Linux distro-specific paths.
- Preselection: prefer the last-used Chrome profile (`profile.last_used` in `Local State`).
- Safari bookmarks (automatic): parse `Bookmarks.plist` for auto-import without requiring HTML export.
- Error surfacing: add inline diagnostics (e.g., DB path shown on not_found).
- Deduplication: smarter merging for history/bookmarks when importing repeatedly.

---

## Summary

The Import Wizard provides a secure, internal-page UI that leverages a preload bridge to hand off filesystem and database work to the renderer. It unifies Chrome/Firefox/Safari imports for bookmarks, passwords, and history, with profile-aware targeting and friendly labeling. The implementation is modular and extensible for additional browsers or data types.

