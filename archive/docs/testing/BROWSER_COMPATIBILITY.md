# Browser Compatibility — Phase 2 results

_Run 2026-10-18 on Windows 11. Each browser was tested for real: the unpacked extension was loaded and driven by `tests/browser-smoke.js` (22 checks) and `tests/browser-env.js` (18 checks)._

## Matrix

| Browser | Version | Smoke (22) | Environment (18) | Status |
|---|---|---|---|---|
| **Google Chrome** | 155.0.8059.84 | 22/22 | 18/18 | **Supported — first-release target** |
| **Microsoft Edge** | 156.0.4314.30 | 22/22 | 18/18 | **Tested** |
| Brave / Arc / Opera / Vivaldi | — | not run | not run | Not yet verified (not installed) |
| Firefox / Zen 121+ | — | not run | not run | **Not yet verified** (not installed; see Firefox risks below) |
| Safari | — | — | — | Not supported |

All runs were headless. Headed mode (`HEADED=1`) and real key presses were not exercised (see "Not covered").

## Environment checks (tests/browser-env.js)

| ID | Check | Original code | Now |
|---|---|---|---|
| E1 | Manifest loads; Chrome's own install warnings (via `chrome.developerPrivate`) | no warnings | no warnings |
| E2 | Background runs as an MV3 service worker | ✓ | ✓ |
| E3 | Every declared shortcut is actually assigned (`chrome.commands.getAll`) | **none assigned** | ✓ `Alt+Shift+D/M/H` |
| E4/E5 | Popup shows the page's count; "Open sidebar" works | ✓¹ | ✓ |
| E6 | Popup on a page DesignNote can't run on | **bare "0"** | ✓ explains why |
| E7 | Settings: redirect URI, Drive "Not connected" without client ID, save persists | ✓ | ✓ |
| E8 | Save after the service worker was stopped still captures a screenshot | ✓¹ | ✓ |
| E9 | Badge updates on save and follows pushState routes | **badge never updated after a save** (any page)² | ✓ |
| E10 | Dark mode switches the UI tokens | ✓ | ✓ |
| E11 | 375×667: pill, compact and expanded sidebar fit | ✓ | ✓ |
| E12 | Extension CSS matches no host element except the `:root` token block | ✓ | ✓ |
| E13 | Aggressive host CSS + fixed header at max z-index: pill clickable, sidebar not covered | **sidebar top covered** | ✓ |
| E14 | Annotate inside a modal `<dialog>` | **form opens but can't be typed in** | ✓ |
| E15 | After an extension reload/update, the old tab says "Refresh this page" | **uncaught `TypeError`, nothing shown** | ✓ |
| E16 | Popup on that tab still works (re-injects) | **"0"** | ✓ (count 2) |
| E17 | No uncaught extension errors in pages during normal use | ✓ | ✓ |
| E18 | Shortcut handlers: sidebar toggles open *and* closed, Mark toggles, pill hides | sidebar shortcut could only open (source) | ✓ |

¹ Not comparable on the original code: its form had no preset categories, so the test's quick-note helper couldn't save there.
² Shown separately on the end-of-Phase-1 code: note saved to storage, badge stayed 0 for 6 s+.

## Manifest decisions (checked against official docs)

