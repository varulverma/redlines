# DesignNote — Feature Inventory & Baseline

_Baseline taken 2026-10-17 against the files in this folder (no git; the source is the only record)._

**Evidence labels**

| Label | Meaning |
|---|---|
| **SRC** | Confirmed by reading current source |
| **HAR** | Reproduced in a Node harness (no browser) |
| **INF** | Inferred / likely |
| **BRW** | Needs real-browser testing |
| **USR** | Needs user research |

**No item in this file has been verified in a real browser.**

## 1. Runtime files

| File | Lines | Role |
|---|---|---|
| `manifest.json` | — | MV3. Content scripts `selector.js` → `content.js` (order correct, SRC). CSS `design-tokens.css` → `content.css`. |
| `selector.js` | 165 | `__designNoteGetSelector`, `__designNoteGetSelectorWithFingerprint`, `__designNoteFindElement` |
| `content.js` | 2638 | All in-page UI and logic (IIFE): pill, Mark mode, create/edit forms, sidebar, pins, table view, all exporters, clipboard, categories, SPA polling |
| `content.css` | 1147 | In-page styles. `all: revert` reset under `#designnote-root` |
| `design-tokens.css` | 168 | `--dn-*` tokens on `:root, #designnote-root`, light and dark |
| `background.js` | 263 | Screenshot capture, AI Enhance, Drive OAuth/upload/check/disconnect, keyboard commands |
| `popup.html/js` | 58/25 | Count for this page, Open sidebar, Settings |
| `settings.html/js` | 143/79 | AI provider + key, Drive client ID, connect/disconnect |
| `theme.css` | 11 | Imports tokens for popup/settings |
| `design-system.html` | 424 | Design-system reference page. Not used at runtime; exclude from the release package. |
| `tools/generate-icons.ps1` | — | Dev tool. Exclude from the package. |

Non-runtime folders that must not ship: `.superpowers/` (snapshots, diffs, reports), `.claude/`, `docs/`.

## 2. User-visible features

| Feature | Where | Status |
|---|---|---|
| Floating pill: drag (mouse and keyboard), snap to edge, hide | content.js 234–401 | SRC; BRW |
| Mark mode: custom cursor and hover highlight box | 2039–2137 | SRC; BRW. **Escape does not exit Mark mode** (SRC) |
| Create form: free-text categories (page and domain remembered), "Capture full element" checkbox | 2223–2389 | SRC; BRW |
| General note with no element (sidebar `+`) | 483 | SRC |
| Sidebar: cards (newest first, numbered chronologically), compact rail (default on, remembered) | 403–437, 1564 | SRC |
| Page pins (numbered markers while the sidebar is open) | 439–480 | SRC |
| Jump to element: selector, then fingerprint ("⚠ Matched approximately"), then stored rect | 1993–2037 | SRC; badge attached to `document.body`, outside `#designnote-root` |
| Edit (type and text) | 1791–1905 | SRC. **Only offers the 4 legacy types**; see R2 |
| Delete (no confirm, no undo) | 1781 | SRC |
| Copy as JSON / Copy image (sets a persistent "Copied" badge) | 1907–1963 | SRC; BRW (clipboard permissions) |
| Enhance (AI) copies the rewritten prompt to the clipboard | 1965 | SRC; BRW |
| Table view: This page / All pages (grouped by domain), search, 4 type filter chips, resizable columns | 498–789 | SRC |
| Exports: see section 5 | — | SRC; BRW |
| SPA route detection (600 ms URL poll) | 2612–2631 | SRC |
| Toolbar popup count, open sidebar, settings | popup.* | SRC |
| Commands: `Ctrl+Shift+D` sidebar (opens only, never closes), `Ctrl+Shift+P` pill, `Ctrl+Shift+M` Mark | manifest, background.js | SRC; BRW (conflicts with browser shortcuts) |
| Light and dark theme, reduced motion, `backdrop-filter` fallback | content.css | SRC; BRW |

## 3. Data model (`chrome.storage.local`)

| Key | Shape | Notes |
|---|---|---|
| `dn_annotations::<href without #fragment>` | `Annotation[]` in creation order | Query string included; trailing slash significant; hash routes collapse into one key (SRC) |
| `dn_custom_categories` | `{ page: {url: string[]}, domain: {"example.com": string[]} }` | "Domain" = last two hostname labels (wrong for `co.uk`, INF) |
| `dn_pill_state` | `{ position, orientation, closed, dock }` | Global across all sites |
| `dn_sidebar_compact` | boolean | |
| `dn_provider`, `dn_api_key` | string | **Plain text**, not encrypted (SRC). The Settings copy does not claim encryption (OK). |
| `dn_drive_client_id` | string | |
| `dn_drive_token` | `{ access_token, expiry }` | Plain text, ~1 h, implicit flow, no refresh token |
| page `localStorage` `dn-col-widths-<mode>` | string[] | **Written into the host page's localStorage** (SRC); a small leak onto the host origin |

