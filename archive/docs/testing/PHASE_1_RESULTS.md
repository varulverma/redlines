# Phase 1 Results — Correctness and data integrity

_Run 2026-10-17. Chrome 155.0.8059.84 (headless, Windows 11). The owner approved Phase 1 with the proposed defaults for D1–D4 (see PRODUCT_BRIEF)._

## How it was tested

| Check | What it is | Run |
|---|---|---|
| `node tests/selector-fingerprint.test.js` | Real `selector.js` on a fake DOM; broken selector → fingerprint fallback; asserts the correct element and < 2 s on 2,002 elements | PASS (12 ms) |
| `node tests/content-helpers.test.js` | Real `csvCell`, `xmlEscape`, `normalizeCategory` extracted from `content.js` | PASS |
| `node tests/browser-smoke.js` | **The real extension** loaded into Chrome via `Extensions.loadUnpacked` over `--remote-debugging-pipe`, driving the in-page UI on two local fixture pages (real mouse/keyboard events for picking and Escape) | **22/22 PASS** on the fixed build |
| Same smoke script on a copy of the **pre-Phase-1** files | Baseline reproduction of the reported defects | 6/21 PASS (the failures below are the reproduced bugs) |
| Downloaded `.xlsx` → `Expand-Archive` + strict `[xml]` parse of every part | Structure of a real export | PASS (all parts parse, 3 embedded PNGs) |
| `node --check` on every `.js`; manifest parse + `selector.js` before `content.js` | Syntax / load order | PASS |

## Before → after (real Chrome)

| ID | Check | Before | After | Risk |
|---|---|---|---|---|
| C3 | Create form offers the 4 preset types | FAIL (none) | PASS | D1 |
| C4 | Typing "Bug" stores preset `bug` | FAIL (stored "Bug") | PASS | R4 |
| C6 | Screenshot shows the clicked element after scrolling while typing | FAIL (white area cropped) | PASS (magenta, 200×120) | R6 |
| C7 | Stored rect = element's document position | FAIL (off by 600 px) | PASS | R6 (new finding) |
| C8 | Escape exits Mark mode | FAIL | PASS | R8 |
| C9/C10 | Edit a custom-category note: preselects category, saves text, keeps category and original timestamp | FAIL (nothing selected, save silently did nothing) | PASS | R2, D3 |
| C11 | Sidebar Excel = this page only after the table was left on All pages | FAIL (4 rows vs 3) | PASS (+ "This page" heading, scope in filename) | R3 |
| C12b | Export menu reopens after picking an item | FAIL (needed two clicks) | PASS | **new bug found in Phase 1** |
| C13 | All-pages CSV: every note with its full page URL | FAIL (hostname only) | PASS | R3 |
| C14 | CSV neutralises `=HYPERLINK(...)` | FAIL | PASS | R9 |
| C15 | Bug filter matches `bug` and legacy `Bug` | FAIL (0 rows) | PASS (2) | R4 |
| C16/C17 | Delete another page's note from All pages; Undo restores it | FAIL (no-op, no undo) | PASS | R5, D4 |
| C18 | Sidebar opens on a page where selectors broke (300 cards re-parented) | **FAIL: tab unresponsive > 20 s** | PASS (opens immediately) | **R1** |
| C19 | Jump finds the moved element by fingerprint | not reached (frozen) | PASS (correct "Card 149") | R1 |
| C12 | HTML export escapes `<b>` in note text | PASS | PASS | — |
| C20 | No requests leave the machine during capture/save/export | PASS | PASS | offline-first |

## Changes made

| File | Change |
|---|---|
| `selector.js` | `findByFingerprint` resolves the parent fingerprint once per level instead of once per candidate. Same results, linear instead of exponential cost. Removed the unused `maxDepth` parameter. |
| `content.js` | **Categories:** 4 presets are always offered; custom names matching a preset (any case) map to it; the edit form offers the same categories with the note's own preselected and keeps its stored spelling; filter chips ignore case. |
| | **Export scope:** every exporter takes an explicit `scope`. The sidebar passes `current`; the table passes its visible toggle (HTML included). Menus show a scope heading (and "search/filter not applied" when relevant). File names carry `current-page`/`all-pages`. Every format carries a per-note page URL; CSV/XLSX use the full URL instead of the hostname. |
| | **CSV:** every cell quoted (RFC 4180) plus a formula-injection guard. |
| | **PDF:** label "PDF (print-ready page)", file `…-print.html` (no longer collides with the HTML export), and an accurate toast. |
| | **Delete:** works for any page's note; Undo toast for 6 s; storage errors reported. |
| | **Edit:** keeps `timestamp`, adds `updatedAt`. |
| | **Screenshots:** the click position is stored in document coordinates at click time; the crop is measured at capture time, scrolling the element back into view if needed and clipping to the viewport. The broken "Capture full element" stitching and its checkbox were removed (it only ever stitched from one viewport image). |
| | **Escape** exits Mark mode. **Clipboard** failures for Copy JSON and Enhance now show a message. **Action menus** reset their open state on every close path. |
| `content.css` | Styles for the menu scope heading and the toast action; removed the dead capture-checkbox styles. |
| `tests/*` | New: 2 unit checks + 1 real-browser smoke script (no dependencies). |
| README, CLAUDE.md, AGENTS.md | Data model, categories, export scope, tests, limitations. |

`background.js` and `manifest.json` were **not changed**. The stored data shape only gained the optional `updatedAt`; existing notes, legacy capitalised types and notes without a fingerprint load and filter correctly (C15 used a seeded legacy note).

## Not tested (and why)

- **Clipboard** (Copy JSON / Copy image / "Copied" badge / Enhance copy): headless clipboard permissions weren't set up. The new failure toasts are verified by source only. Needs a manual check.
- **AI Enhance and Google Drive**: deliberately not exercised (no keys or OAuth in tests; Phase 3).
- **Opening exports in Excel / Google Sheets / LibreOffice**: only structure was validated (zip + XML parse, CSV content). A human should open one of each.
- **Visual appearance** (new menu heading, Undo toast, edit-form pills in light/dark): not screenshotted. Needs a quick manual look.
- **Firefox, Edge, other Chromium browsers**: not tested.
- **Elements taller than the viewport** (now cropped to the visible part): not tested in the browser.
- **Real-world sites** (SPAs, sticky headers, aggressive CSS): only local fixtures were used.

## Remaining risks (carried to later phases)

- R7 numbering differs between pins/sidebar (oldest = 1) and table/exports. Not changed: a product decision, low data risk.
- Escape still doesn't close the sidebar, table view or menus (Phase 4).
- Enhance shows a raw parse error for non-JSON provider responses (Phase 3).
- PDF summary counts and Notion/Linear/Jira type mapping ignore custom categories (cosmetic).
- CSV has no UTF-8 BOM. Excel may show non-ASCII text (emoji, accents) garbled. Untested.
- R13–R18 unchanged (see FEATURE_INVENTORY).
- The fingerprint can still pick a wrong element with identical text (R13).

## Recommendation

**GO for Phase 2**, conditional on a 5-minute human pass in your normal Chrome profile: TEST_PLAN §3 steps S10 (copy), S11 (open the xlsx in Excel/Sheets) and S14, plus a look at the Undo toast and export menu heading in light and dark mode.