- **`background.service_worker` + `background.scripts` — keep both.** MDN recommends this for cross-browser MV3: Firefox ignores `service_worker` and starts `scripts`; from Firefox 121 the background starts even when `service_worker` is present (bug 1860304). That matches `strict_min_version: 121.0`. Chrome refused MV3 manifests containing `background.scripts` before ~121 and now ignores the key; Chrome 155 and Edge 156 load the manifest with **no install warnings** (E1).
- **`browser_specific_settings.gecko`** — Chrome/Edge accept it silently (E1).
- **Shortcuts changed** from `Ctrl+Shift+D/P/M` to `Alt+Shift+D/H/M`. A probe extension showed Chrome 155 refuses to assign `Ctrl+Shift+D`, `Ctrl+Shift+M`, `Ctrl+Shift+P`, `Alt+Shift+P` and `Alt+Shift+N` (browser conflicts) and accepts `Alt+Shift+D/H/M`. The `mac` overrides were removed (`Command+Shift+D` is also a browser shortcut); Mac is untested. Existing installs keep their old (unassigned) bindings, since Chrome applies suggestions only on install.
- **`scripting` permission** — previously unused, now used by the on-demand injection (E6, E15, E16). **`tabs`** — the popup now reads `tab.url` (file:// hint); reassess in Phase 3 with the other permissions.

## Fixes made in Phase 2

| Problem | Fix | Files |
|---|---|---|
| Badge stale after every save | `saveAnnotations` updates the badge (all saves go through it) | content.js |
| No shortcuts worked in Chrome | New defaults, verified assignable | manifest.json, content.js (hint), README |
| Sidebar shortcut could only open | `TOGGLE_SIDEBAR` message; commands via one `runCommand()` | background.js, content.js |
| Tabs open before install / during an update had no working DesignNote; popup showed "0" | `sendToTab()` injects selector.js + content.js + CSS via `chrome.scripting` when no receiver exists; the popup goes through it and explains pages it can't run on | background.js, popup.js, popup.html |
| Orphaned content script after an update failed silently (uncaught TypeError) | `extensionAlive()` guard on UI clicks shows "Refresh this page"; fresh injection replaces the stale root; SPA poll stops when orphaned | content.js |
| Host fixed header at max z-index covered the UI | `#designnote-root` is a fixed, zero-size stacking context at z-index 2147483647 (ties go to the later root) | content.css |
| UI unusable over a modal `<dialog>` (inert) | `placeRoot()` keeps the root inside the topmost open modal dialog | content.js |
| "Matched approximately" badge was added to the host `<body>` | Now inside `#designnote-root` | content.js |
| Screenshot capture failure was silent | Toast: "Annotation saved without a screenshot (reason)"; `lastError` read | content.js |

## Message / async audit (source + E8/E15/E18)

- background `onMessage`: every branch that answers asynchronously returns `true` and answers on both success and failure. Unknown message types are ignored.
- content `onMessage`: only `GET_ANNOTATION_COUNT` replies (async, `return true`). The others don't reply, and `chrome.tabs.sendMessage` then **resolves `undefined`** (checked in Chrome 155), so command sequences don't stop early.
- Service-worker restart: the worker keeps no in-memory state; storage holds everything. Capture after a forced stop works (E8).
- Remaining: provider responses that aren't JSON still surface a raw parse error (Phase 3, external integrations).

## Firefox risks to check when it is tested (source reading only)

- MV3 host permissions are opt-in in Firefox. Until the user grants site access the content script doesn't run, and the popup's "can't run on this page" text would be misleading there.
- `ClipboardItem` image copy needs Firefox 127+ (manifest minimum is 121).
- The Drive redirect URL differs (`*.extensions.allizom.org`); the settings page shows the right one.
- `chrome.scripting` / promise-returning `chrome.*` APIs: supported in Firefox MV3, but the injection fallback is untested there.
- `scrollIntoView({ behavior: 'instant' })` and `:modal` need reasonably recent Firefox (both are well within current releases).
- Shortcut conflicts for `Alt+Shift+D/H/M` in Firefox are unknown.

## Not covered (needs a human)

- **Real key presses** of the shortcuts (the DevTools protocol can't trigger browser accelerators; E18 calls the same handler directly).
- Clipboard, AI Enhance, Google Drive OAuth (Phase 3), opening exports in Excel/Sheets.
- Visual review in a headed window, light/dark, the new popup message.
- Real-world sites (React/Vue apps, heavy CSS frameworks, iframes, shadow DOM).
- A host modal `<dialog>` that centres itself with `transform` (our fixed UI would be positioned inside it; ponytail note in `placeRoot`).

## Repeatable release check

Run from the extension folder before any release candidate (≈ 3 minutes, no installs):

```sh
for f in *.js tests/*.js tests/lib/*.js; do node --check "$f"; done
node tests/selector-fingerprint.test.js
node tests/content-helpers.test.js
node tests/browser-smoke.js        # Chrome
node tests/browser-env.js          # Chrome
CHROME_PATH="C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" node tests/browser-smoke.js
CHROME_PATH="C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" node tests/browser-env.js
node tests/browser-privacy.js      # Chrome, offline (Phase 3)
CHROME_PATH="C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" node tests/browser-privacy.js
node tests/browser-a11y.js         # Chrome, keyboard/contrast/motion/zoom (Phase 4)
node tests/browser-annotation-ui.js  # Chrome, annotation UI v2: composer, sidebar actions, table, surfaces
node tests/browser-bridge.js       # Chrome, AI agent bridge (Send menu on the note)
CHROME_PATH="C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" node tests/browser-a11y.js
```

All must pass. Then do the human checks in TEST_PLAN §3 (S10 copy, S11 open xlsx, S14) and press each shortcut once in a normal Chrome window. Record the browser versions and results in EXECUTION_LOG.

Known test flakes: (1) Phase 2: one Chrome smoke run in ten had a single unidentified failure. (2) Phase 3: one Edge smoke run in four timed out (15 s) evaluating the C19 jump; it did not reproduce in 3 re-runs, where C18/C19 passed in about 815 ms. In Phase 3 the smoke and privacy suites stopped using fixed sleeps for saves and outbound calls; the first save in a cold browser can take 2–6 s. If a run fails once, re-run before investigating, and log it either way.

**Phase 3 permission change:** `activeTab` and `tabs` were removed. All three suites pass without them in Chrome 155 and Edge 156, including screenshot capture (C6, E8).
