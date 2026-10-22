# DesignNote — Execution Log

One entry per phase or work session. There is no git repo, so this file is the change history.
Earlier work (July–Aug 2026) is in `.superpowers/sdd/progress.md`.

---

## 2026-10-17 — Phase 0: Baseline and scope lock

**Goal:** inventory the current product, reconcile prior notes, write the test plan. No runtime changes.

**Read:** CLAUDE.md, AGENTS.md, README.md, manifest.json, background.js, content.js (all 2638 lines), selector.js, popup.*, settings.*, theme.css, design-tokens.css (scope only), content.css (scope, theming and motion rules), docs/superpowers/ (both specs and plans, headings + goals), .superpowers/sdd/progress.md, and the roadmap bundle in the parent folder.

**Files created (documentation only):**
- `docs/product/PRODUCT_BRIEF.md`
- `docs/product/FEATURE_INVENTORY.md` (inventory, data model, flows, export matrix, permissions, doc reconciliation, risk register)
- `docs/testing/TEST_PLAN.md`
- `docs/roadmap/EXECUTION_LOG.md` (this file)

**Runtime files changed:** none.

**Checks run:**

| Command | Result |
|---|---|
| `node --check` on background.js, content.js, popup.js, selector.js, settings.js | PASS (all 5) |
| `manifest.json` JSON parse + `content_scripts[0].js == selector.js,content.js` | PASS |
| Fingerprint harness: the real `selector.js` evaluated in Node against a fake DOM, selector deliberately broken, `__designNoteFindElement` timed (script kept in the session scratchpad, not in the repo) | **FAIL (perf)**: 42 elements → 549,311 `querySelectorAll` calls, 4.2 s; 82 elements → did not finish in 60 s. Confirms risk R1. |
| Grep audit: `fetch` / `console.*` / `chrome.*` API usage / Escape handlers / CSS scope | Recorded in FEATURE_INVENTORY §4, §6, §8 |

**Not run, and why:**
- No real-browser testing of any kind. The extension was not loaded in Chrome, Edge or Firefox in this session, so every UI, clipboard, screenshot, export-file-opens, Drive and AI claim remains **unverified**.
- No network capture. "No network calls during capture/save" is based on source reading only.
- No user research.

**Remaining risks:** see the FEATURE_INVENTORY risk register (P0: R1 fingerprint freeze, R2 edit breaks custom categories, R3 export scope mismatch).

**Recommendation:** GO for Phase 1 once the owner answers D1–D4 in the Product Brief, or accepts the proposed defaults.

---

## 2026-10-17 — Phase 1: Correctness and data integrity

**Approval:** the owner said "continue". D1–D4 were implemented with the proposed defaults.

**Method:** pre-change copies of the touched files were saved in the session scratchpad. Each defect was reproduced first (Node harness, then the same real-Chrome smoke script run against the pre-change copy), then fixed. The full content.js diff was reviewed afterwards.

