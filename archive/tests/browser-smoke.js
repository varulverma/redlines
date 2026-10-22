// Real-browser smoke test: loads the unpacked extension into Chrome via the DevTools
// pipe (Extensions.loadUnpacked) and drives the actual in-page UI on local fixture pages.
// No dependencies. Needs desktop Chrome 126+.
//
//   node tests/browser-smoke.js [extensionDir]          (headless)
//   HEADED=1 node tests/browser-smoke.js                 (visible window)
//   CHROME_PATH=... to point at a different Chrome/Chromium binary
//
// Interactions use real mouse/keyboard input events where the extension relies on them
// (element picking, Escape); UI buttons are clicked via DOM .click() in the page.
const fs = require('fs');
const path = require('path');
const http = require('http');
const { launch, recorder, sleep, poll } = require('./lib/cdp');

const EXT = path.resolve(process.argv[2] || path.join(__dirname, '..', '..'));
const { results, record } = recorder();
let h, DL, base;

// ---------- fixture pages ----------
function pageHtml(title, body, script) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>
body{margin:0;font:14px sans-serif} header{position:sticky;top:0;height:40px;background:#eee;z-index:5}
.card{padding:4px;margin:2px;border:1px solid #ddd} .magenta{width:200px;height:120px;background:#ff00ff;margin:40px}
</style></head><body>${body}<script>${script || ''}</script></body></html>`;
}
let cards = '';
for (let i = 0; i < 300; i++) cards += `<div class="card"><div class="inner"><div><p>Card ${i}</p></div></div></div>`;
const PAGES = {
  '/page1.html': pageHtml('Page 1',
    `<header>Sticky header</header><button id="stable-btn">Stable</button>${cards}<div class="holder"><div class="magenta"></div></div>`,
    // #wrap re-parents the whole body into <main>: same storage key (hash is ignored),
    // but every nth-child selector path breaks, forcing the fingerprint fallback.
    `if (location.hash === '#wrap') { const m = document.createElement('main'); while (document.body.firstChild) m.appendChild(document.body.firstChild); document.body.appendChild(m); }`),
  '/page2.html': pageHtml('Page 2', '<h1 id="p2">Page two</h1>'),
};
const server = http.createServer((req, res) => {
  const body = PAGES[req.url.split('?')[0]];
  res.writeHead(body ? 200 : 404, { 'content-type': 'text/html; charset=utf-8' });
  res.end(body || 'not found');
});

// thin wrappers over the shared harness (tests/lib/cdp.js)
const ev = (...a) => h.ev(...a);
const storage = () => h.storage();
const notesFor = async (url) => (await storage())['dn_annotations::' + url] || [];
const totalNotes = async () => Object.entries(await storage()).filter(([k]) => k.startsWith('dn_annotations::')).reduce((n, [, v]) => n + v.length, 0);
const openPage = (url) => h.openPage(url);
const center = (...a) => h.center(...a);
const realClick = (...a) => h.realClick(...a);
const domClick = (...a) => h.domClick(...a);

// Mark → click element → pick/create category → type → save. Works for both the preset
// UI and the older custom-only UI (falls back to the "New" category input).
async function createNote(s, targetSel, category, text, beforeSave) {
  await domClick(s, '#designnote-mode-btn');
  const [x, y] = await center(s, targetSel);
  await sleep(100);
  await realClick(s, x, y);
  if (!(await poll(() => ev(s, `!!document.querySelector('#designnote-popup-form')`)))) throw new Error('form did not open');
  await ev(s, `(() => {
    const f = document.querySelector('#designnote-popup-form');
    const pill = [...f.querySelectorAll('.dn-type-pill:not(.dn-new-category)')].find(b => b.dataset.type === ${JSON.stringify(category)});
    if (pill) { pill.click(); }
    else {
      f.querySelector('#dn-new-category-btn').click();
      const inp = f.querySelector('#dn-custom-category-input');
      inp.value = ${JSON.stringify(category)};
      inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    }
    f.querySelector('#dn-text-input').value = ${JSON.stringify(text)};
    return true; })()`);
  if (beforeSave) await beforeSave();
  const before = await totalNotes();
  await domClick(s, '#designnote-popup-form .dn-form-save');
  // close animation + capture + crop + storage write; the first save in a cold browser can take seconds
  await poll(async () => (await totalNotes()) > before, 10000);
  await sleep(200);
}
async function waitDownload(re, ms = 10000) {
  return poll(async () => {
    const f = fs.readdirSync(DL).find((n) => re.test(n) && !n.endsWith('.crdownload'));
    return f && path.join(DL, f);
  }, ms);
}
async function menuPick(s, triggerSel, label) {
  await domClick(s, triggerSel);
  await sleep(150);
  // Pre-fix builds needed a second click to reopen a menu; C12b checks that bug directly.
  if (!(await ev(s, `!!document.querySelector('.dn-action-menu')`))) {
    await domClick(s, triggerSel);
    await sleep(150);
  }
  return ev(s, `(() => {
    const m = document.querySelector('.dn-action-menu');
    const heading = (m.querySelector('.dn-action-menu-heading') || {}).textContent || '';
    const item = [...m.querySelectorAll('.dn-action-menu-item')].find(b => b.textContent.trim().startsWith(${JSON.stringify(label)}));
    item.click();
    return heading; })()`);
}

async function main() {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const P1 = base + '/page1.html';
  const P2 = base + '/page2.html';

  h = await launch({ ext: EXT, prefix: 'dn-smoke-' });
  DL = h.downloads;
  const cdp = h.cdp;
  const sw = h.sw;
  const extId = h.extId;
  console.log(`Browser: ${h.version}  Extension dir: ${EXT}`);

  // Record every request leaving the machine (anything not to the local fixture server)
  const external = [];
  cdp.listeners.push((m) => {
    if (m.method === 'Network.requestWillBeSent') {
      const u = m.params.request.url;
      if (!/^(http:\/\/127\.0\.0\.1|data:|blob:|chrome-extension:)/.test(u)) external.push(u);
    }
  });

  record('C1', 'extension loads and injects the pill', true, `id ${extId}`);

  // ---------- page 2 first: one note, so "All pages" has something from another page ----------
  const p2 = await openPage(P2);
  await createNote(p2.s, '#p2', 'note', '=HYPERLINK("http://x") page two note');
  record('C2', 'save a note on page 2', (await notesFor(P2)).length === 1);

  const p1 = await openPage(P1);
  const s = p1.s;

  // ---------- presets offered + typed "Bug" maps to the preset ----------
  await domClick(s, '#designnote-mode-btn');
  const [bx, by] = await center(s, '#stable-btn');
  await realClick(s, bx, by);
  await poll(() => ev(s, `!!document.querySelector('#designnote-popup-form')`));
  const pills = await ev(s, `[...document.querySelectorAll('#designnote-popup-form .dn-type-pill:not(.dn-new-category)')].map(b => b.dataset.type)`);
  record('C3', 'create form offers your categories (no presets; "note" was added by C2)', pills[0] === 'UI' && !pills.includes('bug') && !pills.includes('suggestion'), JSON.stringify(pills));
  await domClick(s, '#designnote-popup-form .dn-form-cancel');
  await sleep(300);

  await createNote(s, '#stable-btn', 'Bug', 'Label <b>wrong</b> & "quoted", with comma');
  let n1 = await notesFor(P1);
  const catsAfterBug = (await storage()).dn_categories || [];
  record('C4', 'typing a new "Bug" stores it as typed and adds it to the category list', n1.length === 1 && n1[0].type === 'Bug' && catsAfterBug.includes('Bug'), `stored type ${n1[0] && JSON.stringify(n1[0].type)}; list ${JSON.stringify(catsAfterBug)}`);

  // ---------- custom category on a deep, attribute-less element ----------
  await createNote(s, '.card:nth-of-type(150) p', 'Layout', 'Spacing too tight');
  n1 = await notesFor(P1);
  const layout = n1.find((a) => a.type === 'Layout');
  record('C5', 'custom category note saved', !!layout, layout && `selector ${layout.selector}`);

  // ---------- screenshot when the user scrolls while typing ----------
  const magentaTop = await ev(s, `(() => { const el = document.querySelector('.magenta'); el.scrollIntoView({block:'center'}); return el.getBoundingClientRect().top + scrollY; })()`);
  await createNote(s, '.magenta', 'suggestion', 'Magenta box', () => ev(s, 'window.scrollBy(0, -600)'));
  n1 = await notesFor(P1);
  const mag = n1.find((a) => a.text === 'Magenta box');
  const pixel = mag && mag.screenshot ? await ev(s, `new Promise(res => { const im = new Image(); im.onload = () => { const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const x = c.getContext('2d'); x.drawImage(im, 0, 0); const d = x.getImageData(im.width >> 1, im.height >> 1, 1, 1).data; res([d[0], d[1], d[2], im.width, im.height]); }; im.onerror = () => res(null); im.src = ${JSON.stringify(mag.screenshot)}; })`) : null;
  const isMagenta = pixel && pixel[0] > 230 && pixel[1] < 30 && pixel[2] > 230;
  record('C6', 'screenshot shows the clicked element after scrolling while typing', !!isMagenta, `center rgb/size ${JSON.stringify(pixel)}`);
  record('C7', 'stored rect is the element position (doc coords)', !!mag && mag.rect && Math.abs(mag.rect.top - magentaTop) < 2, mag && `rect.top ${mag.rect && mag.rect.top} vs ${magentaTop}`);

  // ---------- Escape leaves Mark mode ----------
  await domClick(s, '#designnote-mode-btn');
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, s);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, s);
  const stillMarking = await ev(s, `document.documentElement.classList.contains('dn-marking')`);
  record('C8', 'Escape exits Mark mode', !stillMarking);
  if (stillMarking) await domClick(s, '#designnote-mode-btn');

  // ---------- categories hidden by default; real Enter saves as "note" ----------
  await domClick(s, '#designnote-mode-btn');
  const [ex, ey] = await center(s, '#stable-btn');
  await realClick(s, ex, ey);
  await poll(() => ev(s, `!!document.querySelector('#designnote-popup-form')`));
  const pickerHidden = await ev(s, `getComputedStyle(document.querySelector('#dn-type-picker')).display === 'none'`);
  await ev(s, `document.querySelector('#dn-text-input').value = 'Saved with Enter'; true`);
  const beforeEnter = await totalNotes();
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, s);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, s);
  await poll(async () => (await totalNotes()) > beforeEnter, 10000);
  const entered = (await notesFor(P1)).find((a) => a.text === 'Saved with Enter');
  record('C8b', 'category picker hidden by default; Enter saves the note in the first category ("UI")', pickerHidden && !!entered && entered.type === 'UI', `hidden=${pickerHidden} type=${entered && entered.type}`);

  // ---------- Settings: renaming a category moves its notes ----------
  const settingsTab = await h.openPage(`chrome-extension://${h.extId}/settings.html`, { waitPill: false });
  await poll(() => ev(settingsTab.s, `!!document.querySelector('#category-list input')`));
  await ev(settingsTab.s, `(() => { const i = [...document.querySelectorAll('#category-list input')].find(x => x.value === 'UI'); i.value = 'Interface'; i.dispatchEvent(new Event('change')); return true; })()`);
  await poll(async () => ((await storage()).dn_categories || []).includes('Interface'));
  await sleep(200);
  const renamed = (await notesFor(P1)).find((a) => a.text === 'Saved with Enter');
  const catsNow = (await storage()).dn_categories;
  record('C8c', 'renaming UI → Interface in Settings updates the list and its saved notes', renamed && renamed.type === 'Interface' && !catsNow.includes('UI'), `type=${renamed && renamed.type} list=${JSON.stringify(catsNow)}`);
  await h.cdp.send('Target.closeTarget', { targetId: settingsTab.targetId });
  await h.cdp.send('Page.bringToFront', {}, s).catch(() => {});

  // ---------- edit a custom-category note ----------
  await domClick(s, '#designnote-toggle-btn');
  await sleep(400);
  await ev(s, `(() => { const card = [...document.querySelectorAll('.dn-card')].find(c => c.textContent.includes('Spacing too tight')); card.querySelector('[data-act="edit"]').click(); return true; })()`);
  const selectedPill = await ev(s, `(document.querySelector('#designnote-edit-form .dn-type-pill.selected') || {dataset:{}}).dataset.type || null`);
  await ev(s, `document.querySelector('#dn-edit-text-input').value = 'Spacing too tight (edited)'; true`);
  await ev(s, `document.querySelector('#designnote-edit-form .dn-save').click(); true`).catch(() => {});
  await sleep(600);
  const edited = (await notesFor(P1)).find((a) => a.id === layout.id);
  record('C9', 'edit form preselects the custom category', selectedPill === 'Layout', `selected ${selectedPill}`);
  record('C10', 'edit saves text and keeps category + original timestamp', edited.text === 'Spacing too tight (edited)' && edited.type === 'Layout' && edited.timestamp === layout.timestamp,
    `text=${JSON.stringify(edited.text)} type=${edited.type} timestampKept=${edited.timestamp === layout.timestamp}`);
  await ev(s, `(document.querySelector('#designnote-edit-form') || {remove(){}}).remove(); true`);

  // ---------- export scope: table left on "All pages", then export from the sidebar ----------
  await domClick(s, '#dn-table-btn');
  await sleep(400);
  await domClick(s, '.dn-view-btn[data-mode="all"]');
  await sleep(400);
  await domClick(s, '#dn-table-close-btn');
  await domClick(s, '#designnote-toggle-btn');
  await sleep(300);
  const sidebarHeading = await menuPick(s, '#dn-export-menu-btn', 'Excel');
  const xlsx = await waitDownload(/\.xlsx$/);
  const xml = xlsx && fs.readFileSync(xlsx).toString('latin1');
  const sheet = xml && xml.slice(xml.indexOf('<sheetData>'), xml.indexOf('</sheetData>'));
  const xlsxRows = sheet ? (sheet.match(/<row /g) || []).length - 1 : -1;
  const p1Count = (await notesFor(P1)).length;
  record('C11', 'sidebar Excel export = this page only, even after table was on All pages', xlsxRows === p1Count,
    `${xlsxRows} rows vs ${p1Count} on this page; file ${xlsx && path.basename(xlsx)}; menu heading "${sidebarHeading}"`);

  await menuPick(s, '#dn-export-menu-btn', 'HTML');
  const htmlFile = await waitDownload(/(?<!print)\.html$/);
  const html = htmlFile ? fs.readFileSync(htmlFile, 'utf8') : '';
  record('C12', 'HTML export escapes note text', html.includes('&lt;b&gt;wrong&lt;/b&gt;') && !html.includes('<b>wrong</b>'), htmlFile && path.basename(htmlFile));

  await domClick(s, '#dn-export-menu-btn');
  const openedAgain = await ev(s, `!!document.querySelector('.dn-action-menu')`);
  await domClick(s, '#dn-export-menu-btn');
  const toggledClosed = !(await ev(s, `!!document.querySelector('.dn-action-menu')`));
  record('C12b', 'export menu reopens after a pick, and the trigger toggles it closed', openedAgain && toggledClosed, `reopened=${openedAgain} toggledClosed=${toggledClosed}`);

  // ---------- table All pages: CSV has full page URLs, quoting, formula guard ----------
  await domClick(s, '#dn-table-btn');
  await sleep(400);
  await domClick(s, '.dn-view-btn[data-mode="all"]');
  await sleep(400);
  const tableHeading = await menuPick(s, '#dn-export-menu-btn-table', 'CSV');
  const csvFile = await waitDownload(/\.csv$/);
  const csv = csvFile ? fs.readFileSync(csvFile, 'utf8') : '';
  const total = Object.entries(await storage()).filter(([k]) => k.startsWith('dn_annotations::')).reduce((n, [, v]) => n + v.length, 0);
  const csvRecords = csv.split('\n').filter((l) => /^"?\d/.test(l)).length;
  record('C13', 'table All-pages CSV: every note, full page URL per row', csvRecords === total && csv.includes(P1) && csv.includes(P2),
    `${csvRecords}/${total} rows; heading "${tableHeading}"`);
  record('C14', 'CSV neutralises formulas', !/(^|,)"?=HYPERLINK/m.test(csv), csv.split('\n').find((l) => l.includes('HYPERLINK')));

  // ---------- Settings → Share to apps drives the Copy as menu ----------
  await ev(sw, `chrome.storage.local.set({ dn_share_apps: ['slack', 'github'] }).then(() => true)`);
  await sleep(200);
  await domClick(s, '#dn-copy-menu-btn');
  await sleep(200);
  const copyItems = await ev(s, `[...document.querySelectorAll('.dn-action-menu-item span')].map(x => x.textContent)`);
  await domClick(s, '#dn-copy-menu-btn'); // toggles closed
  await ev(sw, `chrome.storage.local.remove('dn_share_apps').then(() => true)`);
  record('C14b', 'Copy as lists only the apps picked in Settings, plus "Add apps…"',
    copyItems.includes('Slack') && copyItems.includes('GitHub issue') && !copyItems.includes('Notion') && copyItems.includes('Add apps…'), JSON.stringify(copyItems));

  // ---------- one copy format drives every per-note copy button (sidebar picker + table Copy as) ----------
  await menuPick(s, '#dn-copy-menu-btn', 'Markdown');
  await sleep(300);
  const fmt = await ev(s, `({ table: document.querySelector('#dn-copy-menu-btn span').textContent, side: document.querySelector('.dn-copy-format-label').textContent,
    rowTitle: (document.querySelector('#designnote-table-body [data-act="copy"]') || {}).dataset.tip })`);
  const savedFmt = (await storage()).dn_copy_format;
  await menuPick(s, '#dn-copy-format-btn', 'JSON');
  await sleep(300);
  const back = await ev(s, `({ side: document.querySelector('.dn-copy-format-label').textContent, rowTitle: (document.querySelector('#designnote-table-body [data-act="copy"]') || {}).dataset.tip })`);
  record('C14c', 'copy format picked in table Copy as is saved and shown in sidebar picker + row copy buttons; sidebar picker switches it back',
    savedFmt === 'md' && fmt.table === 'Copy as MD' && fmt.side === 'MD' && fmt.rowTitle === 'Copy this note as Markdown' && back.side === 'JSON' && back.rowTitle === 'Copy this note as JSON',
    JSON.stringify({ savedFmt, fmt, back }));

  // ---------- filter: legacy capitalised "Bug" counts as bug ----------
  const legacy = { id: 'legacy_1', type: 'Bug', text: 'Legacy capitalised Bug', selector: '#stable-btn', rect: null, screenshot: null, timestamp: 1 };
  await ev(sw, `chrome.storage.local.get(${JSON.stringify('dn_annotations::' + P1)}).then(r => chrome.storage.local.set({ ${JSON.stringify('dn_annotations::' + P1)}: (r[${JSON.stringify('dn_annotations::' + P1)}] || []).concat([${JSON.stringify(legacy)}]) }))`);
  await domClick(s, '.dn-view-btn[data-mode="current"]');
  await sleep(300);
  await domClick(s, '.dn-filter-chip[data-type="bug"]');
  await sleep(400);
  const bugRows = await ev(s, `document.querySelectorAll('#designnote-table-body tr[data-id]').length`);
  record('C15', 'Bug filter matches "bug" and legacy "Bug"', bugRows === 2, `${bugRows} rows`);
  await domClick(s, '.dn-filter-chip[data-type="all"]');

  // ---------- delete another page's note from All pages, then Undo ----------
  await domClick(s, '.dn-view-btn[data-mode="all"]');
  await sleep(400);
  const p2Id = (await notesFor(P2))[0].id;
  await domClick(s, `tr[data-id="${p2Id}"] [data-act="delete"]`);
  await sleep(500);
  const afterDelete = (await notesFor(P2)).length;
  const undoShown = await ev(s, `!!document.querySelector('.dn-toast-action')`);
  if (undoShown) await domClick(s, '.dn-toast-action');
  await sleep(500);
  const afterUndo = (await notesFor(P2)).length;
  record('C16', 'delete works on another page\'s note', afterDelete === 0, `page2 notes after delete: ${afterDelete}`);
  record('C17', 'Undo restores the deleted note', undoShown && afterUndo === 1, `undo shown=${undoShown}, after undo: ${afterUndo}`);
  await domClick(s, '#dn-table-close-btn');

  // ---------- broken selectors → fingerprint fallback must not freeze the tab ----------
  await ev(s, `location.hash = 'wrap'; setTimeout(() => location.reload(), 50); true`);
  await sleep(500);
  const wrapped = await poll(() => ev(s, `!!document.getElementById('designnote-pill') && !!document.querySelector('main')`));
  const layoutSel = (await notesFor(P1)).find((a) => a.type === 'Layout').selector;
  const selectorBroken = wrapped && (await ev(s, `!document.querySelector(${JSON.stringify(layoutSel)})`));
  record('C18a', 'fixture: selector really broken (precondition)', !!selectorBroken, `wrapped=${!!wrapped}`);
  const t0 = Date.now();
  let froze = false;
  try {
    await ev(s, `document.querySelector('#designnote-toggle-btn').click(); true`, 20000);
    await sleep(800);
    await ev(s, '1', 20000); // page must still answer
  } catch (e) {
    froze = true;
  }
  record('C18', 'sidebar opens with broken selectors without freezing', !froze, froze ? 'page unresponsive >20s' : `${Date.now() - t0}ms`);
  if (!froze) {
    await ev(s, `(() => { const card = [...document.querySelectorAll('.dn-card')].find(c => c.textContent.includes('Spacing too tight')); card.click(); return true; })()`);
    await sleep(300);
    const hit = await ev(s, `(document.querySelector('.dn-jump-highlight') || {}).textContent || null`);
    record('C19', 'jump finds the moved element by fingerprint', hit === 'Card 149', `highlighted ${JSON.stringify(hit)}`);
  }

  record('C20', 'no external network requests during the run', external.length === 0, external.slice(0, 3).join(', '));
}

main()
  .catch((e) => {
    console.error('ABORTED:', e.message);
    results.push({ id: 'ABORT', pass: false });
  })
  .finally(() => {
    if (h) h.close();
    server.close();
    const failed = results.filter((r) => !r.pass).length;
    console.log(`\n${results.length - failed}/${results.length} passed${failed ? ' — failed: ' + results.filter((r) => !r.pass).map((r) => r.id).join(', ') : ''}. Downloads kept in ${DL}`);
    process.exit(failed ? 1 : 0);
  });
