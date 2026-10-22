chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'CAPTURE_SCREENSHOT') {
    const windowId = sender.tab ? sender.tab.windowId : chrome.windows.WINDOW_ID_CURRENT;
    chrome.tabs.captureVisibleTab(windowId, { format: 'png' }, (dataUrl) => {
      if (chrome.runtime.lastError) {
        sendResponse({ error: chrome.runtime.lastError.message });
        return;
      }
      sendResponse({ dataUrl });
    });
    return true; // async response
  }

  // The note form's "Send to" row: AI tools connected through the bridge right now
  // (on any site: a note sent to an agent is shared with that agent, see bridgeCall)
  if (msg.type === 'GET_AGENTS') {
    sendResponse({ agents: liveAgents() });
    return false;
  }

  if (msg.type === 'ENHANCE_PROMPT') {
    enhancePrompt(msg.payload)
      .then((enhancedPrompt) => sendResponse({ enhancedPrompt }))
      .catch((err) => sendResponse({ error: err.message }));
    return true; // async response
  }

  if (msg.type === 'UPLOAD_TO_DRIVE') {
    uploadToDrive(msg.payload)
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ error: err.message }));
    return true; // async response
  }

  if (msg.type === 'CHECK_DRIVE') {
    // interactive: false = silent status check (no consent popup); true = connect if needed.
    checkDrive(msg.interactive !== false)
      .then((info) => sendResponse(info))
      .catch((err) => sendResponse({ error: err.message }));
    return true; // async response
  }

  if (msg.type === 'DISCONNECT_DRIVE') {
    disconnectDrive()
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ error: err.message }));
    return true; // async response
  }

  if (msg.type === 'OPEN_OPTIONS') { // from the table's "Add apps…"
    chrome.tabs.create({ url: chrome.runtime.getURL('settings.html') + (msg.hash ? '#' + msg.hash : '') });
    return false;
  }

  if (msg.type === 'TAB_MESSAGE') {
    // From the popup: deliver msg.message to the tab's content script, injecting it if needed.
    sendToTab(msg.tabId, msg.message)
      .then((response) => sendResponse({ response }))
      .catch((err) => sendResponse({ error: err.message }));
    return true; // async response
  }
});

// Declared content scripts only run on page load, so tabs opened before install, or open
// during an extension reload/update, have none (or an orphaned one). Inject on demand.
// Pages extensions may not script (chrome://, the Web Store, file:// without access) reject.
async function sendToTab(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (e) {
    if (!/Receiving end does not exist/i.test(e.message)) throw e;
    await chrome.scripting.insertCSS({ target: { tabId }, files: ['design-tokens.css', 'content.css'] });
    await chrome.scripting.executeScript({ target: { tabId }, files: ['selector.js', 'prefs.js', 'content.js'] });
    return chrome.tabs.sendMessage(tabId, message);
  }
}

const COMMAND_MESSAGES = {
  'toggle-sidebar': [{ type: 'SHOW_PILL' }, { type: 'TOGGLE_SIDEBAR' }],
  'toggle-pill': [{ type: 'TOGGLE_PILL' }],
  'toggle-mark-mode': [{ type: 'TOGGLE_MARK_MODE' }],
};
async function runCommand(command) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id || !COMMAND_MESSAGES[command]) return;
  try {
    for (const m of COMMAND_MESSAGES[command]) await sendToTab(tab.id, m);
  } catch (e) {
    /* page can't be scripted (browser pages, Web Store) — nothing to show there */
  }
}
chrome.commands.onCommand.addListener(runCommand);

// First install only: open the Quickstart guide. A plain tab, nothing is sent.
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') chrome.tabs.create({ url: 'https://redlines.design/docs/quickstart' });
});