**Annotation:** `{ id, type, text, selector, fingerprint, rect, screenshot, timestamp, copiedAt? }`

- `type` is **either** a legacy value (`text|suggestion|bug|note`) **or** any free-text category string the user typed (e.g. `"Layout"`, `"Bug"`). They share one field. The README, CLAUDE.md and AGENTS.md still describe only the 4 values (stale).
- `fingerprint` is a recursive `{tag, textHash, siblingIndex, parent}` chain up to `<html>`.
- `rect` is in document coordinates at click time.
- `screenshot` is a PNG data URL at device-pixel resolution, or `null`.
- `timestamp` is overwritten on edit (SRC).
- `pageUrl` is not stored; it is derived from the storage key when loading all pages.

## 4. Message and network flows

| From → To | Message | Network? |
|---|---|---|
| content → background | `CAPTURE_SCREENSHOT` → `tabs.captureVisibleTab` | No |
| content → background | `ENHANCE_PROMPT` {type label, text, selector, **full page URL incl. query string**} | **Yes**: `api.anthropic.com` / `api.openai.com` / `openrouter.ai`, key in a header. Hard-coded models `claude-sonnet-4-6`, `gpt-4o-mini`, `anthropic/claude-sonnet-4.5` (may go stale) |
| content → background | `UPLOAD_TO_DRIVE` {xlsx base64 incl. screenshots} | **Yes**: `googleapis.com/upload/drive/v3`, plus `accounts.google.com` auth |
| settings → background | `CHECK_DRIVE` (silent check **on every Settings page load**) | **Yes, if a client ID is set**: silent auth + `drive/v3/about` |
| settings → background | `DISCONNECT_DRIVE` | **Yes**: `oauth2.googleapis.com/revoke` |
| popup/background → content | `TOGGLE_SIDEBAR_OPEN`, `SHOW_PILL`, `TOGGLE_PILL`, `TOGGLE_MARK_MODE`, `GET_ANNOTATION_COUNT` | No |

`content.js`, `selector.js` and `popup.js` contain no `fetch`/XHR (SRC). There is no `console.*` logging anywhere, so keys are never logged (SRC).

## 5. Export matrix (source reading)

`tableViewMode` is set only by the table's This page / All pages toggle and is **never reset**. Sidebar exports therefore inherit whatever the table was last set to.

| Format | Entry points | Scope | Page info per row | Screenshots | Row order / numbering |
|---|---|---|---|---|---|
| Excel `.xlsx` | sidebar + table | `tableViewMode` | hostname only | embedded | list order (current: oldest first; all: newest first) |
| HTML | sidebar + table | **always current page** | n/a | inline data URLs | newest first |
| CSV | table | `tableViewMode` | hostname only | Yes/No flag | reversed list |
| "PDF" | table | `tableViewMode` | hostname | inline | grouped by domain / newest first. **Downloads an .html file that auto-prints when opened** |
| ZIP | table | `tableViewMode` | full `pageUrl` in JSON | `screenshots/*.png` + report.html | list order |
| Drive | sidebar + table | `tableViewMode` | as xlsx | embedded | as xlsx |
| Copy Markdown / JSON / XML | table | `tableViewMode` | **none per item**; header shows the *current* URL even for all pages | flag only | list order |
| Copy Notion | table | `tableViewMode` | none per item | flag | list order |
| Copy Linear / Jira | table | `tableViewMode` | full `pageUrl` | flag | list order |
| Copy single (JSON) | card/row | one item | current URL | — | — |

Escaping: HTML uses `escapeHtml` (textContent → innerHTML); XML/XLSX use `xmlEscape`; JSON uses `JSON.stringify` (SRC, all OK). CSV quotes Note and Selector but **not Type** (free-text categories) and has **no formula-injection guard** (SRC). Markdown/Notion/Linear/Jira insert raw text (formatting can break, not a security issue).

## 6. Permissions (observed use)

| Permission | Used for | Observation |
|---|---|---|
| `storage` | everything | needed |
| `unlimitedStorage` | screenshots | justified |
| `<all_urls>` host | content script on every page, `captureVisibleTab` | needed for the current design; Phase 3 should justify it in plain language |
| `identity` | Drive OAuth | needed only if Drive stays |
| `activeTab` | — | likely redundant given `<all_urls>` (INF) |
| `tabs` | — | no `tab.url`/`title` read; `query`/`sendMessage`/`captureVisibleTab` don't need it (INF) |
| `scripting` | — | **no `chrome.scripting` call anywhere** (SRC) |

