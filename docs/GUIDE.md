# Redlines — extension reference

A Chrome / Edge extension for marking up any web page like Figma comments. Fully
local and offline by default; an optional AI "Enhance" button turns a raw
comment into a structured prompt for Claude/GPT/OpenRouter, and an optional
local MCP bridge lets AI coding agents read your notes.

## Load it into Chrome

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the Redlines folder (the one with `manifest.json`)
5. Visit any webpage or local HTML file (for local files, enable "Allow
   access to file URLs" on the extension's details page)

## How to use it

- A small pill docks at the right edge of the screen with two icon buttons:
  a target (Mark) and a message bubble (Notes), the latter showing a badge
  with the current page's annotation count.
- Click the target icon (or `Alt+Shift+M`) → hover highlights elements → click
  one → a form appears with category pills → write your note, save. **Escape**
  leaves Mark mode. The four built-in types (Text / Suggestion / Bug / Note) are
  always offered; **+ New** adds your own category (remembered for that page and
  domain). Typing a built-in name such as "Bug" picks the built-in type.
- Click the message icon to open the sidebar and see every annotation on
  the current page (keyed to the exact URL) as cards.
- Click any card (or its number) to scroll to and highlight its element. If the
  page has changed and the element is gone, a message says so.
- **Keyboard:** Tab to the target button and press Enter for Mark mode, then Tab
  to a link, button or field on the page and press Enter to mark it (plain text
  can't take keyboard focus; use **+** for a general note instead). Escape closes
  the open menu, table or sidebar and returns focus to where you were.
- While the sidebar is open, **numbered pins** mark each annotated element on
  the page (click a pin to jump to its card). The **rail icon** in the header
  toggles **compact view**: the sidebar shrinks to a 56px column of numbered dots
  and expands on hover. Compact is the default and is remembered.
- Each card has icon buttons: **Copy** (grabs the annotation as JSON),
  **Copy image** (screenshot only, so it pastes as a picture in Figma/Slack/Docs;
  either copy marks the card with a green **Copied** badge that persists),
  **Enhance** (rewrites it into a ready-to-paste AI coding prompt — requires
  an API key set in Settings, opened via the toolbar popup), and **Delete**.
- The **+** icon in the sidebar header adds a general note with no element
  attached; the **✕** closes the sidebar.
- **Edit** keeps the note's category unless you pick another one, and keeps the
  original "Marked at" time (an `updatedAt` is stored too). **Delete** shows an
  **Undo** button for a few seconds.
- The **table icon** in the sidebar header opens a full-screen table view
  (thumbnail, type, note, location, timestamp, actions) with search, type
  filters and a **This page / All pages** toggle. All pages groups notes by
  domain; notes from other pages can be deleted there but not edited or copied.
- **Export scope:** the sidebar's Export menu always exports **this page**. The
  table view's Export and Copy menus export what its **This page / All pages**
  toggle shows, and each menu names its scope at the top. Search and type
  filters are *not* applied to exports. File names include `current-page` or
  `all-pages`, and every row carries its page URL. Formats:
  - **Excel (`.xlsx`)** — a real spreadsheet with each screenshot **embedded
    as an image** in the Screenshot column. Filename `designnote-<host>-<scope>-<date>.xlsx`.
  - **HTML** — a standalone `designnote-<host>-<scope>-<date>.html` with the same
    table and inline screenshots, opens in any browser.
  - **CSV** (table view) — every cell quoted; values starting with `=`, `+`, `-`
    or `@` get a leading `'` so spreadsheets don't run them as formulas.
  - **PDF (print-ready page)** (table view) — downloads a `…-print.html` that
    opens the print dialog when you open it; choose "Save as PDF" there.
  - **ZIP bundle** (table view) — `annotations.json`, `report.html` and a
    `screenshots/` folder.
  - **Send to Google Drive** (cloud icon) — uploads that same `.xlsx` audit to
    your Google Drive. You connect Drive once (Google consent screen on first
    use); Chrome caches and refreshes the token after that. Requires the
    one-time setup below.
- **Copy all annotations** (table view header) in a structured format —
  **Markdown**, **JSON**, **XML**, **Notion**, **Linear** or **Jira** — one entry
  per annotation, each with its page URL. (Text formats
  carry a `hasScreenshot` flag rather than the raw image bytes; the actual
  images live in the Excel/HTML exports.)
- The whole UI is a floating **liquid-glass** design (translucent panels with
  backdrop blur) and follows your OS/browser light or dark theme automatically.

### Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Alt+Shift+M` | Mark mode on/off. Use it to annotate inside an open dropdown, popup or modal dialog, where a click would close it first |
| `Alt+Shift+D` | Sidebar open/closed |
| `Alt+Shift+H` | Show/hide the floating button |
| `Esc` | Leave Mark mode / cancel the note form |

The previous defaults (`Ctrl+Shift+D/P/M`) clash with browser shortcuts, so Chrome never
assigned them. Chrome applies suggested shortcuts only on a fresh install. If you
installed an earlier build, set the shortcuts once at `chrome://extensions/shortcuts`.

### Pages and tabs

- Tabs that were already open when you installed, reloaded or updated DesignNote
  get it the first time you use the toolbar popup or a shortcut there. A tab still
  showing the old floating button says "Refresh this page" when you click it.
- Browser pages (`chrome://…`, `edge://…`) and extension stores can't be annotated;
  the popup says so. Local `file://` pages need "Allow access to file URLs".
- While a page shows a modal `<dialog>`, DesignNote's UI moves into the dialog so it
  stays usable.

## Privacy

- **Local by default.** Notes, screenshots and settings live only in this browser's
  extension storage. Marking, saving, viewing and all file exports work offline. No
  account, server, analytics or telemetry.
- **Enhance** (only when you click it) sends the note text, category, element selector and
  the page address **without** query string or `#fragment` to the AI provider you chose,
  using your own API key. No screenshots. You're asked once per provider first.
- **Send to Google Drive** (only when you click it) uploads the Excel export, screenshots
  included, to your Drive (`drive.file` scope: DesignNote sees only files it creates).
  You're asked once first. Opening Settings never contacts Google; **Disconnect** revokes
  access and forgets the account.
- Both actions respond only to your own clicks or key presses, not to scripts on the page.
- The API key and Google token are stored **unencrypted** in extension storage (other sites
  can't read it; anyone using this browser profile could).
- **AI agents** (off until you turn it on): an AI tool on this computer that you started
  with your pairing code can read notes from your **shared sites** only. See "Connect to AI
  agents" below. Redlines talks only to `127.0.0.1`; the AI tool may send what it reads to
  its own provider.
- While a DesignNote panel is open, the page's own scripts can technically see what it
  shows. Avoid opening it on untrusted sites.
- Remove data by deleting notes, clearing the key in Settings, or removing the extension.

Details, permissions and the threat model are in `docs/product/PRIVACY_AND_PERMISSIONS.md`.

**Permissions:** `<all_urls>` (show the UI on pages you review and take screenshots),
`storage` + `unlimitedStorage` (notes and screenshots), `scripting` (enable DesignNote in tabs
that were open before install or an update), `identity` (Google Drive sign-in), `alarms`
(reconnect to a local AI tool every 30 s while "Connect to AI agents" is on).

## Data model (per URL, in `chrome.storage.local`)

Key: `dn_annotations::<page URL without #fragment>` → array in creation order.

```
{
  id,
  type,         // "text" | "suggestion" | "bug" | "note", or any custom category string
  text, selector,
  fingerprint,  // { tag, textHash, siblingIndex, parent } — fallback when the selector breaks
  anchor?,      // { describe, text, label, role, testId, component, classes, landmark, heading }
                //   e.g. describe: 'button "Pay now" in form "Payment" under "Checkout"'
  pageTitle?,   // document.title when the note was made
  rect,         // { top, left, width, height } in document coordinates at click time
  screenshot,   // PNG data URL or null
  timestamp,    // created ("Marked at"); never changed by edits
  updatedAt?,   // last edit
  copiedAt?,    // last Copy / Copy image
  status?,      // "open" (default when missing) | "resolved"
  resolvedAt?, resolvedBy?,  // "user" | "ai"
  replies?,     // [{ by: "ai" | "user", text, at }]
  source?       // "ai" when an AI agent added the note
}
```

Older notes without the optional fields keep working unchanged.

## Connect to AI agents (MCP)

AI tools that support MCP (Claude Code, Claude Desktop, Cursor, VS Code, Windsurf, Codex,
Gemini CLI…) can read your notes and work through them: "fix all open Redlines bugs on
localhost:3000".

**You need:** Node.js 18+, an MCP-capable AI tool on the same computer, and the browser open.

1. **Settings → Connect to AI agents → On.** You get a private pairing code.
2. Enter the folder you loaded into Chrome; copy the ready-made command
   (Claude Code) or JSON (other tools' MCP config) and add it to your AI tool.
3. The status turns **Connected** once the AI tool starts the bridge (`mcp/redlines-mcp.js`,
   no dependencies).

The toolbar popup's **AI agents** strip shows how many agents are connected and which ones. An
agent's chip blinks while it is reading or changing your notes. Hover it (or Tab to it) for
details: how long it has been online, how many requests it made, how many notes it can see,
how many open notes you sent to it, and its last few requests.

The agent can use these tools: `get_overview`, `list_annotations` (filter by site, page,
category, status, text), `get_annotation` (full detail plus screenshot), `get_current_page`,
`show_annotation` (opens the page and highlights the element), plus `resolve_annotation`,
`reopen_annotation`, `reply_to_annotation` and `add_annotation` when you allow changes.

Notes come grouped **site → section → page → category**. The category is the one you chose,
or, for the generic default ("note" / "UI"), one inferred from the wording (Bug, Copy / text,
Visual / layout, Accessibility, Suggestion, Question). Each note says which element it points
at in words, with its selector and `data-testid`, so the agent can find the matching code.

**Security:** the bridge listens on `127.0.0.1` only and accepts only extension origins, so web
pages can't connect. It also needs your pairing code, so other programs can't either ("New
pairing code" revokes the old one). Only **shared sites** are visible (default: localhost,
`*.local`, `*.test`, `staging.*`, `dev.*`). Screenshots can be switched off. Agents are
**read-only** unless you allow changes, anything they write is labelled **AI**, and every
access shows in Settings → Recent agent activity. Several AI tools can be connected at once:
each starts its own bridge on the next free port (up to 10), and Redlines connects to all of them.

## Google Drive setup (one-time)

The **Send to Google Drive** button uses a manual OAuth flow
(`chrome.identity.launchWebAuthFlow`), so you paste your own OAuth client ID in
**Settings** — no `manifest.json` editing required.

1. Open the extension's **Settings** page and copy the **Authorized redirect URI**
   shown under Google Drive (looks like `https://<extension-id>.chromiumapp.org/`).
2. In [Google Cloud Console](https://console.cloud.google.com/): create/select a
   project → **APIs & Services** → enable the **Google Drive API**.
3. **Credentials → Create credentials → OAuth client ID → Application type: Web
   application** → under **Authorized redirect URIs** paste the URI from step 1.
4. Copy the generated client ID, paste it into the **OAuth Client ID** field in
   Settings, and click **Check / connect**.

Scope is `drive.file` — the extension can only see and manage files it creates,
never the rest of your Drive. The access token lives ~1 hour and is cached in
local storage; when it lapses the extension re-auths silently if your Google
session is still active, or shows the consent screen otherwise.

> The redirect URI is tied to the extension ID, which changes when you reload an
> unpacked build on a different machine. Pin it with a `"key"` in `manifest.json`
> (see Chrome docs: "keep a consistent extension ID"), or update the Authorized
> redirect URI in the Cloud Console if the ID changes.

## Known MVP limitations / good next steps

- **Selector fragility**: the selector generator (`selector.js`) is
  best-effort: a stable id, test/aria attributes or a semantic class first (generated ids and
  CSS-in-JS classes are skipped), then an nth-child path. A path hit is only trusted if it still
  looks like the saved element; otherwise a structural fingerprint (tag + text + position) is
  tried, and if no single element matches the note shows **Element not found** with a
  **Re-pin** button rather than pointing at the wrong thing. Iframes and shadow DOM are not
  supported. React component names aren't visible to content scripts, so the anchor relies on
  `data-component` / `data-testid`.
- **Screenshots only cover the visible viewport** — the element is scrolled
  back into view before capture, but anything taller or wider than the window
  is cut off. Scroll-and-stitch capture is a possible v2 addition.
- **URL keying**: notes belong to the exact URL without its `#fragment`, so
  hash-routed apps share one set of notes across routes, and the same page with
  different query strings has separate sets.
- **No sync across devices** — by design (local-first per your spec). If you
  ever want team collaboration, swapping `chrome.storage.local` for a
  Supabase-backed store is the smallest lift.
- **Content script CSS isolation** uses `all: revert` under `#designnote-root`
  rather than a full shadow DOM — works well in practice, but a shadow DOM
  wrapper would be more bulletproof against aggressive host-page CSS.

## Browser support

One manifest, no build step. Test evidence is in `docs/testing/BROWSER_COMPATIBILITY.md`.

| Browser | Status |
|---|---|
| **Chrome** (desktop) | **Tested** — Chrome 155, automated suites in `tests/` (first-release target) |
| **Microsoft Edge** (desktop) | **Tested** — Edge 156, same suites |
| Brave, Arc, Opera, Vivaldi | Not yet verified (Chromium-based, expected to behave like Chrome) |
| Firefox / Zen 121+ | Not yet verified — the manifest carries the Firefox settings, but the extension has never been loaded in Firefox |
| Safari | Not supported (would need `xcrun safari-web-extension-converter`) |

- **Chromium:** `chrome://extensions` (or `edge://extensions`, etc.) → Developer mode → Load unpacked.
- **Firefox / Zen:** `about:debugging#/runtime/this-firefox` → Load Temporary Add-on → pick `manifest.json`. Grant the site-access permission if prompted. For Google Drive, register the redirect URL shown on the settings page (differs per browser).

`manifest.json` declares both `background.service_worker` (used by Chrome/Edge) and
`background.scripts` (used by Firefox, which ignores `service_worker`). This is the
cross-browser pattern MDN recommends; Chrome 121+ accepts it without warnings
(verified: no install warnings in Chrome 155). Keep both.
