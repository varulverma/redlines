# DesignNote — Test Plan

_Created 2026-10-17 (Phase 0). Record every run in `docs/roadmap/EXECUTION_LOG.md` with the date, browser + version, result, and what was **not** run._

## 1. Checks available today (no browser, no dependencies)

Run from the extension folder. Node is available on the dev machine (v24).

```sh
for f in *.js; do node --check "$f" && echo "OK $f"; done          # JS syntax
node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8'));console.log('manifest OK')"
node -e "const m=require('./manifest.json');if(m.content_scripts[0].js.join()!=='selector.js,content.js')throw 'script order';console.log('order OK')"
```

These prove syntax and load order only. They do **not** prove the extension works.

Added in Phase 1 (dependency-free, Node only):

```sh
node tests/selector-fingerprint.test.js   # fingerprint fallback: right element, no blow-up
node tests/content-helpers.test.js        # CSV quoting + formula guard, XML escape, categories
node tests/browser-smoke.js [extDir]      # real Chrome: 22 UI checks on local fixtures (HEADED=1 to watch)
node tests/browser-env.js [extDir]        # real Chrome: 18 environment checks (popup, shortcuts, reload, SW, SPA, theme, viewport, host CSS, dialogs)
```

Set `CHROME_PATH` to run either browser script in Edge or another Chromium build. The full release check is in `BROWSER_COMPATIBILITY.md`.

`browser-smoke.js` loads the unpacked extension into desktop Chrome via `--remote-debugging-pipe` + `--enable-unsafe-extension-debugging` + `Extensions.loadUnpacked`. This works on branded Chrome, where `--load-extension` is ignored. It uses a throw-away profile and a local HTTP server, and records any request leaving the machine. Pass a different folder to compare builds. Results are in `PHASE_1_RESULTS.md`.

Still manual: clipboard, Enhance, Drive, opening exports in Excel/Sheets, visuals.

## 2. Loading the extension (human-run)

1. `chrome://extensions` → Developer mode → **Load unpacked** → select the Redlines folder (the one with `manifest.json`).
2. Record the Chrome version (`chrome://version`) and the extension ID.
3. Details → enable **Allow access to file URLs** (for the fixture page).
4. After any code change: reload the card **and** reload the test tab.

Automation note: recent branded Chrome no longer honours `--load-extension` (INF, verify). For scripted runs use Chrome for Testing or Chromium. Don't record a result as "Chrome tested" unless the real extension was loaded.

## 3. Baseline smoke test (run before and after every phase)

Fresh profile, test page = fixture page plus one real site (e.g. a docs page with a sticky header).

| # | Step | Expected | Pass/Fail |
|---|---|---|---|
| S1 | Load unpacked | No errors on the card; the service worker is "active" or inspectable | |
| S2 | Open test page | Pill at the right edge, no layout shift, no console errors from the extension | |
| S3 | Click target icon | Mark mode: custom cursor, hover box with tag label | |
| S4 | Click an element | Form opens near the click; focus is in a field | |
| S5 | Enter category "Bug" + note, Save | Toast "Annotation saved"; badge = 1 | |
| S6 | Open sidebar | Card shows category, note, screenshot of **the clicked element**; pin "1" on the element | |
| S7 | Reload page, open sidebar | Note still there | |
| S8 | Click card | Page scrolls to the element and highlights it | |
| S9 | Edit → change text, Save | Text updated, category unchanged (**expected to FAIL today, R2**) | |
| S10 | Copy as JSON → paste in an editor | Valid JSON with type/text/selector/url | |
| S11 | Table view → Export → Excel | File opens in Excel/LibreOffice/Google Sheets with the image embedded | |
| S12 | Export HTML | Opens offline; note text is shown literally (no injected markup) | |
| S13 | Delete the note | Card gone, badge hidden, gone after reload | |
| S14 | Close sidebar / hide pill | Page looks and behaves as before; `Ctrl+Shift+P` brings the pill back | |
| S15 | DevTools → Network during S3–S13 | **No extension network requests** | |

## 4. Phase 1 test areas

