# DesignNote — Product Brief

_Last updated: 2026-10-17 (Phase 0 baseline). Owner decisions marked **OPEN** are not yet made._

## Product job

Help a designer or front-end developer record a visual issue on a live webpage, keep
enough context (element, page, screenshot) to make it actionable, and hand it to the
next person or tool (developer, tracker, AI coding assistant) with less ambiguity.

## Primary workflow (the thing we protect)

1. Install and enable the extension.
2. Open a webpage.
3. Find and turn on **Mark** mode (floating pill → target icon, or `Alt+Shift+M`).
4. Click the element you mean. DesignNote stores its selector, a fingerprint, its position and a cropped screenshot.
5. Choose a category, write the note, save.
6. Reopen the sidebar (message icon) or the table view and find the note.
7. Edit, delete, copy or jump back to the element.
8. Export the notes you mean (file or clipboard), or on purpose send them to an AI provider or Google Drive.
9. Close the UI. The page should look and work exactly as before.

## Audience hypothesis (not validated)

A freelance web designer or front-end developer who reviews sites alone and hands
findings to a developer, a team or an AI coding assistant. This guess comes from the
code and the roadmap. **No user research has been done.** Phase 5 tests it.

## Product principles

- **Reliability before feature count.** The feature list already runs ahead of what has been verified.
- **Local-first.** Capture, save and load never make a network call. Only an explicit user action calls out (Enhance, Drive).
- **Transparent data movement.** The user can tell exactly what leaves the browser and where it goes.
- **Context travels with the finding.** Every exported row keeps its source page and location.
- **Small, safe changes.** Vanilla JS/CSS/HTML, no build step, no new dependencies without owner approval.
- **Evidence over assumptions.** Reports keep source reading, harness checks, real-browser checks and user research separate.

## Release target

Store plan, launch blockers and the release process: [LAUNCH_READINESS.md](LAUNCH_READINESS.md) (2026-10-21; Edge first, then Chrome).

| Browser | Status | Notes |
|---|---|---|
| **Chrome (desktop, current stable)** | **Proposed first-release target** | Tested: Chrome 155, automated suites (Phase 1–2). |
| **Microsoft Edge** | Tested | Edge 156, same suites (Phase 2). |
| Brave / Arc / other Chromium | Not yet verified | Expected to match Chrome; not installed on the test machine. |
| Firefox / Zen 121+ | Not yet verified | Manifest has `gecko` settings and `background.scripts`. Known risks: host permission is opt-in, shortcut conflicts, `ClipboardItem` needs FF 127+. |
| Safari | Not supported | Would need an Xcode conversion. Out of scope. |

## In scope for the first controlled release

Mark/annotate, sidebar, table view, edit/delete/copy/jump, the existing exports,
optional AI Enhance (Anthropic / OpenAI / OpenRouter, using the user's own key) and
optional Drive upload (the user's own OAuth client).

## Explicitly out of scope until evidence says otherwise

Accounts, cloud sync, shared workspaces, assignments, a backend, telemetry and analytics.

## Open product decisions (owner)

**2026-10-17:** The owner said "continue" to the Phase 1 proposal. D1–D4 were implemented using the proposed defaults below. D7 was handled partially (honest label, toast and file name; no behaviour change). D5, D6 and D8 remain open.

| # | Decision | Why it matters | Default proposed |
|---|---|---|---|
| D1 | **Types vs categories.** The create form no longer offers the 4 built-in types (text/suggestion/bug/note); new users must type a free-text category. The edit form and filter chips still only know the 4 types. | Edit is broken for custom categories, and the filters miss most new notes (see the risk register). | Keep both. Treat the 4 types as preset categories that are always offered, and make edit and filters work on any category string. **Confirm.** |
| D2 | **Export scope.** HTML export is always current-page (matches the 2026-07-21 spec). Most other exports follow the table view's "This page / All pages" toggle, and that toggle state leaks into the sidebar's export menu. | Users can export a different set of notes than the one they are looking at. | Sidebar exports are always "this page". Table exports follow the visible toggle, including HTML. Every export label states its scope. **Confirm.** |
| D3 | **Edit timestamp.** Editing overwrites `timestamp`, so the original "Marked at" is lost. | Audit trail and export ordering. | Keep `timestamp` as the creation time and add `updatedAt`. **Confirm.** |
| D4 | **Delete safety.** No confirm and no undo. | Accidental loss of a finding. | A 5-second Undo toast. **Confirm.** |
| D5 | **URL keying.** The key is the full URL minus `#…`. Hash-routed SPAs share one bucket; the same page with different query strings gets separate buckets. | Notes can "disappear" or merge between routes. | Document it now; revisit after Phase 1 testing. |
| D6 | **Release browsers.** Chrome-only first, or Chrome + Firefox? | It decides the Phase 2 test matrix. | Chrome-only first. Firefox stays "not yet verified". |
| D7 | **"PDF" export.** It downloads an `.html` file that auto-prints when opened. The toast says "Opening print dialog". | Misleading label and outcome. | Rename it to "Print-ready HTML (save as PDF)", or open a print view directly. **Choose.** |
| D9 | **Shadow DOM for the in-page UI.** Open panels are part of the page DOM, so page scripts and session-replay tools can read them. | Privacy on third-party sites. | Move to a closed shadow root (larger refactor of CSS scoping). **Decide before public release.** |
| D10 | **Drive OAuth flow.** Implicit flow (discouraged by Google). | Long-term compatibility. | Auth-code + PKCE via `launchWebAuthFlow`; no backend needed. |
| D8 | **Backup / clear local data.** No way to back up, restore or wipe all notes. | Data safety and privacy. | Phase 3/4 candidate. Local only, no remote store. |
