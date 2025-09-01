# Repository Guidelines

## Project Structure & Module Organization
- Source: `js/` (renderer/UI), `main/` (Electron main), `js/preload/` (preload), `css/` (styles), `pages/` (HTML settings/UI), `ext/` (filters and data), `scripts/` (build tooling).
- Assets: `icons/`, `resources/`, `localization/`, `reader/`.
- Docs/context: `README.md`, `context/`.
- Example modules: `js/navbar/tabBar.js`, `js/autoCleanTabs.js`, `js/taskOverlay/`.

## Architecture Overview
- Electron app with custom build scripts; CommonJS `require()` modules.
- Main (`main/`): app lifecycle, windows, downloads, permissions, filtering.
- Renderer (`js/`): `browserUI.js` orchestrates tabs, `webviews.js` manages content, `navbar/` and `searchbar/` provide UI, `places/` handles history/bookmarks.
- Concepts: Tasks (tab groups), Places (history/bookmarks), Webviews (tab content), Preload scripts (page helpers).

## Build, Test, and Development Commands
- `npm install`: Set up dev environment (runs `scripts/setupDevEnv.js`).
- `npm start`: Build once, watch sources, and launch Electron with `--development-mode`.
- `npm run watch`: Rebuild browser, styles, preload on change.
- `npm run build`: Build main, browser, styles, and preload bundles.
- `npm test`: Run StandardJS lint over `js/**/*.js` and `main/*.js`.
- Platform builds: `npm run buildWindows`, `buildMacIntel`, `buildMacArm`, `buildDebian`, `buildRedhat`, `buildAppImage`.
- Lint/format: `npm run lint` (Prettier for CSS/HTML/MD/JSON + StandardJS fix).
- Tip: In dev, use `alt+ctrl+r` (or `opt+cmd+r` on macOS) to reload UI.

## Coding Style & Naming Conventions
- JavaScript: StandardJS (2-space indent, single quotes, no semicolons, CommonJS `require`/`module.exports`).
- CSS/HTML/JSON/MD: Prettier defaults. CSS classes use kebab-case.
- Filenames: camelCase for JS modules (e.g., `autoCleanTabs.js`, `tabContextMenu.js`).
- Strings/UI text: use `l('key')` localization helpers where applicable.

## Testing Guidelines
- No unit test framework is configured; `npm test` is lint-only.
- Manual testing: run the app (`npm start`) and verify features (e.g., Tasks overlay, tab bar). Ad-hoc console scripts may live at repo root (example: `test-auto-clean-tabs.js`).
- Prefer small, reproducible steps and screenshots/GIFs for UI-affecting changes.

## Commit & Pull Request Guidelines
- Commits: concise, imperative subject (≤72 chars), include scope when helpful (e.g., `navbar:`). Group related changes only.
- PRs: clear description, what/why, steps to reproduce/verify, and linked issues (`Fixes #123`). Include before/after screenshots for UI changes.
- Checks: ensure `npm test` and `npm run build` succeed; run `npm run lint` before pushing.
- Documentation: update `README.md`, `context/`, or relevant code comments when behavior changes.

## Security & Configuration Tips
- Do not commit secrets or user data. Settings persist to `settings.json` in the app’s user-data path; avoid breaking migrations.
- Electron specifics: changes that touch IPC or preload should be minimal and audited for context isolation and message validation.

## Agent-Specific Instructions
- Keep changes surgical: respect existing globals (`tabs`, `tasks`, `webviews`) and event patterns.
- Wire settings via `util/settings/settings.js`; add `l('…')` keys for user-facing strings.
- Validate in renderer: run `npm start`, reproduce, and use DevTools console for quick scripts.
- When adding UI, update `css/` and `pages/` consistently; prefer small, composable modules under `js/`.