**Runtime files changed:** `selector.js`, `content.js`, `content.css`. **Unchanged:** `background.js`, `manifest.json`, popup, settings.
**Other files:** `tests/selector-fingerprint.test.js`, `tests/content-helpers.test.js`, `tests/browser-smoke.js` (new); README.md, CLAUDE.md, AGENTS.md, docs/product/*, docs/testing/TEST_PLAN.md (updated); `docs/testing/PHASE_1_RESULTS.md` (new).

**Checks run:**

| Command | Result |
|---|---|
| `node --check` on all JS + tests; manifest parse + script order | PASS |
| `node tests/selector-fingerprint.test.js` | FAIL before (3.6 s on 42 elements); PASS after (12 ms on 2,002) |
| `node tests/content-helpers.test.js` | PASS |
| `node tests/browser-smoke.js` (Chrome 155, fixed build) | 22/22 PASS |
| `node tests/browser-smoke.js <pre-change copy>` | 6/21 PASS; reproduces R1 (tab frozen > 20 s), R2, R3, R4, R5, R6, R8, R9 and the menu bug |
| Downloaded xlsx: `Expand-Archive` + `[xml]` on every part | PASS |

**Test-tool notes:**
- The first smoke version silently failed to break selectors (its hash navigation didn't take), which made the old build look freeze-free. Fixed by adding precondition check C18a. Treat any future C18 pass as meaningful only alongside C18a.
- The fresh Chrome profile's component updater wrote a `Cr24` package (`downloads.htm`) into the test download folder. It is not DesignNote data.

**Not run:** clipboard, Enhance, Drive, opening exports in desktop spreadsheet apps, visual review, non-Chrome browsers, real-world sites. See PHASE_1_RESULTS "Not tested".

**Recommendation:** GO for Phase 2 after a short human pass (PHASE_1_RESULTS → Recommendation).

---

## 2026-10-17/18 — Phase 2: Browser compatibility and operational reliability

**Approval:** owner said "go". The Phase 1 human pass was not reported, so it is still pending. D6 (release browsers) was not answered; working assumption: Chrome first, Edge tested, Firefox "not yet verified".

**Method:** official docs (MDN background key; Chrome background/migration docs via search) for the manifest. A new `tests/browser-env.js` was run on the current code first to reproduce problems; a probe extension isolated the shortcut conflicts. Fixes followed, then everything was re-run in Chrome and Edge, and `browser-env.js` was also run on the original pre-Phase-1 copy for before/after.

**Runtime files changed:** `content.js`, `content.css`, `background.js`, `popup.js`, `popup.html`, `manifest.json` (commands only; semantic diff = `commands`). `selector.js`, `settings.*` unchanged.
**Other files:** `tests/lib/cdp.js` (new shared harness), `tests/browser-env.js` (new), `tests/browser-smoke.js` (moved onto the harness, names failed checks), README, CLAUDE.md, AGENTS.md, `docs/testing/BROWSER_COMPATIBILITY.md` (new), TEST_PLAN, FEATURE_INVENTORY, PRODUCT_BRIEF.

**Checks run (final):**

| Command | Chrome 155 | Edge 156 |
|---|---|---|
| `node --check` all JS; manifest parse + script order | PASS | — |
| `tests/selector-fingerprint.test.js`, `tests/content-helpers.test.js` | PASS | — |
| `tests/browser-smoke.js` | 22/22 | 22/22 |
| `tests/browser-env.js` | 18/18 | 18/18 |
| `tests/browser-env.js` on the original code | 8/17 (E3, E6, E9, E13, E14, E15, E16 real; E4/E8 not comparable) | — |

**Test-tool notes:** `msedge --version` on Windows launches the browser (no stray process was left). `chrome.runtime.reload()` removes a pipe-loaded extension, so E15 simulates an update by re-running `Extensions.loadUnpacked` on the same folder. Two first-draft probes were wrong (E13 measured a hidden button mid-animation; E11 measured mid-slide) and were corrected before being trusted. One unexplained single-check failure in about 10 smoke runs (see BROWSER_COMPATIBILITY "Known test flake").

**Not run:** Firefox (not installed), Brave/Arc/Opera/Vivaldi, real shortcut key presses, headed/visual review, clipboard, Enhance, Drive OAuth, real-world sites.

**Recommendation:** GO for Phase 3 (privacy and trust). Before release, a human should press the three shortcuts and check the popup's new message once in normal Chrome.

---

## 2026-10-18 — Phase 3: Privacy and trust

**Approval:** owner said "lets go". The Phase 1 and Phase 2 human passes are still unreported.

**Method:** the claude-api skill was consulted for the Anthropic call. `claude-sonnet-4-6` is a current model ID and was kept (switching models is a migration for the owner to scope). The error shape is `{type:"error", error:{type, message}}`; no SDK was added (no build step). The new `tests/browser-privacy.js` was run on the code first (2/11 passed, reproducing the problems), then fixes, then all suites re-run in Chrome and Edge. The privacy suite is fully offline: the service worker's `fetch` and `chrome.identity.launchWebAuthFlow` are mocked, external hosts are blocked with `Network.setBlockedURLs`, and any external attempt fails P0. No real key, account or provider was contacted.

**Runtime files changed:** `content.js` (attribute-safe `escapeHtml`, escaped `data-id`, `confirmOnce` consent for Enhance/Drive, `isTrusted` guard on both, column widths moved to extension storage with host-page leftovers removed), `background.js` (provider table + `callProvider` readable errors, `pageAddressForAi`, optional model override, network-free silent Drive status, account cached on connect and cleared on disconnect), `settings.html/js` (model field, honest key-storage text, privacy section), `popup.js` (file hint without `tabs`), `manifest.json` (removed `activeTab`, `tabs`).
**Other files:** `tests/browser-privacy.js` (new), `tests/content-helpers.test.js` (escapeHtml), `tests/browser-smoke.js` (poll instead of fixed sleep after save), README (Privacy + permissions), CLAUDE.md, AGENTS.md, `docs/product/PRIVACY_AND_PERMISSIONS.md` (new), BROWSER_COMPATIBILITY, FEATURE_INVENTORY, PRODUCT_BRIEF (D9, D10).

**Checks run (final):**

| Command | Chrome 155 | Edge 156 |
|---|---|---|
| syntax, manifest, unit tests | PASS | — |
| `browser-smoke.js` | 22/22 | 22/22 (×3); one earlier run aborted on a C19 timeout, not reproduced |
| `browser-env.js` | 18/18 | 18/18 |
| `browser-privacy.js` | 13/13 (×3) | 13/13 |
| `browser-privacy.js` before fixes | 2/11 | — |

**Findings fixed:** P1 category → attribute injection (an `onmouseover` attribute appeared on a button in the host page); P3 query string sent to AI; P4/P8 no consent; P5 raw errors; P6 Settings contacted Google; P10 host localStorage writes; P11 two unused permissions; P12 page-script `.click()` could trigger Enhance/Drive.

**Not run:** real providers and real Google OAuth (deliberately), Firefox, a human read of the consent wording, screen-reader/visual check of the Settings privacy section, the OpenAI/OpenRouter default models against those providers' current lists.

**Recommendation:** GO for Phase 4 (UX and accessibility), with D9 (shadow DOM) flagged as a pre-release decision.

---

## 2026-10-18 — Phase 4: UX and accessibility

**Approval:** owner said "continue" at the Phase 3 gate. The Phase 1–3 human passes are still unreported.

**Method:** a new `tests/browser-a11y.js` measures in real Chrome:
- real key events (Tab, Enter, Escape)
- computed accessible names from Chrome's accessibility tree
- focus-ring styles
- contrast, alpha-composited over light and dark host pages, in both themes
- emulated reduced motion
- 640×450 and 320×568 viewports

It was run on the pre-Phase-4 copy first: **5/24**. Two first-draft probe errors were found and corrected before the results were trusted:
- F1 read styles before a 150 ms focus transition had started.
- C1/C3 measured a background tab, where CSS transitions don't advance.

The diff review found two regressions introduced by the new Escape handler, plus a pre-existing keyboard-drag bug. All three are fixed and guarded by K8/K9.

**Runtime files changed:**
- `content.js`:
  - Escape on `#designnote-root`; focus return on every close
  - first menu item focused when a menu opens
  - card number as a "go to" button
  - `aria-pressed` / `aria-expanded`; labelled dialogs and fields
  - selector-loss and fuzzy-match toasts
  - Mark mode hint and keyboard-focus highlight
  - reduced-motion scrolling and cursor
  - form listener cleanup
  - filter chips moved from inline colours to `aria-pressed`
  - theme-aware `getTypeColor`
  - keyboard-drag fix
  - darker type colours in the HTML/print exports
- `content.css`: edit form centring, header wrapping, card-number/pin text colour, custom badge, chip styles, `@supports` fallback list, reduced-motion rule.
- `design-tokens.css` and `design-system.html` (mirror): glass opacity 0.72 → 0.9, secondary text, three light type colours, new `--dn-type-custom-l`.

Unchanged: `background.js`, `selector.js`, manifest, popup, settings.

**Other files:**
- New: `tests/browser-a11y.js`, `docs/ux/UX_AUDIT.md`.
- Updated: README (keyboard use), CLAUDE.md, AGENTS.md, TEST_PLAN, BROWSER_COMPATIBILITY (release check), FEATURE_INVENTORY (R8 fixed), PRODUCT_BRIEF (stale `Ctrl+Shift+M`).

**Checks run (final):**

| Command | Chrome 155 | Edge 156 |
|---|---|---|
| syntax, unit tests | PASS | — |
| `browser-smoke.js` | 22/22 | 22/22 |
| `browser-env.js` | 18/18 | 18/18 |
| `browser-privacy.js` | 13/13 | 13/13 |
| `browser-a11y.js` | 24/24 | 24/24 |
| `browser-a11y.js` on the pre-Phase-4 copy | 5/24 | — |

**Not run:**
- a screen reader (NVDA, JAWS, Narrator or VoiceOver)
- real browser zoom
- forced-colors / High Contrast mode
- a headed visual review of the new opacity, chips, card numbers and Mark hint
- Firefox
- first-run discoverability with real users (Phase 5)

**Owner decision raised:** panel opacity 0.9 (a subtler glass look). It is one token per theme; below about 0.88, contrast fails over opposite-brightness pages.

**Recommendation:** GO for Phase 5 (usability study preparation) after a short headed visual check in both themes. Phase 5 requires real participants; no results will be fabricated.

---

## 2026-10-21 — Launch readiness (documentation only)

**Goal:** list what stands between the current build and a public store listing.

**Files created:** `docs/product/LAUNCH_READINESS.md` (status, store plan, blockers L1–L8, production features F1–F10, packaging and release steps, human checklist, licence and third-party review, store submission kit, owner decisions).

**Runtime files changed:** none.

**Checks run:** unit tests (`selector-fingerprint`, `content-helpers`, `mcp-structure`) PASS; `node --check` on all JS PASS; grep for `console.log`/`debug` and TODO/FIXME: none; manifest `description` length 154 (> Chrome's 132, logged as L8). The AI-agent bridge was verified live with Claude Code (a shared note and its screenshot were read) after fixing a placeholder server path in the user's MCP config.

**Not run:** the browser suites (no runtime change), any store upload, real Enhance/Drive.

**Recommendation:** owner answers LAUNCH_READINESS §9, then L1/L2/L8 and F1–F3 as the next code phase.

---

## 2026-10-21 — Popup: live AI agents strip

**Goal (owner request):** the toolbar popup shows which AI agents are connected and how many; an agent blinks while it works; hovering shows its details.

**Runtime files changed:** `background.js` (per-connection activity: `since`, `calls`, `busy`, `lastAt`, `seen`, `assigned`; `liveAgents()` aggregates per kind with `sessions`; published at each call's start and end; `bridgeCall` takes the link; log entries carry `agent`), `popup.html` (agents strip + hover card styles), `popup.js` (keyed render, 1 s tick, blink for in-flight requests and 2.5 s after, card on hover and keyboard focus, off / waiting / old-pairing-code states with a link to Settings).
**Other files:** `tests/browser-bridge.js` (B31–B33), README, CLAUDE.md.

**Checks run:** `node tests/browser-bridge.js` (Chrome) 33/33 PASS, including B31 "2 connected claude-code,codex", B32 idle → Working… → Connected, B33 card hidden until hover, then shows requests, notes visible and the agent's last request. Screenshot reviewed (dark theme).

**Not run:** Edge, light theme screenshot, a screen reader on the new strip.