### 4a. Annotation lifecycle
- Create, with element and without (sidebar `+`); categories: none yet / existing / new by Enter / new typed but not confirmed.
- Legacy types (`bug` etc. seeded via storage) **and** custom categories, edited separately.
- Edit keeps `id`, `selector`, `fingerprint`, `rect`, `screenshot`; check what happens to `timestamp` (currently overwritten).
- Cancel / ✕ / Escape / outside click on both forms; empty text; empty category; double-click Save; very long text; text with `' " < > & 😀` and line breaks.
- Delete from sidebar, from the table (This page), from the table (All pages, a row from another page: R5).
- Copy JSON / Copy image succeed → "Copied" badge; deny clipboard permission → no badge plus a visible error.
- Escape in Mark mode (R8).

### 4b. Export matrix
For **each** format × {This page, All pages} × {opened from sidebar, opened from table} × {0 notes, 1 note, 3 notes on 2 pages including a custom category with a comma}:
- The set of notes exported is exactly the one the UI shows.
- Every row identifies its page (full URL for all-pages).
- Screenshots are present/embedded as the format promises.
- The file opens in its target app: xlsx (Excel / Sheets / LibreOffice), CSV (Excel + Sheets: commas, quotes, newlines, a leading `=`), HTML (offline, escaped), JSON/XML (parse), ZIP (extracts, report opens), "PDF" (what actually happens).
- Numbering matches the sidebar and pins, or the difference is documented.
- A large set (≥100 notes with screenshots) finishes without freezing and gives feedback.

### 4c. Selector / fingerprint (fixture page)
Stable `id`; `data-testid`; duplicate classes; no stable attributes; repeated cards; element hidden later; element removed; element moved by a DOM update; long scroll; sticky header; open dropdown (use `Alt+Shift+M`); modal; iframe and shadow-DOM content (record as unsupported if it fails).
For each: the jump highlights the **intended** element or gives understandable "not found" feedback, never a wrong element, **and the tab stays responsive** (R1 stress case: a selector broken on a page with ≥500 elements).

### 4d. Storage and URL keying
Notes survive reload, tab close/reopen, browser restart, extension reload. URL variants: `#frag`, `?q=1`, trailing slash, hash-router SPA, pushState SPA (600 ms poll). 50+ notes with screenshots: check storage size (`chrome.storage.local.getBytesInUse`). Simulate a save failure if feasible. **Back up storage before any migration test** (DevTools console in the extension's service worker: `chrome.storage.local.get(null)`).

### 4e. Screenshots
Element fully visible; partly off-screen; taller than the viewport with "Capture full element"; scroll while typing before Save (R6); HiDPI (125%/150% zoom); the pill overlapping the element.

## 5. Later phases (outline)

- **Phase 2:** install/reload, popup on restricted pages, options page, each shortcut (including conflicts), background message error paths, service worker idle → wake, Firefox load (if D6 = include).
- **Phase 3:** network capture for each external action; key/token storage; Drive connect / silent check / disconnect / revoked token; injection payloads in every renderer and exporter.
- **Phase 4:** keyboard-only pass, focus visibility and return, Escape consistency, contrast in both themes, 200% zoom, 360 px viewport, reduced motion, no-backdrop-filter fallback, screen reader names for icon buttons.
  **Automated (2026-10-18):** `tests/browser-a11y.js`, 24 checks (K1–K9 keyboard/Escape/focus return, N1–N4 names/states/dialogs, F1 focus rings, T1 type labels, E1 empty state, S1 selector loss, M1 reduced motion, C1–C4 contrast in both themes over light and dark pages, Z1–Z2 200% and 320 px). Still manual: screen reader, real browser zoom, forced-colors mode, visual review. See `docs/ux/UX_AUDIT.md`.

## 6. Evidence format

For every test record: date, tester, browser + version, OS, extension build (file timestamps or package hash), steps, expected, actual, Pass/Fail/Blocked, and a screenshot or exported file for failures. Mark anything not run as **Not run** with a reason. Never leave it blank or count it as passed.