async function checkDrive(interactive) {
  if (!interactive) {
    // Status only, from what this browser already knows: opening Settings never contacts Google.
    const { dn_drive_account } = await chrome.storage.local.get('dn_drive_account');
    return dn_drive_account || {};
  }
  const token = await getDriveToken(interactive);
  // about?fields=user returns the signed-in account even under the drive.file scope.
  const res = await fetch('https://www.googleapis.com/drive/v3/about?fields=user', {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) await clearDriveToken();
    throw new Error((data.error && data.error.message) || `Could not read Drive account (HTTP ${res.status}).`);
  }
  const account = { email: data.user && data.user.emailAddress, name: data.user && data.user.displayName };
  await chrome.storage.local.set({ dn_drive_account: account }); // shown by the silent status check
  return account;
}

async function disconnectDrive() {
  const { dn_drive_token } = await chrome.storage.local.get('dn_drive_token');
  const token = dn_drive_token && dn_drive_token.access_token;
  if (token) {
    await fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(token), { method: 'POST' }).catch(() => {});
  }
  await chrome.storage.local.remove(['dn_drive_token', 'dn_drive_account']);
}

// Google Drive OAuth via chrome.identity.launchWebAuthFlow (manual flow): works with a
// "Web application" OAuth client whose client ID the user pastes in Settings and whose
// authorized redirect URI is chrome.identity.getRedirectURL(). Scope is drive.file — the
// extension can only touch files it creates. Implicit flow returns a ~1h access token (no
// refresh token), cached in storage; when it lapses we re-run the flow (silent while the
// Google session is still active via prompt=none, interactive otherwise).
// ponytail: implicit flow, no refresh token — swap for a backend + auth-code flow only if silent renewal beyond the session becomes a requirement.
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

async function getClientId() {
  const { dn_drive_client_id } = await chrome.storage.local.get('dn_drive_client_id');
  const id = (dn_drive_client_id || '').trim();
  if (!id) throw new Error('No Google OAuth client ID set. Add one in the extension settings.');
  return id;
}

function clearDriveToken() {
  return chrome.storage.local.remove('dn_drive_token');
}

function launchWebAuthFlow(url, interactive) {
  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({ url, interactive }, (redirect) => {
      if (chrome.runtime.lastError || !redirect) {
        reject(new Error(chrome.runtime.lastError ? chrome.runtime.lastError.message : 'Google sign-in was cancelled.'));
        return;
      }
      resolve(redirect);
    });
  });
}

async function getDriveToken(interactive) {
  const { dn_drive_token } = await chrome.storage.local.get('dn_drive_token');
  // Reuse a cached token with >60s of life left.
  if (dn_drive_token && dn_drive_token.expiry > Date.now() + 60000) {
    return dn_drive_token.access_token;
  }
  const clientId = await getClientId();
  const authUrl =
    'https://accounts.google.com/o/oauth2/v2/auth' +
    '?client_id=' + encodeURIComponent(clientId) +
    '&response_type=token' +
    '&redirect_uri=' + encodeURIComponent(chrome.identity.getRedirectURL()) +
    '&scope=' + encodeURIComponent(DRIVE_SCOPE) +
    (interactive ? '' : '&prompt=none');
  const redirect = await launchWebAuthFlow(authUrl, interactive);
  const params = new URLSearchParams(redirect.slice(redirect.indexOf('#') + 1));
  const token = params.get('access_token');
  if (!token) throw new Error(params.get('error') || 'Google sign-in failed.');
  const expiresIn = parseInt(params.get('expires_in') || '3600', 10);
  await chrome.storage.local.set({
    dn_drive_token: { access_token: token, expiry: Date.now() + expiresIn * 1000 },
  });
  return token;
}

async function uploadToDrive({ filename, base64, mimeType }) {
  const token = await getDriveToken(true);

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  // multipart/related: JSON metadata part + the raw .xlsx bytes part
  const boundary = 'dn-' + Math.random().toString(36).slice(2);
  const enc = new TextEncoder();
  const head = enc.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
      JSON.stringify({ name: filename, mimeType }) +
      `\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`
  );
  const tail = enc.encode(`\r\n--${boundary}--`);
  const body = new Uint8Array(head.length + bytes.length + tail.length);
  body.set(head, 0);
  body.set(bytes, head.length);
  body.set(tail, head.length + bytes.length);

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    }
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Stale/revoked token: drop it from Chrome's cache so the next attempt re-auths.
    if (res.status === 401) await clearDriveToken();
    throw new Error((data.error && data.error.message) || `Drive upload failed (HTTP ${res.status}).`);
  }
  return { fileId: data.id, name: data.name, link: data.webViewLink };
}

