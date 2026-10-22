// Phase 3 privacy & trust checks in real Chrome. Fully offline: the extension service
// worker's fetch() and chrome.identity.launchWebAuthFlow are replaced with recording
// mocks, so no request ever reaches an AI provider or Google. No real keys or accounts.
//
//   node tests/browser-privacy.js [extensionDir]     (HEADED=1 / CHROME_PATH as in browser-smoke.js)
const fs = require('fs');
const http = require('http');
const path = require('path');
const { launch, recorder, sleep, poll } = require('./lib/cdp');

const EXT = path.resolve(process.argv[2] || path.join(__dirname, '..', '..'));
const FAKE_KEY = 'test-not-a-real-key-123';
const FAKE_TOKEN = 'ya29.fake-token-for-tests';
const { results, record } = recorder();
let h;

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Privacy</title></head><body>
<h1 id="title">Private page</h1><p id="p">Text</p></body></html>`;
const server = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(PAGE); });
const ev = (...a) => h.ev(...a);

// Installs the mocks in the service worker. `responses` maps a URL prefix to a mock
// response {status, body, json} or {fail: true} (network error). Every call is recorded.
async function mockNetwork(responses) {
  await ev(h.sw, `(() => {
    self.__calls = []; self.__authCalls = [];
    const responses = ${JSON.stringify(responses)};
    self.fetch = async (url, init = {}) => {
      const headers = Object.assign({}, init.headers || {});
      const body = typeof init.body === 'string' ? init.body : (init.body ? '[binary ' + (init.body.byteLength || init.body.length) + ' bytes]' : null);
      self.__calls.push({ url: String(url), method: init.method || 'GET', headers, body });
      const key = Object.keys(responses).find((p) => String(url).startsWith(p));
      const r = responses[key] || { status: 404, body: 'no mock' };
      if (r.fail) throw new TypeError('Failed to fetch');
      return new Response(r.json ? JSON.stringify(r.json) : r.body, { status: r.status || 200, headers: { 'content-type': r.json ? 'application/json' : 'text/html' } });
    };
    chrome.identity.launchWebAuthFlow = (opts, cb) => { self.__authCalls.push(opts.url); cb(undefined); };
    return true; })()`);
}
// Backstop so a restarted worker (which loses the fetch mock) can never reach a real
// service: the browser blocks every external host for the worker, and any attempt fails the run.
const externalAttempts = [];
const swEvents = [];
async function guardNetwork() {
  await h.cdp.send('Network.setBlockedURLs', { urls: ['https://*', 'http://*.com/*', 'http://*.org/*'] }, h.sw);
  h.cdp.listeners.push((m) => {
    if (m.method === 'Network.requestWillBeSent' && m.sessionId === h.sw && !/^(chrome-extension|data|blob):/.test(m.params.request.url)) externalAttempts.push(m.params.request.url);
    if (m.method === 'Target.detachedFromTarget' && m.params.sessionId === h.sw) swEvents.push('service worker detached');
  });
}
// Real mouse click on an element found by a JS expression (outbound actions ignore script clicks)
async function userClick(session, expr) {
  const [cx, cy] = await ev(session, `(() => { const r = (${expr}).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
  await h.realClick(session, cx, cy);
}
const ENHANCE_BTN = `document.querySelector('.dn-card [data-act="enhance"]')`;
const DRIVE_ITEM = `[...document.querySelectorAll('.dn-action-menu-item')].find(b => /Google Drive/.test(b.textContent))`;
const calls = () => ev(h.sw, 'self.__calls');
const authCalls = () => ev(h.sw, 'self.__authCalls');

async function main() {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const url = base + '/page.html?session=SECRET123&user=alice#frag';
  h = await launch({ ext: EXT, prefix: 'dn-privacy-' });
  console.log(`Browser: ${h.version}  Extension dir: ${EXT}`);
  await guardNetwork();

  // Auto-accept (and record) any confirm()/alert() a page shows
  const dialogs = [];
  h.cdp.listeners.push((m) => {
    if (m.method === 'Page.javascriptDialogOpening') {
      dialogs.push(m.params.message);
      h.cdp.send('Page.handleJavaScriptDialog', { accept: true }, m.sessionId).catch((e) => console.log('(dialog accept failed: ' + e.message + ')'));
    }
  });

  await ev(h.sw, `chrome.storage.local.set({ dn_provider: 'anthropic', dn_api_key: ${JSON.stringify(FAKE_KEY)} }).then(() => true)`);
  const { s, targetId } = await h.openPage(url);

  // A note with hostile content: attribute breakout in the category, markup in the text
  const HOSTILE_CAT = 'x" onmouseover="window.__pwned=1" data-x="';
  const HOSTILE_TEXT = '<img src=x onerror="window.__pwned2=1"> & "quotes"';
  await h.domClick(s, '#designnote-mode-btn');
  const [x, y] = await h.center(s, '#title');
  await h.realClick(s, x, y);
  await poll(() => ev(s, `!!document.querySelector('#designnote-popup-form')`), 3000);
  await ev(s, `(() => { const f = document.querySelector('#designnote-popup-form');
    f.querySelector('#dn-new-category-btn').click();
    const inp = f.querySelector('#dn-custom-category-input'); inp.value = ${JSON.stringify(HOSTILE_CAT)};
    inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    f.querySelector('#dn-text-input').value = ${JSON.stringify(HOSTILE_TEXT)}; f.querySelector('.dn-form-save').click(); return true; })()`);
  const tSave = Date.now();
  const saved = await poll(async () => Object.entries(await h.storage()).some(([k, v]) => k.startsWith('dn_annotations::') && v.length), 10000);
  console.log(`(note saved: ${!!saved} after ${Date.now() - tSave}ms)`);
  // ---------- P1 hostile note content never becomes markup/handlers ----------
  await h.domClick(s, '#designnote-toggle-btn');
  await sleep(400);
  // Re-open the form so the hostile category is rendered as a pill, then the edit form
  await h.domClick(s, '#dn-add-note-btn');
  await sleep(300);
  await ev(s, `document.querySelector('.dn-card [data-act="edit"]').click(); true`);
  await sleep(300);
  await h.domClick(s, '#dn-table-btn');
  await sleep(400);
  const injected = await ev(s, `(() => {
    const all = [...document.querySelectorAll('#designnote-root *')];
    return { handlers: all.filter(e => [...e.attributes].some(a => /^on/i.test(a.name))).map(e => e.tagName + ':' + [...e.attributes].map(a => a.name).join(',')).slice(0, 5),
             strayImg: all.filter(e => e.tagName === 'IMG' && e.getAttribute('src') === 'x').length,
             pwned: !!(window.__pwned || window.__pwned2) }; })()`);
  record('P1', 'hostile category/text render as text everywhere (no handler attributes, no injected <img>)',
    injected.handlers.length === 0 && injected.strayImg === 0 && !injected.pwned, JSON.stringify(injected));
  await ev(s, `(document.querySelector('#designnote-edit-form') || { remove() {} }).remove(); (document.querySelector('#designnote-popup-form') || { remove() {} }).remove(); true`);
  await h.domClick(s, '#dn-table-close-btn');

  // ---------- P2 Enhance sends only what it should, only to the provider ----------
  await mockNetwork({ 'https://api.anthropic.com/': { status: 200, json: { content: [{ type: 'text', text: 'Rewritten prompt' }] } } });
  dialogs.length = 0;
  await h.domClick(s, '#designnote-toggle-btn');
  await ev(s, `document.getElementById('designnote-sidebar').classList.remove('dn-compact'); true`); // card actions visible
  await sleep(700);
  await userClick(s, ENHANCE_BTN);
  await poll(async () => (await calls()).length > 0, 8000);
  await sleep(300);
  let c = await calls();
  const req = c[0] || {};
  const reqBody = req.body || '';
  record('P2', 'Enhance: one request, to the provider only, key only in its auth header',
    c.length === 1 && req.url.startsWith('https://api.anthropic.com/') && req.headers['x-api-key'] === FAKE_KEY && !reqBody.includes(FAKE_KEY),
    `${c.length} call(s) → ${c.map((x) => x.url).join(', ')}`);
  record('P3', 'Enhance payload: no screenshot, page address without query string or #fragment',
    !!reqBody && !/data:image/.test(reqBody) && !reqBody.includes('SECRET123') && !reqBody.includes('#frag') && reqBody.includes(base + '/page.html'),
    reqBody.slice(0, 200).replace(/\s+/g, ' '));
  record('P4', 'first Enhance asks before sending anything to the AI provider', dialogs.length === 1 && /send|provider|AI/i.test(dialogs[0] || ''), dialogs[0] ? dialogs[0].slice(0, 160) : 'no dialog');

  // ---------- P5 Enhance error messages are understandable ----------
  const toastAfterEnhance = async () => {
    await ev(s, `document.querySelectorAll('.dn-toast').forEach(t => t.remove()); true`);
    await userClick(s, ENHANCE_BTN);
    return poll(() => ev(s, `(() => { const t = [...document.querySelectorAll('.dn-toast')].map(t => t.textContent).filter(t => !/^Enhancing/.test(t)); return t.join(' | '); })()`), 4000);
  };
  const cases = {
    'bad key (401)': { status: 401, json: { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } } },
    'overloaded (529)': { status: 529, json: { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } } },
    'HTML 502 page': { status: 502, body: '<html><body>Bad gateway</body></html>' },
    'offline': { fail: true },
  };
  const errorToasts = {};
  for (const [name, resp] of Object.entries(cases)) {
    await mockNetwork({ 'https://api.anthropic.com/': resp });
    errorToasts[name] = await toastAfterEnhance();
  }
  const readable = (t) => t && !/Unexpected token|JSON|Failed to fetch|undefined/i.test(t);
  record('P5', 'Enhance failures explain themselves (key rejected / busy / unreachable)', Object.values(errorToasts).every(readable)
    && /key/i.test(errorToasts['bad key (401)']) && /busy|overloaded|try again/i.test(errorToasts['overloaded (529)']),
    JSON.stringify(errorToasts));

  // ---------- P6 opening Settings makes no network or sign-in calls ----------
  await mockNetwork({});
  await ev(h.sw, `chrome.storage.local.set({ dn_drive_client_id: 'fake-client.apps.googleusercontent.com', dn_drive_token: { access_token: ${JSON.stringify(FAKE_TOKEN)}, expiry: Date.now() + 3600e3 }, dn_drive_account: { email: 'someone@example.com' } }).then(() => true)`);
  const opt = await h.openPage(`chrome-extension://${h.extId}/settings.html`, { waitPill: false });
  const optStatus = await poll(async () => { const t = await ev(opt.s, `document.getElementById('drive-status').textContent`); return /Checking/.test(t) ? '' : t; }, 5000) || 'still checking';
  c = await calls();
  const a = await authCalls();
  record('P6', 'opening Settings: no network or Google sign-in calls; status from the cached connection', c.length === 0 && a.length === 0 && /someone@example\.com/.test(optStatus),
    `fetch=${c.length} auth=${a.length} status="${optStatus}"`);

  // ---------- P7 Disconnect revokes and forgets ----------
  await mockNetwork({ 'https://oauth2.googleapis.com/revoke': { status: 200, json: {} } });
  await ev(opt.s, `document.getElementById('drive-disconnect').click(); true`);
  await sleep(800);
  c = await calls();
  const st = await h.storage();
  record('P7', 'Disconnect revokes the token at Google and removes token + account locally',
    c.length === 1 && c[0].url.includes('oauth2.googleapis.com/revoke') && c[0].url.includes(encodeURIComponent(FAKE_TOKEN)) && !st.dn_drive_token && !st.dn_drive_account,
    `calls=${c.map((x) => x.url.replace(FAKE_TOKEN, '<token>')).join(', ')} token=${!!st.dn_drive_token} account=${!!st.dn_drive_account}`);
  await h.cdp.send('Target.closeTarget', { targetId: opt.targetId });

  // ---------- P8 Drive upload: asks first, sends the xlsx only to Google with the token ----------
  await ev(h.sw, `chrome.storage.local.set({ dn_drive_token: { access_token: ${JSON.stringify(FAKE_TOKEN)}, expiry: Date.now() + 3600e3 } }).then(() => true)`);
  await mockNetwork({ 'https://www.googleapis.com/upload/drive/': { status: 200, json: { id: 'mock', name: 'mock.xlsx', webViewLink: null } } });
  dialogs.length = 0;
  await h.cdp.send('Target.activateTarget', { targetId });
  await h.domClick(s, '#dn-close-btn').catch(() => {});
  await h.domClick(s, '#designnote-toggle-btn');
  await sleep(300);
  await h.domClick(s, '#dn-export-menu-btn');
  await sleep(150);
  await userClick(s, DRIVE_ITEM);
  await poll(async () => (await calls()).length > 0, 6000);
  c = await calls();
  const up = c[0] || { headers: {} };
  record('P8', 'Drive upload asks first, then sends one request to Google with the token in the auth header',
    dialogs.length === 1 && /Drive/i.test(dialogs[0]) && c.length === 1 && up.url.startsWith('https://www.googleapis.com/upload/drive/') && up.headers.Authorization === 'Bearer ' + FAKE_TOKEN,
    `dialog="${(dialogs[0] || '').slice(0, 120)}" calls=${c.map((x) => x.url.split('?')[0]).join(', ')}`);

  // ---------- P12 a page script can't trigger outbound actions (consent already given) ----------
  await mockNetwork({ 'https://': { status: 200, json: {} } });
  await ev(s, `document.getElementById('designnote-sidebar').classList.remove('dn-compact'); ${ENHANCE_BTN}.click(); true`);
  await h.domClick(s, '#dn-export-menu-btn');
  await sleep(150);
  await ev(s, `${DRIVE_ITEM}.click(); true`);
  await sleep(1500);
  c = await calls();
  record('P12', 'synthetic .click() from page script on Enhance / Send to Drive sends nothing', c.length === 0,
    `${c.length} call(s) ${c.map((x) => x.url.split('?')[0]).join(', ')}`);
  await ev(s, `(document.querySelector('.dn-action-menu') || { remove() {} }).remove(); true`);

  // ---------- P9 exports never contain the API key or OAuth token ----------
  await h.domClick(s, '#dn-close-btn').catch(() => {});
  await h.domClick(s, '#dn-table-btn');
  await sleep(300);
  for (const label of ['Excel', 'HTML', 'CSV', 'ZIP']) {
    await h.domClick(s, '#dn-export-menu-btn-table');
    await sleep(150);
    await ev(s, `[...document.querySelectorAll('.dn-action-menu-item')].find(b => b.textContent.trim().startsWith(${JSON.stringify(label)})).click(); true`);
    await poll(async () => fs.readdirSync(h.downloads).filter((f) => f.startsWith('redlines-') && !f.endsWith('.crdownload')).length > ['Excel', 'HTML', 'CSV', 'ZIP'].indexOf(label), 6000);
  }
  const files = fs.readdirSync(h.downloads).filter((f) => f.startsWith('redlines-'));
  const leaking = files.filter((f) => { const t = fs.readFileSync(path.join(h.downloads, f)).toString('latin1'); return t.includes(FAKE_KEY) || t.includes(FAKE_TOKEN); });
  record('P9', 'exports (xlsx, html, csv, zip) contain neither the API key nor the OAuth token', files.length >= 4 && leaking.length === 0, `${files.length} files; leaking: ${leaking.join(', ') || 'none'}`);

  // ---------- P10 nothing written into the host page's own storage ----------
  await ev(s, `(() => { const r = document.querySelector('#designnote-table-overlay .dn-col-resizer'); const o = { bubbles: true, clientX: 100, pageX: 100 };
    r.dispatchEvent(new MouseEvent('mousedown', o)); document.dispatchEvent(new MouseEvent('mousemove', { ...o, clientX: 160, pageX: 160 })); document.dispatchEvent(new MouseEvent('mouseup', o)); return true; })()`);
  await sleep(300);
  const hostStorage = await ev(s, `Object.keys(localStorage).concat(Object.keys(sessionStorage)).filter(k => /dn|designnote/i.test(k))`);
  record('P10', 'DesignNote writes nothing to the host page\'s localStorage/sessionStorage', hostStorage.length === 0, hostStorage.join(', ') || 'none');

  // ---------- P11 permissions ----------
  const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
  const unneeded = ['activeTab', 'tabs'].filter((p) => manifest.permissions.includes(p));
  record('P0', 'no real network request left the service worker during the run (all mocked)', externalAttempts.length === 0, externalAttempts.slice(0, 3).join(', ') + (swEvents.length ? ' | ' + swEvents.join(', ') : ''));
  record('P11', 'no permissions beyond what the code uses (no activeTab, tabs)', unneeded.length === 0, `permissions: ${manifest.permissions.join(', ')}`);
}

main()
  .catch((e) => { console.error('ABORTED:', e.message); results.push({ id: 'ABORT', pass: false }); })
  .finally(() => {
    if (h) h.close();
    server.close();
    const failed = results.filter((r) => !r.pass);
    console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length ? ' — failed: ' + failed.map((r) => r.id).join(', ') : ''}`);
    process.exit(failed.length ? 1 : 0);
  });
