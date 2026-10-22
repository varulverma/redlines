# Redlines — Launch Readiness

_Created 2026-10-21. This document takes the extension from "works on my machine" to a public store listing. It lists what is done, what blocks launch, what each store needs, and the decisions only the owner can make. Update the status columns as items close._

Related: [PRODUCT_BRIEF.md](PRODUCT_BRIEF.md) (scope, decisions D1–D10), [PRIVACY_AND_PERMISSIONS.md](../../../docs/PRIVACY_AND_PERMISSIONS.md), [FEATURE_INVENTORY.md](FEATURE_INVENTORY.md) (risk register), [../testing/BROWSER_COMPATIBILITY.md](../testing/BROWSER_COMPATIBILITY.md), [../ux/UX_AUDIT.md](../ux/UX_AUDIT.md), [../roadmap/EXECUTION_LOG.md](../roadmap/EXECUTION_LOG.md).

---

## 1. Where we are

| Area | State | Evidence |
|---|---|---|
| Core workflow (mark → note → sidebar/table → export) | Working | `browser-smoke.js` 22/22, Chrome 155 + Edge 156 |
| Browser environment (popup, shortcuts, SW restart, SPA, dialogs, updates) | Working | `browser-env.js` 18/18, Chrome + Edge |
| Privacy (escaping, consent, trusted clicks, no silent network) | Working | `browser-privacy.js` 13/13, Chrome + Edge |
| Keyboard + contrast | Working | `browser-a11y.js` 24/24, Chrome + Edge |
| AI agent bridge (MCP) | Working | `browser-bridge.js`; verified live with Claude Code on 2026-10-21 (read a note + its screenshot) |
| Unit checks | Pass | `selector-fingerprint`, `content-helpers`, `mcp-structure` (re-run 2026-10-21) |
| Code hygiene | Clean | no `console.log`/`debug`, no TODO/FIXME, all JS passes `node --check` |
| Remote code | None | no CDN scripts, no `eval`; fonts and icons are bundled |
| Package size | 1.1 MB runtime files | the folder also holds ~170 MB of dev material that must not ship (§5) |
| Branding | Final | name **Redlines**, Burst logo in `brand/logo/burst/` and `icons/` |
| Real-person checks | **Not done** | the headed human passes requested in Phases 1–4 were never reported; real Enhance and real Drive OAuth were never run |

**Bottom line:** the code is close to release quality on Chromium. What's missing is mostly *around* the code: packaging, MCP distribution, licence, hosted privacy policy, store assets, and one round of human testing.

---

## 2. Release plan

| Step | Store | Cost | Package | Why this order |
|---|---|---|---|---|
| **v1.0 — first** | **Microsoft Edge Add-ons** | Free (Partner Center; a personal GitHub sign-in works) | same zip as Chrome | Free, Chromium, already passes every suite in Edge 156 |
| **v1.0 — second** | **Chrome Web Store** | One-time US$5 developer registration | same zip | Biggest audience, primary test browser |
| v1.1 | Opera Add-ons | Free | same zip | Chromium; needs one smoke run first |
| v1.x | Firefox Add-ons (AMO) | Free | same manifest, needs testing | Never loaded in Firefox. Host permissions are opt-in there, so content scripts may not run until the user grants site access |
| — | Safari | US$99/yr Apple Developer + Xcode conversion | — | Out of scope |

Store review usually takes from a few days up to a couple of weeks for `<all_urls>` extensions. Plan the listing date after approval, not on submission day.

**Release channel suggestion:** submit to Edge first as a public listing, or as **unlisted** if you want a quiet beta with a link you share. Promote once Chrome is approved too.

---

## 3. Launch blockers (must close before any public listing)

