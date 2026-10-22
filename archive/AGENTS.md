# AGENTS.md — DesignNote Chrome Extension

> **Start with `NOW.md`**: current status. The annotation UI v2 (one-line composer, card sidebar, table actions, Glass/Liquid surfaces) is built; spec in `DESIGN.md`, reference in `annotation-variations.html#shortlist`.

## Quick start
- **No build, no package.json** — plain vanilla JS/HTML/CSS
- **Tests (Node, no deps)**: `node tests/selector-fingerprint.test.js`, `node tests/content-helpers.test.js`, `node tests/browser-smoke.js`, `node tests/browser-env.js`, `node tests/browser-privacy.js`, `node tests/browser-a11y.js`, `node tests/browser-annotation-ui.js` and `node tests/browser-bridge.js` (real Chrome via DevTools pipe; `CHROME_PATH` for Edge; the privacy suite is fully offline)
- **UX/a11y rules**: Escape closes the innermost layer only while focus is in our UI, and every close returns focus to the opener; colours come from tokens (`getTypeColor` returns `var(...)`); see `docs/ux/UX_AUDIT.md`
- **Privacy rules**: Enhance/Drive only on trusted user input + one-time consent (`confirmOnce`); AI gets page origin+path only; no host-page storage writes; see `docs/product/PRIVACY_AND_PERMISSIONS.md`
- **Load**: `chrome://extensions` → Developer mode → Load unpacked → select this folder
- **Reload after edits**: click reload icon on extension card; content script changes also require reloading the target page
- **Local files**: enable "Allow access to file URLs" on extension details

## Architecture (5 files, no modules)
| File | Role |
|------|------|
| `selector.js` | Content script (loads first). Exposes `window.__designNoteGetSelector(el)` — best-effort CSS selector generator |
| `content.js` | Main content script (IIFE). All in-page UI under `#designnote-root`. Stores annotations per-URL in `chrome.storage.local` as `dn_annotations::<url>` |
| `background.js` | MV3 service worker. Handles `CAPTURE_SCREENSHOT` (via `chrome.tabs.captureVisibleTab`) and `ENHANCE_PROMPT` (calls AI provider with API key from storage) |
| `popup.js` / `popup.html` | Toolbar popup: annotation count + open sidebar / settings |
| `settings.js` / `settings.html` | Options page: AI provider + API key (`dn_provider`, `dn_api_key` in storage) |

## Message flow
- `content.js` / `settings.js` → `chrome.runtime.sendMessage` → `background.js` (`CAPTURE_SCREENSHOT`, `ENHANCE_PROMPT`, `UPLOAD_TO_DRIVE`, `CHECK_DRIVE`, `DISCONNECT_DRIVE`)
- `popup.js` → `background.js` (`TAB_MESSAGE`) → `sendToTab()` → `content.js` (`TOGGLE_SIDEBAR_OPEN`, `SHOW_PILL`, `GET_ANNOTATION_COUNT`); shortcuts → `runCommand()` → `sendToTab()` (`TOGGLE_SIDEBAR`, `TOGGLE_PILL`, `TOGGLE_MARK_MODE`). `sendToTab` injects the content script via `chrome.scripting` when a tab has none.

## Critical constraints
- **Load order matters**: `selector.js` must precede `content.js` in `manifest.json` → `content_scripts.js` array
- **CSS isolation**: all injected DOM under `#designnote-root` (uses `all: revert` in `content.css`)
- **Offline-first**: no network calls in `content.js` or annotation save/load path; only `background.js` calls AI provider
- **API keys**: only ever sent from `background.js` → provider API, nowhere else

## Data model (per URL in `chrome.storage.local`)
```
{ id, type: "text"|"suggestion"|"bug"|"note"|<custom category>, text, selector, fingerprint, rect, screenshot: PNG data URL|null, timestamp (created), updatedAt?, copiedAt? }
```

## Known limitations (don't "fix" without spec)
- Selector fragility on React/Vue re-renders (uses id/data-attr → nth-child fallback, max depth 8)
- Screenshots capture visible viewport only
- No cross-device sync (local-first by design)

## Google Drive export (one-time user setup)
- User pastes OAuth client ID in Settings; redirect URI is `https://<extension-id>.chromiumapp.org/`
- Extension ID changes on reload-unpacked on different machines → pin with `"key"` in `manifest.json` or update Cloud Console