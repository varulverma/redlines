// Annotation UI v2 (one-line composer, card sidebar, table actions, surfaces) in real Chrome.
//
//   node tests/browser-annotation-ui.js [extensionDir]      (HEADED=1 / CHROME_PATH as in browser-smoke.js)
const http = require('http');
const path = require('path');
const { launch, recorder, sleep, poll } = require('./lib/cdp');

const EXT = path.resolve(process.argv[2] || path.join(__dirname, '..', '..'));
const { results, record } = recorder();

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Attendance</title><style>
body{margin:0;font:14px sans-serif;background:#f4f1ec}h1{margin:40px 28px 8px}.card{display:inline-block;margin:8px 28px;padding:20px 30px;background:#0d1b2a;color:#fff;border-radius:12px}
</style></head><body><h1 id="title">Attendance</h1><div class="card" id="c-on">On time 90%</div><div class="card" id="c-late">Late 7%</div><p id="sub" style="margin:28px">Week 42</p></body></html>`;
const SHOT = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="40"><rect width="64" height="40" fill="#0d1b2a"/></svg>');
const server = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end(PAGE); });

let h, s, url;
const ev = (x) => h.ev(s, x);
const notes = async () => (await h.storage())['dn_annotations::' + url] || [];
const key = async (k, vk) => { for (const type of ['keyDown', 'keyUp']) await h.cdp.send('Input.dispatchKeyEvent', { type, key: k, code: k, windowsVirtualKeyCode: vk }, s); };
const typeText = (t) => h.cdp.send('Input.insertText', { text: t }, s);
const seed = (list) => h.ev(h.sw, `chrome.storage.local.set({ ${JSON.stringify('dn_annotations::' + url)}: ${JSON.stringify(list)} }).then(() => true)`);
const note = (id, text, o = {}) => Object.assign({ id, type: 'UI', text, selector: '#sub', fingerprint: null, anchor: '#sub', rect: { top: 10, left: 10, width: 50, height: 20 }, screenshot: null, timestamp: Date.now() - 60000 }, o);
const toastText = () => ev(`[...document.querySelectorAll('.dn-toast')].map((t) => t.textContent).join(' | ')`);
const openForm = async (sel) => {
  await h.domClick(s, '#designnote-mode-btn');
  const [x, y] = await h.center(s, sel);
  await sleep(120);
  await h.realClick(s, x, y);
  return poll(() => ev(`!!document.querySelector('#designnote-popup-form.open')`), 3000);
};
const closeFormByEsc = async () => { await key('Escape', 27); await sleep(400); };

async function main() {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${server.address().port}/attendance`;
  h = await launch({ ext: EXT, prefix: 'dn-aui-' });
  console.log(`Browser: ${h.version}  Extension dir: ${EXT}`);
  await seed([]);
  ({ s } = await h.openPage(url));

  // ── Composer ──
  record('A0', 'form opens attached to the picked element', await openForm('#c-late'));
  const rows = await ev(`(() => { const f = document.querySelector('#designnote-popup-form'); return {
    chip: !!f.querySelector('#dn-cat-chip'), noPills: !f.querySelector('.dn-agent-pill'), noAttach: !f.querySelector('input[type=checkbox]'), menuClosed: f.querySelector('#dn-type-picker').hidden, noAgentsRow: f.querySelector('#dn-form-agents').hidden,
    saveDisabled: f.querySelector('.dn-form-save').getAttribute('aria-disabled') === 'true', cap: f.querySelector('.dn-form-sel').textContent }; })()`);
  record('A1', 'composer = category chip + note + Esc + Save, caption shows selector, size and number; no attach, and the category menu and agent row start closed/empty with no agent connected', rows.chip && rows.noPills && rows.noAttach && rows.menuClosed && rows.noAgentsRow && /c-late.*·.*×.*· #01/.test(rows.cap), JSON.stringify(rows));
  record('A2', 'Save reads as not ready (aria-disabled) until there is text, and stays focusable', rows.saveDisabled);
  const link0 = await ev(`(() => { const l = document.getElementById('dn-form-link'); return { shown: !l.hasAttribute('hidden'), d: l.querySelector('path').getAttribute('d') }; })()`);
  record('A3', 'a connector is drawn from the element to the form', link0.shown && /^M[\d.]+ [\d.]+[HV]/.test(link0.d), link0.d);
  await h.cdp.send('Input.insertText', { text: 'Late should read 7.2%' }, s);
  await sleep(250);
  const writing = await ev(`({ form: document.querySelector('#designnote-popup-form').classList.contains('dn-writing'),
    link: document.getElementById('dn-form-link').classList.contains('dn-writing'), mark: document.getElementById('dn-mark-ui').classList.contains('dn-writing'),
    ready: document.querySelector('.dn-form-save').getAttribute('aria-disabled') === 'false' })`);
  record('A4', 'typing lights up the whole annotation (form, element outline, connector) and Save becomes ready', writing.form && writing.link && writing.mark && writing.ready, JSON.stringify(writing));
  await closeFormByEsc();
  const afterEsc = await ev(`({ form: !!document.querySelector('#designnote-popup-form'), link: document.getElementById('dn-form-link').hasAttribute('hidden') })`);
  record('A5', 'Esc closes the form and removes the connector', !afterEsc.form && afterEsc.link, JSON.stringify(afterEsc));

  await openForm('#c-late');
  await key('Enter', 13);
  await sleep(300);
  const emptyEnter = await ev(`({ open: !!document.querySelector('#designnote-popup-form'), toast: [...document.querySelectorAll('.dn-toast')].map((t) => t.textContent).join('|') })`);
  record('A6', 'Enter with nothing typed does not save and says so', emptyEnter.open && /add a comment/i.test(emptyEnter.toast) && (await notes()).length === 0, JSON.stringify(emptyEnter));

  // Category: add through the menu, save
  await ev(`document.querySelector('#dn-cat-chip .dn-cat-name').click(), true`);
  const closedOnNameClick = await ev(`document.getElementById('dn-type-picker').hidden`);
  await ev(`document.getElementById('dn-cat-toggle').click(), true`);
  const menuOpen = closedOnNameClick && await ev(`!document.getElementById('dn-type-picker').hidden && document.getElementById('dn-cat-toggle').getAttribute('aria-expanded') === 'true'`);
  await ev(`(() => { document.getElementById('dn-new-category-btn').click(); const i = document.getElementById('dn-custom-category-input'); i.value = 'Copy'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return true; })()`);
  const chipAfterAdd = await ev(`document.querySelector('#dn-cat-chip .dn-cat-name').textContent`);
  await typeText('Rename the heading');
  await key('Enter', 13);
  const saved = await poll(async () => (await notes()).find((a) => a.text === 'Rename the heading'), 8000);
  record('A7', 'the category menu opens only from its arrow, not the name; a new category can be added and is used by the note', menuOpen && chipAfterAdd === 'Copy' && saved && saved.type === 'Copy', `menu=${menuOpen} chip=${chipAfterAdd} type=${saved && saved.type}`);

  // Rename the heading: changes the category everywhere
  await sleep(500);
  await openForm('#c-on');
  await ev(`document.querySelector('.dn-type-pill[data-type="Copy"]').click(), true`);
  await ev(`document.querySelector('#dn-cat-chip .dn-cat-name').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })), true`);
  const renaming = await ev(`!document.getElementById('dn-cat-rename').hidden && document.getElementById('dn-cat-chip').hidden`);
  await ev(`(() => { const i = document.getElementById('dn-cat-rename'); i.value = 'Content'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return true; })()`);
  await sleep(600);
  const st = await h.storage();
  const renamedNote = (await notes()).find((a) => a.text === 'Rename the heading');
  const chipNow = await ev(`document.querySelector('#dn-cat-chip .dn-cat-name').textContent`);
  record('A8', 'double-clicking the heading renames the category on every note and in the list', renaming && chipNow === 'Content' && renamedNote.type === 'Content' && (st.dn_categories || []).includes('Content') && !(st.dn_categories || []).includes('Copy'),
    `chip=${chipNow} noteType=${renamedNote && renamedNote.type} list=${JSON.stringify(st.dn_categories)}`);
  await closeFormByEsc();

  // ── Sidebar ──
  await seed([note('n1', 'Lost note', { selector: '#gone' }), note('n2', 'Resolved note', { status: 'resolved' }), note('n3', 'Open with image', { screenshot: SHOT }), note('n4', 'Sent to agent', { assignee: { id: 'claude-code', name: 'Claude Code' } })]);
  await ev('location.reload(), true');
  await poll(() => ev(`!!document.getElementById('designnote-pill')`));
  await sleep(500);
  await ev(`document.getElementById('designnote-toggle-btn').click(), true`);
  await sleep(500);
  await ev(`(() => { const b = document.getElementById('dn-compact-btn'); if (b.getAttribute('aria-pressed') === 'true') b.click(); return true; })()`);
  await sleep(300);
  const counts = await ev(`[...document.querySelectorAll('#dn-filters .dn-sf-chip')].map((c) => c.firstChild.textContent + ':' + c.querySelector('b').textContent).join(',')`);
  record('B1', 'status filters with live counts', counts === 'All:4,Open:2,Agent:1,Re-pin:1,Done:1', counts);
  await ev(`document.querySelector('.dn-sf-chip[data-sf="done"]').click(), true`);
  await sleep(200);
  const doneOnly = await ev(`[...document.querySelectorAll('.dn-card')].map((c) => c.dataset.id).join()`);
  await ev(`document.querySelector('.dn-sf-chip[data-sf="lost"]').click(), true`);
  await sleep(200);
  const lostOnly = await ev(`[...document.querySelectorAll('.dn-card')].map((c) => c.dataset.id).join()`);
  await ev(`document.querySelector('.dn-sf-chip[data-sf="all"]').click(), true`);
  await sleep(200);
  record('B2', 'Done and Re-pin filters show only matching notes', doneOnly === 'n2' && lostOnly === 'n1', `done=${doneOnly} lost=${lostOnly}`);

  const colours = await ev(`(() => { const c = document.querySelector('.dn-card[data-id="n3"]'); const col = (a) => getComputedStyle(c.querySelector('[data-act="' + a + '"]')).color;
    return ['resolve', 'copy', 'copy-image', 'edit', 'enhance', 'agent', 'delete'].map(col); })()`);
  record('B3', 'each action has its own hue', new Set(colours).size === 7, colours.join(' '));

  // Resolve
  await ev(`document.querySelector('.dn-card[data-id="n3"] [data-act="resolve"]').click(), true`);
  const resolved = await poll(async () => (await notes()).find((a) => a.id === 'n3').status === 'resolved', 3000);
  await sleep(300);
  const cardResolved = await ev(`document.querySelector('.dn-card[data-id="n3"]').classList.contains('dn-card-resolved')`);
  record('B4', 'Resolve marks the note resolved and the card reflects it', resolved && cardResolved);

  // Send to agent: nothing connected
  await ev(`document.querySelector('.dn-card[data-id="n3"] [data-act="agent"]').click(), true`);
  await sleep(500);
  record('B5', 'Send with no AI agent connected explains how to connect one', /No AI agent is connected/.test(await toastText()), await toastText());
  // Taking a note back from its agent
  await ev(`document.querySelector('.dn-card[data-id="n4"] [data-act="agent"]').click(), true`);
  const takenBack = await poll(async () => !(await notes()).find((a) => a.id === 'n4').assignee, 3000);
  record('B6', 'clicking Send on a note that was sent takes it back', takenBack);

  // Delete + undo
  await ev(`document.querySelector('.dn-card[data-id="n1"] [data-act="delete"]').click(), true`);
  const deleted = await poll(async () => !(await notes()).find((a) => a.id === 'n1'), 3000);
  await ev(`document.querySelector('.dn-toast-action').click(), true`);
  const restored = await poll(async () => (await notes()).find((a) => a.id === 'n1'), 3000);
  record('B7', 'Delete removes the note and Undo brings it back', deleted && !!restored);

  // Screenshot viewer
  await ev(`document.querySelector('.dn-card[data-id="n3"] [data-act="peek"]').focus(), document.querySelector('.dn-card[data-id="n3"] [data-act="peek"]').click(), true`);
  const lb = await poll(() => ev(`!!document.querySelector('.dn-lightbox img')`), 2000);
  await key('Escape', 27);
  await sleep(250);
  const lbClosed = await ev(`!document.querySelector('.dn-lightbox') && document.querySelector('#designnote-sidebar').classList.contains('open')`);
  record('B8', 'screenshot opens large; Esc closes just that layer', lb && lbClosed);

  // Tooltip sentences on hover
  const [tx, ty] = await h.center(s, '.dn-card[data-id="n3"] [data-act="copy"]');
  await h.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: tx, y: ty }, s);
  await sleep(300);
  const tipText = await ev(`(() => { const t = document.querySelector('.dn-tip'); return t.classList.contains('show') ? t.textContent : ''; })()`);
  record('B9', 'hovering a button shows a sentence tooltip', /^Copy this note as /.test(tipText), tipText);

  // ── Table ──
  await ev(`document.getElementById('dn-table-btn').click(), true`);
  await sleep(500);
  const tbl = await ev(`(() => { const r = document.querySelector('#designnote-table-body tr[data-id="n3"]'); return { agent: !!r.querySelector('[data-act="agent"]'), resolve: !!r.querySelector('[data-act="resolve"]'), cls: r.className }; })()`);
  record('B10', 'table rows carry the same coloured actions (resolve, copy, edit, enhance, send, delete); resolved rows are dimmed', tbl.agent && tbl.resolve && /dn-row-done/.test(tbl.cls), JSON.stringify(tbl));
  await ev(`document.querySelector('#designnote-table-body tr[data-id="n3"] [data-act="resolve"]').click(), true`);
  const reopened = await poll(async () => (await notes()).find((a) => a.id === 'n3').status !== 'resolved', 3000);
  record('B11', 'Reopen works from the table', reopened);
  await ev(`document.getElementById('dn-table-close-btn').click(), true`);

  // ── Surfaces ──
  const surfaces = {};
  for (const g of ['frosted', 'glass', 'liquid', 'solid']) {
    await h.ev(h.sw, `chrome.storage.local.set({ dn_appearance: { glass: ${JSON.stringify(g)} } }).then(() => true)`);
    await sleep(450);
    surfaces[g] = await ev(`(() => { const r = document.getElementById('designnote-root'); return (r.dataset.dnGlass || 'frosted') + '|' + getComputedStyle(document.getElementById('designnote-sidebar')).backdropFilter; })()`);
  }
  record('B12', 'Settings → In-page panels: Frosted, Glass, Liquid and Solid each change the surface', /blur\(24px\)/.test(surfaces.frosted) && /blur\(14px\)/.test(surfaces.glass) && /blur\(6px\)/.test(surfaces.liquid) && /^solid\|none$/.test(surfaces.solid), JSON.stringify(surfaces));

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length ? ' — failed: ' + failed.map((f) => f.id).join(', ') : ''}`);
  h.close();
  server.close();
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error(e); try { h && h.close(); } catch (x) { /* already closed */ } process.exit(1); });