Do not remove any of these before Phase 3 verifies it in a browser.

## 7. Prior docs reconciled with current code

| Claim (source) | Verdict |
|---|---|
| "Colored type pills Text / Suggestion / Bug / Note" in the create form (README) | **Contradicted.** The form shows only categories already used on this page/domain; new users get a free-text box. |
| Data model `{id,type,text,selector,rect,screenshot,timestamp}` (README, CLAUDE.md, AGENTS.md) | **Stale.** Missing `fingerprint` and `copiedAt`; `type` can be any string. |
| "Export the current page's annotations" (README) | **Contradicted for most formats.** Scope follows the table toggle; only HTML is always current page. |
| README export list (xlsx, HTML, Drive, copy MD/JSON/XML) | **Incomplete.** CSV, PDF, ZIP, Notion/Linear/Jira, All-pages view, search, filters, edit, full-element capture, shortcuts, pill drag/hide are undocumented. |
| "Five JS files"; message flow lists 2 + 2 types (CLAUDE.md, AGENTS.md) | **Stale.** 5 background message types, 5 content message types. |
| Selector "could use structural fingerprints" as future work (README) | **Stale.** A fingerprint fallback exists, and it has a severe performance bug (R1). |
| "Screenshots only cover the viewport; scroll-and-stitch is v2" (README) | **Partly stale.** A stitch path exists but stitches from a single capture (R6). |
| Table view / HTML export "current page only, no aggregation" (2026-07-21 spec) | **Superseded.** An All-pages mode was added later without updating the spec. HTML still follows the spec. |
| progress.md: "Copy all: three icons in table header", "spreadsheet icon in both headers" | **Stale UI description.** Now dropdown menus; the function still exists. |
| progress.md: Chrome "silently refuses `--load-extension` … looks like an enterprise policy" | **Likely misdiagnosed (INF).** Recent branded Chrome releases dropped support for the `--load-extension` switch. Use Load unpacked by hand, or Chrome for Testing / Chromium for automation. Verify in Phase 2. |
| progress.md: `:where()` reset and SVG exemption fixed the invisible styles/icons | Consistent with current `content.css` (SRC); visual result is BRW. |
| Settings copy: key "never sent anywhere except directly to your chosen provider's API" | **Confirmed** by source. |
| README: Drive scope `drive.file`, token ~1 h cached locally | **Confirmed** by source. |
| README: Firefox/Zen 121+ supported | **Unverified** (BRW). |

## 8. Risk register (ranked by user harm × likelihood)