| ID | Blocker | Why it blocks | What "done" looks like | Status |
|---|---|---|---|---|
| **L1** | **Release package** | The folder mixes runtime files with `brag-output*` (~170 MB), `tests/`, `docs/`, `tools/`, `brand/`, `.claude/`, `.impeccable/`, `.superpowers/`, `*.md`, `design-system.html`. Stores reject or flag junk, and dev notes would ship to users. | A `tools/package` script that zips an **allowlist**: `manifest.json`, `*.js` (runtime only), `*.html` (popup, settings), `*.css`, `fonts/`, `icons/`. It refuses to build if `node --check` or the unit tests fail. Output: `dist/redlines-<version>.zip`. | Open |
| **L2** | **MCP server distribution** | Users must currently type the path of the folder they loaded into Chrome. Store installs have no visible folder at all, and a wrong path fails silently as "Connection closed" (this happened on 2026-10-21). | Publish `mcp/redlines-mcp.js` to npm as **`redlines-mcp`** (name was free on 2026-10-21) with a `bin` entry. Settings shows `npx -y redlines-mcp` in every agent's command and drops the "Redlines folder" field. | Open |
| **L3** | **Licence + ownership** | No `LICENSE` file, so legally nobody may use or fork the code; and ownership must be clear before you publish under your name. | `LICENSE` at the root (see §7), copyright line with the owner's name, and the employer question in §7 answered. | Open |
| **L4** | **Hosted privacy policy** | Both stores require a public privacy-policy URL for an extension that reads page content, takes screenshots and can send data to AI providers and Google. | A public page (free: GitHub Pages) based on PRIVACY_AND_PERMISSIONS.md, **including the AI-agent bridge** (see L5). URL added to the store listing and to Settings → "Your data". | Open |
| **L5** | **Privacy doc misses the AI-agent bridge and `alarms`** | `PRIVACY_AND_PERMISSIONS.md` predates the bridge. It says data leaves only through Enhance and Drive, and its permission table has no `alarms`. The Settings page already describes the bridge correctly; the doc and store disclosures must match it. | Doc updated: the bridge row (what an agent can read, that it stays on 127.0.0.1, that the AI tool may forward it to its provider, read-only default, shared sites, screenshots toggle, activity log) and an `alarms` row (reconnects to the bridge every 30 s while it's on). | Open |
| **L6** | **Shadow DOM decision (D9)** | Open panels are part of the host page DOM, so page scripts and session-replay tools can read them. The Product Brief marks this "decide before public release". | Owner chooses: **(a)** ship v1.0 with the existing disclosure (Settings and privacy policy already say it) and schedule D9 for v1.1, or **(b)** move the UI into a closed shadow root before launch (larger CSS refactor). Recommendation: **(a)**, because the risk is disclosed, limited to while a panel is open, and the refactor touches every style. | Decision needed |
| **L8** | **Manifest description too long** | `manifest.json` `description` is 154 characters; Chrome's limit is 132, so the upload is rejected. | Shorten it, e.g. the short description in §8 (101 chars). | Open |
| **L7** | **Human release check** | Every automated suite is headless. Nobody has pressed the real shortcuts, looked at the UI in both themes, or run Enhance and Drive against real accounts. | One person runs the checklist in §6 on the **packaged zip** (not the dev folder) in Edge and Chrome and records the result in EXECUTION_LOG. | Open |

---

## 4. Production features (should land in v1.0 or straight after)

Ranked by user harm × likelihood. "v1.0" means "in the first listed build"; "v1.1" means "first update".

| ID | Feature | Why | Target |
|---|---|---|---|
| **F1** | **Backup, restore and delete-all data** (D8) | Notes live only in one browser profile. Removing the extension, resetting the profile or switching computers loses everything, and users have no single "wipe" button. Store reviewers also look for a clear way to delete user data. | v1.0 |
|  | → *Backup:* Settings → "Download backup" writes one JSON file with all notes, screenshots and categories (no API key, no tokens). | | |
|  | → *Restore:* "Restore from backup" merges by note id, never overwrites newer edits. | | |
|  | → *Delete all:* one confirm, clears `dn_annotations::*` and settings, local only. | | |
| **F2** | **First-run welcome** | Nothing happens after install; the pill only appears on the next page you open, and Inspect Mode is hard to discover (UX audit E1). | v1.0 |
|  | → `runtime.onInstalled` (reason `install`) opens a short welcome page: pin the icon, try Inspect Mode on a demo page, shortcuts, link to privacy. On `update`, nothing (or a quiet "what's new" badge). | | |
| **F3** | **Feedback + diagnostics** | There is no telemetry by design, so the only way to learn about bugs is if users tell you. | v1.0 |
|  | → Popup/Settings link "Report a problem" (GitHub Issues or a mail link). "Copy diagnostics" copies version, browser, note count, bridge status, never note text or keys. | | |
| **F4** | **Google Drive setup for normal users** (D10) | Today each user must create their own Google Cloud OAuth client, which most people won't do. | v1.0: label Drive as an **Advanced** option with the current setup steps. v1.1: owner registers one OAuth client (`drive.file` is a non-sensitive scope, so Google needs consent-screen and brand verification but no security audit) and switches to auth-code + PKCE. |
| **F5** | **Storage health** | Screenshots fill storage fast. `loadAllAnnotations` reads every screenshot on each table render in All-pages mode (R15). | v1.1: read screenshots lazily; show used space in Settings; warn above a threshold. |
| **F6** | **Consistent numbering** (R7) | "#3" means different notes in the pins, the table and exports. | v1.1 |
| **F7** | **Fingerprint precision** (R13) | A text match alone can highlight the wrong element. | v1.1 |
| **F8** | **Provider defaults check** | OpenAI/OpenRouter default models were never checked against those providers' current lists. | Before v1.0 submission (Settings already lets users override). |
| **F9** | **Shadow DOM UI** (D9) | See L6. | v1.1 if L6 = (a) |
| **F10** | **Firefox build** | Free store, extra audience. Needs a real test pass and a site-access prompt for opt-in host permissions. | v1.x |

Not planned (by product principle): accounts, cloud sync, analytics, a backend.

---

## 5. Packaging and release process

### What ships

```
manifest.json
background.js  content.js  selector.js  prefs.js  popup.js  settings.js  theme.js
popup.html  settings.html
content.css  design-tokens.css  theme.css
fonts/   (TTF files + both OFL licence files)
icons/   (app icons + icons/agents/*.svg + SOURCES.md)
LICENSE
```

Never ships: `mcp/` (goes to npm instead, L2), `tests/`, `docs/`, `tools/`, `brand/` (except `brand/logo/burst/redlines-burst-body.svg` and `redlines-burst-cursor.svg`, which `theme.css` loads), `brag-output*`, `design-system.html`, `*.md` (other than LICENSE), dot-folders.

### Versioning

- `manifest.json` `version` follows `MAJOR.MINOR.PATCH`. Every store upload needs a **higher** version than the last one.
- Keep a `CHANGELOG.md` (repo only) with one entry per release, in plain language; it doubles as the store's "What's new".
- The npm `redlines-mcp` version moves independently, but the extension and server must agree on the message protocol (`hello` / `welcome` / `call` / `reply` / `agent`). If that protocol changes, bump the server's major version and have the extension show "Update your Redlines MCP server" when the versions disagree.

### Release steps (each release)

1. Bump `manifest.json` version; add the CHANGELOG entry.
2. Run all checks:
   ```
   node tests/selector-fingerprint.test.js
   node tests/content-helpers.test.js
   node tests/mcp-structure.test.js
   node tests/browser-smoke.js
   node tests/browser-env.js
   node tests/browser-privacy.js
   node tests/browser-a11y.js
   node tests/browser-bridge.js
   ```
3. Build the zip (L1). Load **the zip's contents** unpacked in a clean profile and run the human checklist (§6).
4. Upload to Edge Partner Center and the Chrome Developer Dashboard. Paste the CHANGELOG entry as release notes.
5. Record the release in EXECUTION_LOG: version, date, stores, check results.
6. Keep a copy of every uploaded zip. Stores don't let you download your own past packages easily, and you need them to roll back.

---

## 6. Human release checklist

Run on the packaged build, in Edge and in Chrome, light and dark OS theme.

- [ ] Install from the zip: no warnings on the extensions page; welcome page opens (F2).
- [ ] On a normal site: the pill appears; `Alt+Shift+M` starts Inspect Mode; click an element; save a note with a preset and a custom category.
- [ ] Sidebar (`Alt+Shift+D`) and table: edit, delete + Undo, jump to element, filter chips.
- [ ] Every export opens in its app (Excel, CSV, HTML, print/PDF, ZIP, Markdown, JSON).
- [ ] Reload the page: pins come back on the right elements.
- [ ] Popup count is right; on `edge://` / `chrome://` pages it explains why it can't run.
- [ ] Enhance with a **real** key for each provider you advertise; consent shows once; an invalid key gives a readable error.
- [ ] Drive with a real Google account (if Drive is enabled in v1.0): connect, upload, disconnect.
- [ ] AI agents: Settings → On, add Claude Code with the `npx` command (L2), share `localhost`, add a note on localhost, ask the agent to list it; resolve it from the agent with writes on; confirm the "AI" label and the activity log.
- [ ] Backup → Delete all → Restore round trip (F1).
- [ ] Screen reader spot check (Narrator on Windows): open the sidebar, read a card, close with Escape.
- [ ] Update test: install version N, add notes, install N+1 over it; notes are still there.

---

## 7. Licence, ownership and third-party material

### You don't buy a licence

As the author, you already own the copyright. A licence is a file you add that says what *other people* may do with your code. Pick one:

| Option | Effect | Good when |
|---|---|---|
| **MIT** | Anyone may use, change and redistribute it, including commercially, if they keep your copyright notice. | You want trust and contributions. Common for developer tools and MCP servers; an open-source MCP server is easier for people to trust with their notes. |
| **Apache-2.0** | Like MIT, plus an explicit patent grant and a trademark clause. | You want to stop forks from using the Redlines name and logo. |
| **Proprietary** ("Copyright © 2026 <owner>. All rights reserved.") | People can install it from the store but may not copy or reuse the code. | You may sell it or a Pro tier later. |

You can list on every store under any of these. A common split: **extension proprietary or MIT, MCP server MIT** (people run it on their machine and want to read it).

The licence covers code, not the name. To protect "Redlines" and the Burst logo, add a line such as "The Redlines name and logo are not covered by this licence" (Apache-2.0 already says so).

### Ownership check (do this first)

Resolved 2026-10-21: Redlines is owned by Varul Verma. Store, npm and GitHub accounts belong to the owner.

### Name check

Search the Chrome Web Store, Edge Add-ons, npm, GitHub and a trademark database (for India: the IP India public search; for the US: USPTO) for "Redlines" in software or design tools before you print it on a listing.

### Third-party material already in the package

| Item | Licence | What to do |
|---|---|---|
| Space Grotesk, Space Mono (`fonts/`) | SIL Open Font License 1.1 | Already compliant: the OFL text files ship next to the fonts. Don't sell the fonts on their own. |
| Agent logos (`icons/agents/`) | Simple Icons, CC0 | Free to use. The logos are still the companies' trademarks: use them only to identify those tools (as Settings does), never in store screenshots or promo art as if they endorse Redlines. `SOURCES.md` records this. |
| Burst logo, all code | Yours | Covered by your chosen licence. |

---

## 8. Store submission kit

### Both stores

| Field | Content |
|---|---|
| Name | Redlines — Visual Annotation Tool (33 chars; manifest limit 75) |
| Short description | "See. Mark. Explain. Ship. Pin notes to any element on any web page, saved privately in your browser." Comes from `manifest.json` `description`, limit 132 chars (L8). |
| Long description | What it does; who it's for; local-first; the optional features (Enhance, Drive, AI agents) and exactly what each sends; shortcuts; link to the privacy policy. |
| Category | Developer Tools (Chrome) / Developer tools (Edge) |
| Icon | `icons/icon128.png` (Burst) |
| Screenshots | 1280×800 PNG, 3–5: Inspect Mode on a page, the note form, the sidebar, the table view, AI-agent settings. Use your own demo pages, not third-party sites or logos. |
| Promo tile | Chrome small promo 440×280 (required); Edge accepts the same art |
| Privacy policy URL | from L4 |
| Support | GitHub Issues URL or a support email |

### Permission justifications (paste into the dashboard)

| Permission | Justification |
|---|---|
| `host_permissions: <all_urls>` | Users annotate whatever page they're reviewing, so the content script must run on any site, and `captureVisibleTab` needs host access to screenshot the annotated element. The extension reads the page only to locate and capture the element the user clicks. |
| `storage` | Saves notes, screenshots and settings locally. |
| `unlimitedStorage` | Element screenshots exceed the default quota. |
| `scripting` | Re-adds the UI to tabs that were open before install or after an update. |
| `identity` | Google Drive sign-in, only when the user connects Drive. |
| `alarms` | Reconnects to the user's local AI-agent bridge every 30 seconds while the user has turned that feature on. |

### Chrome "Data usage" form

Collected *only on user action and never sold or transferred to third parties other than the services the user picks*: **website content** (note text, selectors, page address, screenshots), **authentication info** (the user's own API key and Google token, stored locally). Remote code: **No**. Tick the three Limited Use certifications only if every statement in L4/L5 is true.

---

## 9. Owner decisions

| # | Decision | Recommendation |
|---|---|---|
| L6 / D9 | Shadow DOM before launch? | Ship with disclosure; do it in v1.1 |
| §7 | Licence | MIT for the MCP server; MIT or proprietary for the extension |
| §7 | Who owns the code (you or employer)? | Confirm in writing before publishing |
| F4 / D10 | Drive in v1.0? | Keep it, labelled Advanced; shared OAuth client in v1.1 |
| §2 | First listing public or unlisted? | Unlisted on Edge for a short beta, then public on both |
| D6 | Firefox | After v1.0, with a real test pass |
| — | Support channel | GitHub Issues (public, free) |

---

## 10. Order of work

1. **Decide** §9 (licence, ownership, D9, Drive).
2. **Ship prep (code):** L8 manifest description, L1 package script, L2 npm `redlines-mcp` + Settings `npx` command, F1 backup/restore/delete-all, F2 welcome page, F3 feedback link, F8 model check.
3. **Ship prep (docs):** L3 LICENSE, L5 privacy doc, L4 hosted policy, CHANGELOG, README refresh (title still says "DesignNote … (MVP)"; the bridge section still says "one AI tool at a time" though several now run side by side).
4. **Assets:** screenshots, promo tile, store copy (§8).
5. **Verify:** all suites + the human checklist (L7) on the packaged zip.
6. **Submit:** Edge → Chrome. Record in EXECUTION_LOG.
7. **After launch:** watch reviews and issues weekly; v1.1 = F4–F7, F9.
