# Privacy, Permissions and Trust

_Phase 3, 2026-10-18. Verified in Chrome 155 and Edge 156 by `tests/browser-privacy.js` (13 checks, fully offline: the AI and Google endpoints are mocked inside the extension and external hosts are blocked), plus `browser-smoke.js` C20 and `browser-env.js`._

## In plain language

**Your notes stay in your browser.** Marking elements, saving notes and screenshots, the sidebar and table, and every file export (Excel, HTML, CSV, PDF page, ZIP, copy as text) all work offline. DesignNote has no account, no server, no analytics and no telemetry.

**Data leaves your browser only when you press one of two buttons:**

| You press | What is sent | Where | Asked first? |
|---|---|---|---|
| **Enhance** on a note | the note text, its category, the element's CSS selector, the page address **without** query string or `#fragment`. **No screenshot.** Your API key, in the provider's auth header. | Only the provider you chose: `api.anthropic.com`, `api.openai.com` or `openrouter.ai` | Yes, once per provider |
| **Send to Google Drive** | the Excel export: notes, categories, selectors, page addresses **and screenshots**. Your Google access token, in the auth header. | `www.googleapis.com` (plus Google sign-in at `accounts.google.com` when connecting) | Yes, once |
| **Connect / Re-check** in Settings | sign-in, then one call to read your Drive account name | Google | You started it |
| **Disconnect** in Settings | your access token, so Google can revoke it | `oauth2.googleapis.com` | You started it |

Opening Settings does **not** contact Google; the Drive status comes from what this browser already stores.

**One thing to know:** while a DesignNote panel (sidebar, table, note form) is open, it is part of the web page. The page's own scripts, including analytics or session-replay tools some sites use, can technically read what it shows. Closed panels show nothing. Don't open DesignNote on pages you don't trust. Moving the UI into a closed shadow root would reduce this (decision D9 below).

**Removing data:** delete notes in the sidebar or table (Undo is offered). Clear the API key field and save to remove the key. **Disconnect** revokes Drive access and forgets the account. Removing the extension deletes everything it stored. There is no "delete all notes" button yet (decision D8).

## Where things are stored

All in `chrome.storage.local` (this browser profile only, never synced):

| Key | Contents | Sensitive? |
|---|---|---|
| `dn_annotations::<url>` | notes, selectors, fingerprints, screenshots | yes: screenshots can show anything that was on screen |
| `dn_custom_categories`, `dn_pill_state`, `dn_sidebar_compact`, `dn_col_widths` | UI preferences | no |
| `dn_provider`, `dn_model` | AI settings | no |
| `dn_api_key` | API key, **plain text, not encrypted** | **yes** |
| `dn_drive_client_id` | your OAuth client ID | low |
| `dn_drive_token` | Google access token (~1 h), plain text | **yes, short-lived** |
| `dn_drive_account` | your Google account email/name, for the status line | personal |
| `dn_consent_enhance_<provider>`, `dn_consent_drive` | "already asked" flags | no |

Protection boundary: other websites and other extensions can't read extension storage. Anyone with access to this browser profile (or malware running as you) can. DesignNote does not claim encryption, and the Settings page says so.

Nothing is written to the host page's own `localStorage`/`sessionStorage` (P10). Older builds wrote table column widths there; current builds remove those leftovers.

## Permissions

| Permission | Why it is needed | Removed in Phase 3 |
|---|---|---|
| `host_permissions: <all_urls>` | Lets the content script add the UI to any page you want to review, and lets `captureVisibleTab` take the screenshot. Chrome shows this as "read and change all your data on all websites": DesignNote reads the page only to find and capture the element you click and changes it only by adding its own UI. | — |
| `storage` | notes and settings | — |
| `unlimitedStorage` | screenshots exceed the default quota quickly | — |
| `scripting` | adds DesignNote to tabs opened before install or after an update (Phase 2) | — |
| `identity` | Google Drive sign-in (`launchWebAuthFlow`) | — |
| ~~`activeTab`~~ | redundant with `<all_urls>`; screenshots verified without it (C6, E8) | **removed** |
| ~~`tabs`~~ | never needed: no tab URL/title reads (the popup's file:// hint now uses Chrome's error text) | **removed** |