// Defaults per provider; Settings can override the model (model IDs get retired).
const AI_PROVIDERS = {
  anthropic: {
    name: 'Anthropic',
    url: 'https://api.anthropic.com/v1/messages',
    model: 'claude-sonnet-4-6',
    headers: (key) => ({ 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }),
    body: (model, system, user) => ({ model, max_tokens: 300, system, messages: [{ role: 'user', content: user }] }),
    text: (data) => (data.content || []).map((b) => b.text || '').join(''),
  },
  openai: {
    name: 'OpenAI',
    url: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-4o-mini',
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
    body: (model, system, user) => ({ model, max_tokens: 300, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
    text: (data) => (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '',
  },
  openrouter: {
    name: 'OpenRouter',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    model: 'anthropic/claude-sonnet-4.5',
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
    body: (model, system, user) => ({ model, max_tokens: 300, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
    text: (data) => (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '',
  },
};

// Only the page's origin + path go to the provider: query strings and #fragments often
// carry session IDs, tokens or personal data.
function pageAddressForAi(url) {
  try {
    const u = new URL(url);
    return u.origin + u.pathname;
  } catch (e) {
    return '';
  }
}

// One request with errors a person can act on. Error bodies are JSON on all three
// providers ({ error: { message } }), but proxies and outages return HTML.
async function callProvider(p, model, init) {
  let res;
  try {
    res = await fetch(p.url, init);
  } catch (e) {
    throw new Error(`Couldn't reach ${p.name}. Check your internet connection and try again.`);
  }
  const data = await res.json().catch(() => null);
  if (res.ok && data) return data;
  const detail = data && data.error && (data.error.message || (typeof data.error === 'string' ? data.error : ''));
  if (res.status === 401 || res.status === 403) throw new Error(`${p.name} rejected the API key. Check it in Redlines Settings.`);
  if (res.status === 404) throw new Error(`${p.name} didn't accept the model "${model}". Change the model in Redlines Settings.`);
  if (res.status === 429) throw new Error(`${p.name} rate limit reached. Wait a moment and try again.`);
  if (res.status >= 500 || res.status === 529) throw new Error(`${p.name} is busy or unavailable right now (HTTP ${res.status}). Try again shortly.`);
  if (res.ok) throw new Error(`${p.name} sent a response Redlines couldn't read. Try again.`);
  throw new Error(`${p.name} request failed (HTTP ${res.status})${detail ? ': ' + detail : '.'}`);
}

async function enhancePrompt(payload) {
  const settings = await chrome.storage.local.get(['dn_provider', 'dn_api_key', 'dn_model']);
  const p = AI_PROVIDERS[settings.dn_provider || 'anthropic'];
  if (!p) throw new Error('Unknown provider selected in settings.');
  const apiKey = settings.dn_api_key;
  if (!apiKey) throw new Error('No API key set. Add one in the extension settings.');
  const model = (settings.dn_model || '').trim() || p.model;

  const systemPrompt =
    'You turn short designer annotations into a single, clear, actionable instruction for an AI coding assistant to implement. ' +
    'Be specific and concrete. Mention the element/selector if given. Output ONLY the rewritten instruction, no preamble.';

  const userContent = [
    `Annotation type: ${payload.annotationType}`,
    `Raw comment: ${payload.text}`,
    payload.selector ? `Element selector: ${payload.selector}` : 'Element selector: (none — general page note)',
    `Page URL: ${pageAddressForAi(payload.url)}`,
  ].join('\n');

  const data = await callProvider(p, model, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, p.headers(apiKey)),
    body: JSON.stringify(p.body(model, systemPrompt, userContent)),
  });
  return p.text(data).trim() || 'Could not generate a prompt.';
}

// ---------- AI agent bridge (Settings → Connect to AI agents) ----------
// The local MCP server (mcp/redlines-mcp.js, started by the user's AI tool) listens on
// 127.0.0.1; this worker connects out to it, proves the pairing token, then answers its calls.
// Off by default. Everything about the data is enforced here, not in the server: only notes from
// shared sites, screenshots only if allowed, changes only if allowed, every call logged.
const NOTE_PREFIX = 'dn_annotations::';
const BRIDGE_DEFAULT_PORT = 17337;
const DEFAULT_BRIDGE_SITES = 'localhost 127.0.0.1 *.localhost *.local *.test staging.* dev.*';
const BRIDGE_KEYS = ['dn_bridge_enabled', 'dn_bridge_token', 'dn_bridge_sites', 'dn_bridge_write', 'dn_bridge_screenshots', 'dn_bridge_port'];
// Each AI tool starts its own server on the next free port from the base (mcp/redlines-mcp.js
// PORT_RANGE), so we connect to every port in the range. Each server says which tool it belongs to.
// ponytail: probes up to 10 closed loopback ports every 30 s (console noise only); a port-file handshake if that matters.
const BRIDGE_PORT_RANGE = 10;
const bridges = new Map(); // port → { ws, ok, agent, since, calls, busy, lastAt, seen, assigned }

function setBridgeStatus(status) {
  chrome.storage.session.set({ dn_bridge_status: status }).catch(() => {});
}

// The AI tools connected right now, one per kind (two Claude Code sessions are one "Claude Code"
// with sessions: 2), plus live activity for the popup: busy = requests in flight right now,
// seen / assigned = notes it could read / open notes sent to it, as of its last request.
function liveAgents() {
  const byId = new Map();
  for (const l of bridges.values()) {
    if (!l.ok || !l.agent) continue;
    const a = byId.get(l.agent.id);
    if (!a) {
      byId.set(l.agent.id, { ...l.agent, sessions: 1, since: l.since, calls: l.calls, busy: l.busy, lastAt: l.lastAt, seen: l.seen, assigned: l.assigned });
      continue;
    }
    a.sessions++;
    a.since = Math.min(a.since, l.since);
    a.calls += l.calls;
    a.busy += l.busy;
    if (l.lastAt > a.lastAt) Object.assign(a, { lastAt: l.lastAt, seen: l.seen, assigned: l.assigned });
  }
  return [...byId.values()];
}
function publishAgents() {
  chrome.storage.session.set({ dn_bridge_agents: liveAgents() }).catch(() => {});
  if ([...bridges.values()].some((l) => l.ok)) return setBridgeStatus('connected');
  chrome.storage.session.get('dn_bridge_status').then((r) => {
    if (r.dn_bridge_status !== 'bad-token') setBridgeStatus('waiting'); // no AI tool running the bridge yet
  }).catch(() => {});
}

async function connectBridge() {
  const s = await chrome.storage.local.get(BRIDGE_KEYS);
  if (!s.dn_bridge_enabled || !s.dn_bridge_token) return setBridgeStatus('off');
  const base = Number(s.dn_bridge_port) || BRIDGE_DEFAULT_PORT;
  for (let port = base; port < base + BRIDGE_PORT_RANGE; port++) if (!bridges.has(port)) openBridge(port, s.dn_bridge_token);
}

function openBridge(port, token) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/redlines`);
  const link = { ws, ok: false, agent: null, since: 0, calls: 0, busy: 0, lastAt: 0, seen: null, assigned: null };
  bridges.set(port, link);
  let keepalive = 0;
  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'hello', token }));
    // Messages every 20 s keep the MV3 worker alive while an AI tool is connected.
    keepalive = setInterval(() => ws.readyState === 1 && ws.send('{"type":"keepalive"}'), 20000);
  };
  ws.onmessage = async (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch (err) { return; }
    if (msg.type === 'welcome') { link.ok = true; link.since = Date.now(); return publishAgents(); }
    if (msg.type === 'agent' && msg.agent) {
      // Shown in pages and used as an icon path: keep it plain
      const id = String(msg.agent.id || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40) || 'agent';
      link.agent = { id, name: String(msg.agent.name || 'AI agent').slice(0, 60) };
      return publishAgents();
    }
    if (msg.type === 'error') return setBridgeStatus('bad-token');
    if (msg.type !== 'call') return;
    link.calls++;
    link.busy++;
    link.lastAt = Date.now();
    publishAgents(); // the popup shows this agent working
    let reply;
    try { reply = { type: 'reply', id: msg.id, result: await bridgeCall(msg.op, msg.args || {}, link) }; }
    catch (err) { reply = { type: 'reply', id: msg.id, error: err.message }; }
    link.busy--;
    link.lastAt = Date.now();
    publishAgents();
    if (ws.readyState === 1) ws.send(JSON.stringify(reply));
  };
  ws.onclose = () => {
    clearInterval(keepalive);
    if (bridges.get(port) !== link) return;
    bridges.delete(port);
    if (link.ok) publishAgents();
  };
}
function closeBridges() {
  const old = [...bridges.values()];
  bridges.clear();
  old.forEach((l) => l.ws.close());
  chrome.storage.session.set({ dn_bridge_agents: [] }).catch(() => {});
}

function bridgeSiteMatcher(list) {
  const pats = String(list == null ? DEFAULT_BRIDGE_SITES : list).toLowerCase().split(/[\s,]+/).filter(Boolean);
  return (url) => {
    let u;
    try { u = new URL(url); } catch (e) { return false; }
    if (u.protocol === 'file:') return pats.includes('file');
    if (!/^https?:$/.test(u.protocol)) return false;
    const host = u.hostname;
    return pats.some((p) => p === host || (p.startsWith('*.') && host.endsWith(p.slice(1))) ||
      (p.endsWith('.*') && host.startsWith(p.slice(0, -1))));
  };
}

// `agent` = the agent id that asked, so the popup can show each agent's own recent requests.
async function bridgeLog(action, detail, agent) {
  const { dn_bridge_log = [] } = await chrome.storage.local.get('dn_bridge_log');
  dn_bridge_log.unshift({ at: Date.now(), action, detail: String(detail || '').slice(0, 120), agent: agent || undefined });
  await chrome.storage.local.set({ dn_bridge_log: dn_bridge_log.slice(0, 50) });
}

// `link` = the connection asking; `caller` its agent. A note the user sent to it is visible to it
// (and only to it) even when its site isn't shared: sending is the user sharing that one note.
async function bridgeCall(op, args, link) {
  const caller = link && link.agent;
  const log = (action, detail) => bridgeLog(action, detail, caller && caller.id);
  const s = await chrome.storage.local.get(BRIDGE_KEYS);
  if (!s.dn_bridge_enabled) throw new Error('AI agent access is switched off in Redlines settings.');
  const shared = bridgeSiteMatcher(s.dn_bridge_sites);
  const screenshots = s.dn_bridge_screenshots !== false;
  const all = await chrome.storage.local.get(null);
  const notes = [];
  for (const [k, list] of Object.entries(all)) {
    if (!k.startsWith(NOTE_PREFIX)) continue;
    const siteShared = shared(k.slice(NOTE_PREFIX.length));
    for (const a of list || []) {
      if (siteShared || (caller && a.assignee && a.assignee.id === caller.id)) notes.push({ ...a, pageUrl: k.slice(NOTE_PREFIX.length) });
    }
  }
  if (link) {
    link.seen = notes.length;
    link.assigned = notes.filter((n) => caller && n.assignee && n.assignee.id === caller.id && (n.status || 'open') === 'open').length;
  }
  const find = (id) => {
    const n = notes.find((x) => x.id === id);
    if (!n) throw new Error(`No note with id "${id}" on a site shared with AI agents.`);
    return n;
  };

  if (op === 'list') {
    await log('Listed notes', `${notes.length} note${notes.length === 1 ? '' : 's'}`);
    return notes.map(({ screenshot, fingerprint, ...n }) => ({ ...n, hasScreenshot: !!screenshot && screenshots }));
  }
  if (op === 'get') {
    const { fingerprint, ...n } = find(args.id);
    if (!screenshots) delete n.screenshot;
    await log('Read a note', n.text);
    return n;
  }
  if (op === 'current') {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const url = tab && tab.url ? tab.url.split('#')[0] : '';
    if (!url || !shared(url)) return { allowed: false };
    await log('Checked the open page', new URL(url).host);
    return { allowed: true, url, title: tab.title };
  }
  if (op === 'show') {
    const n = find(args.id);
    await showNoteInTab(n);
    await log('Showed a note', n.text);
    return { shown: true, url: n.pageUrl };
  }
  if (op === 'write') {
    if (!s.dn_bridge_write) throw new Error('AI agents can read Redlines notes but not change them. The user can allow changes in Redlines settings → Connect to AI agents.');
    return bridgeWrite(args, find, shared, log);
  }
  throw new Error('Unknown request: ' + op);
}

async function bridgeWrite(args, find, shared, log) {
  const text = typeof args.text === 'string' ? args.text.trim().slice(0, 4000) : '';
  const now = Date.now();
  if (args.op === 'add') {
    let url;
    try { url = new URL(args.url); } catch (e) { throw new Error('add_annotation needs a full page URL, e.g. http://localhost:3000/checkout'); }
    const pageUrl = url.href.split('#')[0];
    if (!shared(pageUrl)) throw new Error('That site is not shared with AI agents in Redlines settings.');
    if (!text) throw new Error('The note needs some text.');
    const note = {
      id: 'dn_' + now + '_' + Math.random().toString(36).slice(2, 8),
      type: args.category ? String(args.category).trim().slice(0, 40) : 'note',
      text,
      selector: typeof args.selector === 'string' && args.selector.trim() ? args.selector.trim().slice(0, 1000) : null,
      fingerprint: null, rect: null, screenshot: null,
      timestamp: now, source: 'ai', status: 'open',
    };
    const key = NOTE_PREFIX + pageUrl;
    const { [key]: list = [] } = await chrome.storage.local.get(key);
    await chrome.storage.local.set({ [key]: list.concat(note) });
    await log('Added a note', text);
    return { id: note.id, url: pageUrl };
  }
  const key = NOTE_PREFIX + find(args.id).pageUrl;
  const { [key]: list = [] } = await chrome.storage.local.get(key);
  const a = list.find((x) => x.id === args.id);
  if (!a) throw new Error('That note was just deleted.');
  if (args.op === 'resolve') {
    Object.assign(a, { status: 'resolved', resolvedAt: now, resolvedBy: 'ai' });
    if (text) a.replies = (a.replies || []).concat({ by: 'ai', text, at: now });
  } else if (args.op === 'reopen') {
    a.status = 'open';
    delete a.resolvedAt;
    delete a.resolvedBy;
  } else if (args.op === 'reply') {
    if (!text) throw new Error('The reply needs some text.');
    a.replies = (a.replies || []).concat({ by: 'ai', text, at: now });
  } else {
    throw new Error('Unknown change: ' + args.op);
  }
  a.updatedAt = now;
  await chrome.storage.local.set({ [key]: list });
  await log({ resolve: 'Resolved a note', reopen: 'Reopened a note', reply: 'Replied to a note' }[args.op], a.text);
  return { id: a.id, status: a.status || 'open' };
}

async function showNoteInTab(n) {
  const tabs = await chrome.tabs.query({});
  let tab = tabs.find((t) => t.url && t.url.split('#')[0] === n.pageUrl);
  if (tab) {
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
  } else {
    tab = await chrome.tabs.create({ url: n.pageUrl });
  }
  if (tab.status !== 'complete') {
    await new Promise((resolve) => {
      const done = () => { chrome.tabs.onUpdated.removeListener(onUpd); clearTimeout(t); resolve(); };
      const onUpd = (id, info) => { if (id === tab.id && info.status === 'complete') done(); };
      const t = setTimeout(done, 15000);
      chrome.tabs.onUpdated.addListener(onUpd);
    });
  }
  await sendToTab(tab.id, { type: 'JUMP_TO_ANNOTATION', id: n.id });
}

// Reconnect: on worker start, every 30 s while enabled (the AI tool may start later), and on settings changes.
function syncBridgeAlarm(enabled) {
  if (enabled) chrome.alarms.create('dn-bridge', { periodInMinutes: 0.5 });
  else chrome.alarms.clear('dn-bridge');
}
chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === 'dn-bridge') connectBridge(); });
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.dn_bridge_enabled || changes.dn_bridge_token || changes.dn_bridge_port) {
    closeBridges();
    chrome.storage.local.get('dn_bridge_enabled').then((r) => {
      syncBridgeAlarm(!!r.dn_bridge_enabled);
      setBridgeStatus(r.dn_bridge_enabled ? 'waiting' : 'off');
      connectBridge();
    });
  }
});
chrome.storage.session.set({ dn_bridge_agents: [] }).catch(() => {}); // a fresh worker has no connections yet
chrome.storage.local.get('dn_bridge_enabled').then((r) => { syncBridgeAlarm(!!r.dn_bridge_enabled); connectBridge(); });

// ---------- Toolbar icon in the accent colour (Settings → Accent colour, dn_appearance.accent) ----------
// The mark from brand/logo/burst/redlines-burst.svg (48×48) on the app-icon square; the last path is
// the arrow, painted in the accent. The default accent keeps the shipped PNGs.
const ICON_MARK = [
  ["M22.9458 5.08569C23.8776 4.07538 25.3776 3.70134 26.7218 4.25862L33.0551 6.88095C33.501 7.06553 33.8857 7.33531 34.1994 7.66271L36.2172 9.68044C36.475 9.92953 36.6886 10.2164 36.8537 10.5281C37.1664 10.6933 37.4536 10.9082 37.7034 11.1667L39.7253 13.1886C40.0511 13.5017 40.319 13.8855 40.5029 14.3298L43.1263 20.6631C43.6836 22.0076 43.3069 23.5053 42.2961 24.437L42.3733 24.5142C43.3258 25.4499 43.6692 26.9053 43.1263 28.2149L40.5029 34.5483C40.2569 35.1424 39.8581 35.6249 39.374 35.9779L41.055 38.1697L41.1528 38.3036C42.1179 39.7037 41.8266 41.6301 40.4596 42.679L40.4607 42.68L39.6078 43.3351C38.195 44.42 36.1773 44.1456 35.0986 42.7428L35.0965 42.7408L33.4506 40.5964L33.1293 40.7292C32.5207 41.3302 31.7321 41.6244 30.9416 41.6346L28.8312 42.5101C27.5215 43.053 26.0662 42.7095 25.1304 41.7571L25.0532 41.6799C24.1215 42.6907 22.6238 43.0674 21.2793 42.5101L14.946 39.8867C14.5017 39.7028 14.1179 39.4349 13.8048 39.1091L11.7829 37.0872C11.5244 36.8374 11.3095 36.5502 11.1443 36.2375C10.8326 36.0724 10.5457 35.8588 10.2966 35.6009L8.27892 33.5832C7.95152 33.2695 7.68174 32.8848 7.49716 32.4389L4.87483 26.1055C4.31756 24.7613 4.69159 23.2614 5.7019 22.3296L5.60509 22.2328C4.66892 21.2964 4.33595 19.8536 4.87483 18.5537L7.49716 12.2204C8.05382 10.8757 9.37975 10.0815 10.754 10.1378C10.6978 8.76354 11.4919 7.43761 12.8366 6.88095L19.1699 4.25862C20.4698 3.71974 21.9126 4.05374 22.849 4.98991L22.9458 5.08569Z", "#0b0b0b"],
  ["M24.4544 6.97172C24.677 6.43396 25.2937 6.17874 25.8325 6.40111L32.1659 9.02551C32.7038 9.24805 32.959 9.86469 32.7365 10.4026L31.2255 14.0467L34.8716 12.5377C35.4095 12.3152 36.0262 12.5705 36.2487 13.1084L38.8731 19.4417C39.0955 19.9806 38.8403 20.5973 38.3025 20.8198L34.6584 22.3287L38.3025 23.8387C38.8403 24.0612 39.0955 24.6779 38.8731 25.2168L36.2487 31.5502C36.0262 32.0881 35.4095 32.3433 34.8716 32.1208L31.2265 30.6108L32.7365 34.2559C32.959 34.7938 32.7038 35.4105 32.1659 35.633L25.8325 38.2574C25.2937 38.4798 24.677 38.2246 24.4544 37.6868L22.9445 34.0427L21.4355 37.6868C21.213 38.2246 20.5963 38.4798 20.0574 38.2574L13.7241 35.633C13.1862 35.4105 12.9309 34.7938 13.1535 34.2559L14.6624 30.6108L11.0183 32.1208C10.4804 32.3433 9.86377 32.0881 9.64123 31.5502L7.01684 25.2168C6.79447 24.6779 7.04969 24.0612 7.58745 23.8387L11.2315 22.3287L7.58745 20.8198C7.04968 20.5973 6.79446 19.9806 7.01684 19.4417L9.64123 13.1084C9.86377 12.5705 10.4804 12.3152 11.0183 12.5377L14.6624 14.0467L13.1535 10.4026C12.9309 9.86469 13.1862 9.24805 13.7241 9.02551L20.0574 6.40111C20.5963 6.17873 21.213 6.43396 21.4355 6.97172L22.9445 10.6158L24.4544 6.97172Z", "#ffffff"],
  ["M13.7365 22.3293C15.3245 18.6552 18.9442 16.2772 22.9458 16.2769C26.9474 16.2767 30.5675 18.6554 32.1548 22.329C30.5668 26.0031 26.9471 28.381 22.9455 28.3813C18.9438 28.3816 15.3237 26.0029 13.7365 22.3293Z", "#0b0b0b"],
  ["M22.9454 18.7432C23.3282 20.7513 24.5232 21.9463 26.5313 22.3291C24.5232 22.712 23.3282 23.907 22.9454 25.9151C22.5625 23.907 21.3675 22.712 19.3594 22.3291C21.3675 21.9463 22.5625 20.7513 22.9454 18.7432Z", "#ffffff"],
];
const ICON_ARROW = "M28.132 25.8421C27.2423 25.3141 26.1751 26.1562 26.4408 27.1775L29.3484 38.3394C29.5699 39.1909 30.6801 39.341 31.1085 38.5779L32.2345 36.5714C32.4402 36.205 32.9411 36.1713 33.192 36.5063L36.761 41.2928C37.0843 41.7255 37.688 41.8081 38.1085 41.4754L39.0231 40.7531C39.4447 40.4204 39.5239 39.8004 39.2005 39.3665L35.6576 34.6149C35.401 34.2706 35.5785 33.7681 35.99 33.6751L37.4743 33.3377C38.3142 33.147 38.4872 31.9943 37.7422 31.5522L28.132 25.8421Z";
function drawToolbarIcon(size, accent) {
  const ctx = new OffscreenCanvas(size, size).getContext('2d');
  ctx.scale(size / 512, size / 512);
  ctx.fillStyle = '#0b0b0b';
  ctx.beginPath();
  ctx.roundRect(0, 0, 512, 512, 115);
  ctx.fill();
  ctx.translate(64, 64);
  ctx.scale(8, 8);
  for (const [d, fill] of [...ICON_MARK, [ICON_ARROW, accent]]) {
    ctx.fillStyle = fill;
    ctx.fill(new Path2D(d));
  }
  return ctx.getImageData(0, 0, size, size);
}
function applyToolbarIcon(appearance) {
  const accent = /^#[0-9a-f]{6}$/i.test(appearance && appearance.accent) ? appearance.accent.toLowerCase() : '#00e5ff';
  const icon = accent === '#00e5ff'
    ? { path: { 16: 'icons/icon16.png', 32: 'icons/icon32.png' } }
    : { imageData: { 16: drawToolbarIcon(16, accent), 32: drawToolbarIcon(32, accent) } };
  chrome.action.setIcon(icon).catch(() => {});
}
chrome.storage.local.get('dn_appearance').then((r) => applyToolbarIcon(r.dn_appearance));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.dn_appearance) applyToolbarIcon(changes.dn_appearance.newValue);
});
