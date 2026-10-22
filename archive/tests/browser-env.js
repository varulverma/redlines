// Phase 2 environment checks in real Chrome: manifest/install, shortcuts, popup, options,
// extension reload with open tabs, service-worker restart, SPA routes, theme, small
// viewport, aggressive host CSS, modal dialogs, and host-page style isolation.
//
//   node tests/browser-env.js [extensionDir]       (HEADED=1 / CHROME_PATH as in browser-smoke.js)
const http = require('http');
const path = require('path');
const { launch, recorder, sleep, poll } = require('./lib/cdp');

const EXT = path.resolve(process.argv[2] || path.join(__dirname, '..', '..'));
const { results, record } = recorder();
let h;

const doc = (title, head, body, script = '') =>
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title>${head}</head><body>${body}<script>${script}</script></body></html>`;
const PAGES = {
  '/plain.html': doc('Plain', '<style>body{font:14px sans-serif;margin:20px}</style>',
    '<h1 id="title">Plain page</h1><p class="lead">Some text</p><button id="b1">A button</button><ul><li>One</li><li>Two</li></ul>'),
  '/spa.html': doc('SPA', '', '<nav><button id="go-a">A</button><button id="go-b">B</button></nav><main id="view">Route</main>',
    `const show = () => document.getElementById('view').textContent = 'Route ' + location.pathname;
     document.getElementById('go-a').onclick = () => { history.pushState({}, '', '/spa.html'); show(); };
     document.getElementById('go-b').onclick = () => { history.pushState({}, '', '/spa-b.html'); show(); };`),
  // Common "aggressive" host CSS: a Tailwind-preflight-like reset, element-level button/svg
  // rules, and a fixed header at the maximum z-index.
  '/aggressive.html': doc('Aggressive', `<style>
    *,::before,::after{box-sizing:border-box;border:0 solid;margin:0;padding:0}
    button{background:transparent;color:inherit;font:inherit;line-height:inherit}
    svg{display:block;vertical-align:middle;width:auto;height:auto}
    div{font-size:22px;line-height:2}
    header{position:fixed;inset:0 0 auto 0;height:64px;background:#222;color:#fff;z-index:2147483647}
    body{padding-top:80px;font-family:serif}</style>`,
    '<header>Fixed header z-index max</header><div id="content"><p id="para">Aggressive CSS page</p></div>'),
  '/dialog.html': doc('Dialog', '<style>body{font:14px sans-serif}</style>',
    '<button id="open">Open</button><dialog id="dlg"><p id="in-dialog">Inside the modal dialog</p><button>OK</button></dialog>',
    `document.getElementById('dlg').showModal();`),
};
PAGES['/spa-b.html'] = PAGES['/spa.html'];
const server = http.createServer((req, res) => {
  const body = PAGES[req.url.split('?')[0]];
  res.writeHead(body ? 200 : 404, { 'content-type': 'text/html; charset=utf-8' });
  res.end(body || 'not found');
});

const ev = (...a) => h.ev(...a);
const notesFor = async (url) => (await h.storage())['dn_annotations::' + url] || [];

// Mark → real click on the element → choose the "note" preset → save
async function quickNote(s, sel, text) {
  await h.domClick(s, '#designnote-mode-btn');
  const [x, y] = await h.center(s, sel);
  await h.realClick(s, x, y);
  const opened = await poll(() => ev(s, `!!document.querySelector('#designnote-popup-form')`), 3000);
  if (!opened) return false;
  await ev(s, `(() => { const f = document.querySelector('#designnote-popup-form');
    (f.querySelector('.dn-type-pill[data-type="note"]') || f.querySelector('.dn-type-pill')).click();
    f.querySelector('#dn-text-input').value = ${JSON.stringify(text)}; f.querySelector('.dn-form-save').click(); return true; })()`);
  await sleep(1500);
  return true;
}

// Opens the real toolbar popup over the given tab via chrome.action.openPopup() and returns its session
async function openPopup(pageTargetId) {
  await h.cdp.send('Target.activateTarget', { targetId: pageTargetId });
  await sleep(200);
  await ev(h.sw, 'chrome.action.openPopup().then(() => true)');
  const t = await poll(async () => (await h.cdp.send('Target.getTargets')).targetInfos
    .find((x) => x.url === `chrome-extension://${h.extId}/popup.html`), 5000);
  if (!t) throw new Error('popup did not open');
  const s = await h.attach(t.targetId);
  await poll(() => ev(s, `document.getElementById('count').textContent !== '–'`), 4000);
  return { s, targetId: t.targetId };
}
const popupText = (s) => ev(s, `document.body.innerText.replace(/\\s+/g, ' ').trim()`);