Removing permissions doesn't trigger a new permission prompt for existing users.

Google Drive scope: `drive.file`, the least-privilege Drive scope. DesignNote can see only files it created, never the rest of your Drive. Tokens come from the OAuth implicit flow (no refresh token) and last about an hour. Google discourages the implicit flow for new apps, so moving to an auth-code + PKCE flow is a later option (it needs no backend with `launchWebAuthFlow`).

## Content safety (escaping)

| Output | Method | Verified |
|---|---|---|
| In-page UI (cards, table, pills, menus, forms) | `escapeHtml` escapes `& < > " '`, so it is safe in text and quoted attributes | **P1** (was broken: a category containing `"` injected an `onmouseover` attribute into the page) + unit test |
| HTML / PDF-page / ZIP report | same `escapeHtml` | C12 |
| CSV | every cell quoted; `= + - @` tab/CR prefixed with `'` | C14 + unit test |
| XML, Excel | `xmlEscape` | C13, unit test |
| JSON | `JSON.stringify` | — |
| Markdown / Notion / Linear / Jira | raw text (formatting may break; not executable) | — |
| Toasts, labels, highlight text | `textContent` | source |

Exports never contain the API key or the OAuth token (P9).

## AI request handling

- Requests are made only from the background service worker, straight to the provider. There is no intermediary server. The key goes only in that provider's auth header (P2).
- The page address is reduced to origin + path in the background (`pageAddressForAi`) before anything is sent (P3).
- Errors are explained (P5): rejected key (401/403), unknown model (404), rate limit (429), provider busy (5xx/529), unreadable response, offline.
- Default models: Anthropic `claude-sonnet-4-6` (current per Anthropic's model list, Oct 2026), OpenAI `gpt-4o-mini`, OpenRouter `anthropic/claude-sonnet-4.5`. **Settings → Model** overrides the default, so a retired model can be replaced without an update. The OpenAI/OpenRouter defaults were not checked against those providers' current lists.
- The Anthropic call uses `anthropic-dangerous-direct-browser-access`, which Anthropic requires for browser-side calls; it means the user's own key lives in the browser (see storage above).

## Threat-model checklist

| Threat | Mitigation | Status |
|---|---|---|
| Hostile page injects script through note/category content rendered by DesignNote | attribute-safe escaping everywhere | ✅ fixed + P1 |
| Hostile page reads API key / token | stored in extension storage, never in the DOM or page storage; never sent to pages | ✅ |
| Hostile page reads notes while a panel is open | none yet (UI is in the page DOM) | ⚠️ documented; D9 |
| Hostile page fakes the consent dialog | `confirm()` runs in the content script's isolated world; the page can't override it | ✅ (source) |
| Hostile page triggers Enhance/Drive by script (`.click()` on our buttons) | the Enhance buttons and the Drive menu item act only on trusted user input (`event.isTrusted`: real click or keyboard) | ✅ fixed + P12 (before the fix, a script click sent the note) |
| Sensitive URL parameters sent to AI | origin + path only | ✅ P3 |
| Key leaks into exports, logs, errors | not exported, no logging, errors don't echo the key | ✅ P9 / source |
| Token kept after disconnect | revoked at Google + token and account deleted | ✅ P7 |
| Silent network on settings open | cached status only | ✅ P6 |
| Unneeded permissions | `activeTab`, `tabs` removed | ✅ P11 |
| CSV formula injection | prefixed `'` | ✅ C14 |
| Screenshots capture sensitive on-screen data | user-initiated; local only unless sent to Drive | ⚠️ inherent; documented |
| Extension update leaves broken UI | orphan guard + re-injection | ✅ E15/E16 |

## Open decisions for the owner

- **D8:** add "Delete all DesignNote data" in Settings (local only)?
- **D9:** move the in-page UI into a closed shadow root so page scripts and session-replay tools can't read open panels. This is a larger refactor of `content.css` scoping; it would also remove the `:root` token leak.
- **D10:** keep the implicit OAuth flow or move to auth-code + PKCE?