> **Phase 1 update (2026-10-17):** R1, R2, R3, R4, R5, R6, R8, R9 and R10 are **fixed and verified in real Chrome 155**. The "Escape for sidebar/table/menus" part of R8 is still open. Also fixed: the clipboard toasts from R11 and the label/toast from R12. A new bug (the export menu needed two clicks to reopen) was found and fixed. Details are in `docs/testing/PHASE_1_RESULTS.md`. Sections 2–7 above describe the Phase 0 baseline.
>
> **Phase 2 update (2026-10-18):** R17 (popup "0") and R18 (shortcuts: Chrome assigned none) are **fixed and verified in Chrome 155 and Edge 156**. From R14, the jump badge is now inside the root. R16: `scripting` is now used. New problems found and fixed: the badge never updated after a save; extension updates left tabs silently broken; host max-z headers covered the UI; modal dialogs made the UI unusable. See `docs/testing/BROWSER_COMPATIBILITY.md`. Still open: R7, R11 (provider errors), R13, R14 (tokens on the host `:root`, column widths in the host page's localStorage), R15, the rest of R16, and Escape for sidebar/table/menus.
>
> **Phase 3 update (2026-10-18):** R11 is fixed (readable provider errors), the localStorage part of R14 is fixed, and R16 is fixed (`activeTab`, `tabs` removed). New findings, fixed and verified (`tests/browser-privacy.js`, Chrome + Edge): attribute injection through category names (`escapeHtml` didn't escape quotes); Enhance sent the full URL including query string; no consent before the first Enhance or Drive send; opening Settings contacted Google; page scripts could trigger Enhance/Drive with `.click()`. Section 4's flows are superseded by `docs/product/PRIVACY_AND_PERMISSIONS.md`. Still open: R7, R13, R14 (tokens on host `:root`), R15, Escape for panels, and the D9 decision on shadow DOM.

> **Phase 4 update (2026-10-18):** R8 is **fixed** (Escape for Mark mode, sidebar, table and menus; the form listener leak). Also fixed and verified with `tests/browser-a11y.js` in Chrome 155 and Edge 156: focus return on every close, keyboard "go to element" on cards, `aria-pressed`/`aria-expanded` states, labelled dialogs, a silent selector-loss jump, the off-centre edit form (off screen under ~760 px), reduced motion, and text contrast in both themes over light and dark host pages (token changes). See `docs/ux/UX_AUDIT.md`. Still open: R7, R13, R14 (tokens on host `:root`), R15, D9.

| ID | Sev | Finding | Evidence |
|---|---|---|---|
| R1 | **P0** | `findByFingerprint` recurses through every ancestor and rescans all candidates at each level (`maxDepth` is never checked), so cost is exponential. It runs for every note whose selector no longer matches, on sidebar open (pins) and on jump. **It can freeze the tab** on ordinary dynamic pages. | HAR: fake DOM with 42 elements took 549k `querySelectorAll` calls / 4.2 s; 82 elements did not finish in 60 s |
| R2 | **P0** | **Editing a note with a custom category is broken.** No pill is pre-selected, so Save throws a TypeError (nothing saved, no message). Picking a pill instead replaces the custom category with a legacy type. Since new notes are always custom categories, this hits most notes. | SRC (`content.js` 1875) |
| R3 | **P0** | Export scope mismatch. Sidebar xlsx/Drive silently export **all pages** if the table was last left on All pages. HTML ignores the toggle. Copy MD/JSON/XML for all pages labels everything with the current URL and drops per-item page. | SRC |
| R4 | P1 | Type filter chips match only the exact lowercase legacy values, so a user category "Bug" doesn't match the Bug chip and custom categories have no filter. A user category "Bug" also *displays* as "Layout Bug" (`typeLabel` lowercases). | SRC |
| R5 | P1 | Table "All pages" shows an enabled Delete on other-page rows, but it does nothing (only the current page's list is filtered). No feedback. | SRC |
| R6 | P1 | Screenshot taken at **save** time but cropped with the rect from **click** time. Scrolling while typing gives the wrong crop. "Capture full element" stitching reuses one viewport image, so tall elements come out wrong. | SRC; BRW to confirm visually |
| R7 | P1 | Numbering differs between surfaces: pins and sidebar count oldest = 1, single-page table counts newest = 1, exports vary. "#3" means different notes in different places. | SRC |
| R8 | P1 | No Escape to leave Mark mode, close the sidebar, close the table or close menus. The edit/create Escape listeners are never removed after Save/Cancel (harmless leak). | SRC |
| R9 | P1 | CSV: Type column unquoted (a comma in a category breaks columns); no `=`/`+`/`-`/`@` formula guard. | SRC |
| R10 | P1 | Delete has no confirm and no undo; edit overwrites the creation timestamp. | SRC (product decisions D3/D4) |
| R11 | P1 | Enhance: non-JSON provider errors show a raw parse error. The clipboard write after the async round trip has no failure handler, so the result can be lost silently. Single "Copy as JSON" also has no failure toast (it correctly does not mark Copied). | SRC; BRW |
| R12 | P2 | "PDF" export downloads auto-printing HTML while the toast says "Opening print dialog". | SRC |
| R13 | P2 | Fingerprint match threshold (score ≥ 3) means a matching text hash alone is enough, so it can highlight the wrong element with the same text. | INF; BRW |
| R14 | P2 | Style leakage: 175 of 176 `content.css` rules are not prefixed with `#designnote-root` (they use `dn-` classes, so collision risk is low). Tokens are declared on the host `:root`; the jump badge goes into `document.body`; column widths go into the host page's localStorage. | SRC |
| R15 | P2 | `loadAllAnnotations` reads **all** storage, every screenshot included, on each table render and search keystroke in All-pages mode, so it gets slow as data grows. | SRC; BRW |
| R16 | P2 | Unused or likely unneeded permissions (`scripting`, probably `tabs`, `activeTab`). | SRC/INF |
| R17 | P2 | Popup shows "0" on pages where the content script can't run (chrome://, Web Store, pages opened before install) instead of "unavailable". | SRC |
| R18 | P2 | Shortcut conflicts: `Ctrl+Shift+D` (bookmark all tabs), `Ctrl+Shift+M` (profile menu in Chrome / responsive mode in Firefox), `Ctrl+Shift+P` (Firefox private window). | BRW |
| R19 | P2 | Docs (README / CLAUDE.md / AGENTS.md) are stale on the data model, exports and message types. | SRC |