async function main() {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  h = await launch({ ext: EXT, prefix: 'dn-env-' });
  console.log(`Browser: ${h.version}  Extension dir: ${EXT}`);

  const exceptions = []; // uncaught page exceptions, by session
  h.cdp.listeners.push((m) => {
    if (m.method === 'Runtime.exceptionThrown') exceptions.push({ s: m.sessionId, text: m.params.exceptionDetails.exception ? m.params.exceptionDetails.exception.description : m.params.exceptionDetails.text });
  });

  // ---------- E1 manifest as Chrome sees it ----------
  const ext = await h.openPage('chrome://extensions/', { waitPill: false });
  const info = await poll(() => ev(ext.s, `new Promise(r => chrome.developerPrivate.getExtensionInfo(${JSON.stringify(h.extId)}, r))`), 5000);
  const warnings = info ? [...(info.installWarnings || []), ...(info.manifestErrors || []).map((e) => e.message)] : ['(could not read extension info)'];
  record('E1', 'manifest loads; Chrome warnings listed', !!info, warnings.length ? warnings.join(' | ') : 'no warnings');
  record('E2', 'background runs as an MV3 service worker in Chrome', !!(await h.findSw()));
  await h.cdp.send('Target.closeTarget', { targetId: ext.targetId });

  // ---------- E3 shortcuts actually assigned ----------
  const cmds = await ev(h.sw, 'chrome.commands.getAll()');
  const unassigned = cmds.filter((c) => c.name !== '_execute_action' && !c.shortcut).map((c) => c.name);
  record('E3', 'every declared shortcut is assigned', unassigned.length === 0, cmds.map((c) => `${c.name}=${c.shortcut || '(none)'}`).join(', '));

  // ---------- E4 popup on a normal page ----------
  const plainUrl = base + '/plain.html';
  const plain = await h.openPage(plainUrl);
  await quickNote(plain.s, '#title', 'Popup count note');
  let pop = await openPopup(plain.targetId);
  const popCount = await ev(pop.s, `document.getElementById('count').textContent`);
  record('E4', 'popup shows this page\'s note count', popCount === '1', `count=${popCount}`);
  await ev(pop.s, `document.getElementById('open-sidebar').click(); true`).catch(() => {});
  await sleep(500);
  record('E5', 'popup "Open sidebar" opens the sidebar', await ev(plain.s, `document.getElementById('designnote-sidebar').classList.contains('open')`));

  // ---------- E6 popup on a page the extension can't run on ----------
  const restricted = await h.openPage('chrome://version/', { waitPill: false });
  pop = await openPopup(restricted.targetId);
  const restrictedText = await popupText(pop.s);
  record('E6', 'popup explains a page DesignNote cannot run on (not a bare "0")', !/^DesignNote Annotations on this page 0 on this page/.test(restrictedText), restrictedText.slice(0, 120));
  await h.cdp.send('Target.closeTarget', { targetId: restricted.targetId });

  // ---------- E7 options page ----------
  const opt = await h.openPage(`chrome-extension://${h.extId}/settings.html`, { waitPill: false });
  await sleep(800);
  const optState = await ev(opt.s, `({ redirect: document.getElementById('redirectUri').textContent, drive: document.getElementById('drive-status').textContent })`);
  await ev(opt.s, `document.getElementById('provider').value = 'openai'; document.getElementById('apiKey').value = 'test-not-a-real-key'; document.getElementById('save').click(); true`);
  await sleep(300);
  const saved = await h.storage();
  record('E7', 'settings page: redirect URI shown, Drive "Not connected" with no client ID, save persists', /chromiumapp\.org/.test(optState.redirect) && /Not connected/.test(optState.drive) && saved.dn_provider === 'openai' && saved.dn_api_key === 'test-not-a-real-key',
    `${optState.redirect} | ${optState.drive}`);
  await ev(opt.s, `document.getElementById('apiKey').value = ''; document.getElementById('save').click(); true`);
  await h.cdp.send('Target.closeTarget', { targetId: opt.targetId });

  // ---------- E8 service worker stopped → screenshot capture still works ----------
  await h.cdp.send('ServiceWorker.enable', {}, plain.s);
  await h.cdp.send('ServiceWorker.stopAllWorkers', {}, plain.s);
  await sleep(500);
  await quickNote(plain.s, 'p.lead', 'After SW restart');
  await h.attachSw();
  const afterSw = (await notesFor(plainUrl)).find((a) => a.text === 'After SW restart');
  record('E8', 'saving after the service worker was stopped still captures a screenshot', !!(afterSw && afterSw.screenshot), afterSw ? `screenshot=${!!afterSw.screenshot}` : 'note missing');

  // ---------- E9 SPA route changes ----------
  const spa = await h.openPage(base + '/spa.html');
  await quickNote(spa.s, '#view', 'Route A note');
  const badge = () => ev(spa.s, `(() => { const b = document.getElementById('designnote-badge'); return b.hidden ? 0 : +b.textContent; })()`);
  const tA = Date.now();
  const onA = (await poll(async () => ((await badge()) === 1 ? 1 : 0), 6000)) || 0;
  const badgeMs = Date.now() - tA;
  await h.domClick(spa.s, '#go-b');
  await sleep(1000);
  const onB = await badge();
  await h.domClick(spa.s, '#go-a');
  await sleep(1000);
  const backA = await badge();
  record('E9', 'badge follows pushState routes (A=1, B=0, back to A=1)', onA === 1 && onB === 0 && backA === 1, `A=${onA} (badge after +${badgeMs}ms) B=${onB} A=${backA}`);

  // ---------- E18 shortcut handlers (key presses can't be injected via CDP; call the handler) ----------
  await h.domClick(plain.s, '#dn-close-btn').catch(() => {});
  await h.cdp.send('Target.activateTarget', { targetId: plain.targetId });
  await sleep(200);
  const sidebarOpen = () => ev(plain.s, `document.getElementById('designnote-sidebar').classList.contains('open')`);
  await ev(h.sw, `runCommand('toggle-sidebar').then(() => true)`);
  await sleep(300);
  const opened = await sidebarOpen();
  await ev(h.sw, `runCommand('toggle-sidebar').then(() => true)`);
  await sleep(300);
  const closed = !(await sidebarOpen());
  await ev(h.sw, `runCommand('toggle-mark-mode').then(() => true)`);
  await sleep(200);
  const marking = await ev(plain.s, `document.documentElement.classList.contains('dn-marking')`);
  await ev(h.sw, `runCommand('toggle-mark-mode').then(() => true)`);
  await ev(h.sw, `runCommand('toggle-pill').then(() => true)`);
  await sleep(200);
  const pillHidden = await ev(plain.s, `document.getElementById('designnote-pill').hidden`);
  await ev(h.sw, `runCommand('toggle-pill').then(() => true)`);
  record('E18', 'shortcut handlers: sidebar toggles open+closed, Mark toggles, pill hides', opened && closed && marking && pillHidden,
    `opened=${opened} closed=${closed} marking=${marking} pillHidden=${pillHidden}`);

  // ---------- E10 Appearance setting switches the UI tokens (dark default, light, system) ----------
  const bg = () => ev(plain.s, `getComputedStyle(document.getElementById('designnote-sidebar')).getPropertyValue('--dn-bg').trim()`);
  const setTheme = async (v) => { await ev(h.sw, `chrome.storage.local.set({ dn_theme: ${JSON.stringify(v)} }).then(() => true)`); await sleep(250); };
  const byDefault = await bg();
  await setTheme('light');
  const light = await bg();
  await setTheme('system');
  await h.cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] }, plain.s);
  await sleep(100);
  const sysDark = await bg();
  await h.cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] }, plain.s);
  await sleep(100);
  const sysLight = await bg();
  await h.cdp.send('Emulation.setEmulatedMedia', { features: [] }, plain.s);
  await setTheme('dark');
  record('E10', 'Appearance setting switches the UI tokens (dark default, light, system follows OS)',
    byDefault && light && byDefault !== light && sysDark === byDefault && sysLight === light,
    `default=${byDefault} light=${light} system/dark=${sysDark} system/light=${sysLight}`);

  // ---------- E11 small viewport ----------
  await h.cdp.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 667, deviceScaleFactor: 2, mobile: false }, plain.s);
  await sleep(300);
  await ev(plain.s, `document.getElementById('designnote-sidebar').classList.add('open'); true`);
  await sleep(700); // slide-in transition
  const fit = await ev(plain.s, `(() => { const vw = innerWidth, vh = innerHeight;
    const inside = (el) => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.top >= 0 && r.right <= vw && r.bottom <= vh; };
    const sb = document.getElementById('designnote-sidebar');
    const r = sb.getBoundingClientRect();
    return { pill: inside(document.getElementById('designnote-pill')), sidebarW: Math.round(r.width), sidebarRight: Math.round(r.right), vw }; })()`);
  await ev(plain.s, `document.getElementById('designnote-sidebar').classList.remove('dn-compact'); true`);
  await sleep(700);
  const expanded = await ev(plain.s, `(() => { const r = document.getElementById('designnote-sidebar').getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width) }; })()`);
  await ev(plain.s, `document.getElementById('designnote-sidebar').classList.add('dn-compact'); true`);
  record('E11', 'at 375×667 the pill and the sidebar (compact and expanded) fit the viewport', fit.pill && fit.sidebarRight <= fit.vw && expanded.left >= 0 && expanded.right <= fit.vw,
    `${JSON.stringify(fit)} expanded=${JSON.stringify(expanded)}`);
  await h.cdp.send('Emulation.clearDeviceMetricsOverride', {}, plain.s);
  await h.domClick(plain.s, '#dn-close-btn');

  // ---------- E12 host-page style isolation ----------
  await h.cdp.send('DOM.enable', {}, plain.s);
  await h.cdp.send('CSS.enable', {}, plain.s);
  const { root } = await h.cdp.send('DOM.getDocument', { depth: -1 }, plain.s);
  const hostNodes = [];
  (function walk(n, inRoot) {
    const own = n.attributes && n.attributes[n.attributes.indexOf('id') + 1] === 'designnote-root' && n.attributes.includes('id');
    if (n.nodeType === 1 && !inRoot && !own) hostNodes.push(n);
    (n.children || []).forEach((c) => walk(c, inRoot || own));
  })(root, false);
  const leaks = new Set();
  for (const n of hostNodes) {
    const m = await h.cdp.send('CSS.getMatchedStylesForNode', { nodeId: n.nodeId }, plain.s);
    for (const r of m.matchedCSSRules || []) {
      if (r.rule.origin !== 'user-agent' && r.rule.styleSheetId) {
        const header = await h.cdp.send('CSS.getStyleSheetText', { styleSheetId: r.rule.styleSheetId }, plain.s).catch(() => null);
        const isPage = header && /font:14px sans-serif;margin:20px/.test(header.text);
        if (!isPage) leaks.add(`${n.nodeName.toLowerCase()} ← ${r.rule.selectorList.text}`);
      }
    }
  }
  record('E12', 'extension CSS matches no host elements except the :root token block', [...leaks].every((l) => /^html ← :root, #designnote-root$/.test(l)), [...leaks].join(' ; ') || 'none');

  // ---------- E13 aggressive host CSS + fixed header ----------
  const agg = await h.openPage(base + '/aggressive.html');
  const pillState = await ev(agg.s, `(() => {
    const btn = document.getElementById('designnote-mode-btn'); const r = btn.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    const icon = btn.querySelector('svg').getBoundingClientRect();
    return { pillClickable: btn.contains(hit), iconW: Math.round(icon.width), iconH: Math.round(icon.height) }; })()`);
  await h.domClick(agg.s, '#designnote-toggle-btn');
  await sleep(700); // slide-in transition
  const aggState = { ...pillState, ...(await ev(agg.s, `(() => {
    // The sidebar's top strip sits under the 64px max-z fixed header: who gets the click there?
    const sb = document.getElementById('designnote-sidebar').getBoundingClientRect();
    const topHit = document.elementFromPoint(sb.left + sb.width / 2, sb.top + 12);
    return { sidebarTop: Math.round(sb.top), sidebarTopIsOurs: !!topHit && !!topHit.closest('#designnote-root') }; })()`)) };
  record('E13', 'aggressive host CSS: pill clickable, icons sized, sidebar not covered by a max-z fixed header',
    aggState.pillClickable && aggState.iconW > 0 && aggState.iconW < 40 && aggState.sidebarTop < 64 && aggState.sidebarTopIsOurs, JSON.stringify(aggState));

  // ---------- E14 annotate inside a modal <dialog> (Mark via the shortcut's message) ----------
  const dlg = await h.openPage(base + '/dialog.html');
  const tab = (await h.cdp.send('Target.getTargetInfo', { targetId: dlg.targetId })).targetInfo;
  await ev(h.sw, `chrome.tabs.query({}).then(ts => { const t = ts.find(t => t.url === ${JSON.stringify(tab.url)}); return chrome.tabs.sendMessage(t.id, { type: 'TOGGLE_MARK_MODE' }); }).then(() => true, () => true)`);
  await sleep(200);
  const [dx, dy] = await h.center(dlg.s, '#in-dialog');
  await h.realClick(dlg.s, dx, dy);
  await sleep(400);
  const dlgState = await ev(dlg.s, `(() => { const f = document.querySelector('#designnote-popup-form'); if (!f) return { form: false };
    const ta = f.querySelector('#dn-text-input'); ta.focus();
    return { form: true, focused: document.activeElement === ta, inert: !!f.closest('[inert]') || (typeof ta.matches === 'function' && !ta.checkVisibility()) }; })()`);
  record('E14', 'inside a modal dialog, the note form opens and can be typed into', dlgState.form && dlgState.focused, JSON.stringify(dlgState));

  // ---------- E15 extension reloaded while a tab is open ----------
  const before = exceptions.length;
  // Re-loading the same unpacked folder = "reload" on chrome://extensions (an update):
  // the open tab keeps the old, now orphaned content script. (chrome.runtime.reload()
  // removes a pipe-loaded extension entirely, so it can't be used here.)
  await h.cdp.send('Extensions.loadUnpacked', { path: EXT });
  await sleep(1000);
  await h.attachSw();
  await h.domClick(plain.s, '#designnote-toggle-btn').catch(() => {});
  await sleep(600);
  const orphan = await ev(plain.s, `({ roots: document.querySelectorAll('#designnote-root').length,
    toast: [...document.querySelectorAll('.dn-toast')].map(t => t.textContent).join(' | '),
    cards: document.querySelectorAll('#designnote-sidebar .dn-card').length })`);
  const newExceptions = exceptions.slice(before).map((e) => e.text.split('\n')[0]);
  record('E15', 'after an extension reload, the old tab tells the user to refresh (no silent failure)', /reload|refresh/i.test(orphan.toast),
    `${JSON.stringify(orphan)}; uncaught: ${newExceptions.join(' | ') || 'none'}`);
  pop = await openPopup(plain.targetId).catch(() => null);
  const afterReloadPopup = pop ? await popupText(pop.s) : '(popup failed)';
  const reinjected = await ev(plain.s, `document.querySelectorAll('#designnote-root').length`);
  record('E16', 'popup on that tab still works after the reload (count shown or page re-armed)', /on this page/.test(afterReloadPopup) && !/ 0 on this page/.test(afterReloadPopup) || reinjected > 0 && /\b2\b/.test(afterReloadPopup),
    `${afterReloadPopup.slice(0, 100)}; roots=${reinjected}`);

  const pageErrors = exceptions.slice(0, before).map((e) => e.text.split('\n')[0]);
  record('E17', 'no uncaught extension errors in pages during the normal checks (before the reload)', pageErrors.length === 0, pageErrors.join(' | '));
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
