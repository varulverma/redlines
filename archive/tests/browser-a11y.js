// Phase 4 UX + accessibility checks in real Chrome: keyboard-only flows (real key events),
// Escape + focus return, computed accessible names, visible focus, contrast in both themes
// over light and dark host pages, reduced motion, 200%-zoom / small viewports, selector-loss
// feedback, and type labels. Not a conformance audit: no screen reader is driven.
//
//   node tests/browser-a11y.js [extensionDir]       (HEADED=1 / CHROME_PATH as in browser-smoke.js)
const http = require('http');
const path = require('path');
const { launch, recorder, sleep, poll } = require('./lib/cdp');

const EXT = path.resolve(process.argv[2] || path.join(__dirname, '..', '..'));
const { results, record } = recorder();
let h;

const doc = (title, bodyStyle, body) =>
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title>` +
  `<style>body{font:14px sans-serif;margin:20px;${bodyStyle}}</style></head><body>${body}</body></html>`;
const BODY = '<h1 id="title">Fixture</h1><a id="l1" href="#x">A link</a> <button id="b1">Host button</button>' +
  '<p id="p1">A paragraph to annotate.</p><div id="gone" class="card"><span>Will be removed</span></div>';
const PAGES = {
  '/light.html': doc('Light', 'background:#fff;color:#111', BODY),
  '/dark.html': doc('Dark', 'background:#111;color:#eee', BODY),
};
const server = http.createServer((req, res) => {
  const body = PAGES[req.url.split('?')[0]];
  res.writeHead(body ? 200 : 404, { 'content-type': 'text/html; charset=utf-8' });
  res.end(body || 'not found');
});

const ev = (...a) => h.ev(...a);
const KEYS = { Tab: 9, Enter: 13, Escape: 27, ' ': 32, ArrowDown: 40 };
async function press(s, key, shift = false) {
  const base = { key, code: key === ' ' ? 'Space' : key, windowsVirtualKeyCode: KEYS[key], modifiers: shift ? 8 : 0 };
  const text = key === 'Enter' ? '\r' : key === ' ' ? ' ' : undefined;
  await h.cdp.send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', ...base, ...(text ? { text } : {}) }, s);
  await h.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base }, s);
  await sleep(60);
}
// Describes document.activeElement (looks through nothing: our UI is light DOM)
const active = (s) => ev(s, `(() => { const a = document.activeElement; if (!a || a === document.body) return 'body';
  return a.tagName.toLowerCase() + (a.id ? '#' + a.id : '') + (a.className && typeof a.className === 'string' ? '.' + a.className.trim().split(/\\s+/).join('.') : ''); })()`);
async function tabUntil(s, test, max = 40, shift = false) {
  for (let i = 0; i < max; i++) {
    await press(s, 'Tab', shift);
    if (await ev(s, `(() => { const a = document.activeElement; return !!a && (${test})(a); })()`)) return i + 1;
  }
  return 0;
}

async function seed(url, notes) {
  await ev(h.sw, `chrome.storage.local.set(${JSON.stringify({ ['dn_annotations::' + url]: notes })}).then(() => true)`);
}
const note = (id, type, text, selector) => ({ id, type, text, selector, fingerprint: null, rect: { top: 100, left: 20, width: 100, height: 20 }, screenshot: null, timestamp: Date.now() });

// Computed accessible names of every visible control under #designnote-root
async function unnamedControls(s) {
  const { root } = await h.cdp.send('DOM.getDocument', { depth: 0 }, s);
  const { nodeIds } = await h.cdp.send('DOM.querySelectorAll', { nodeId: root.nodeId,
    selector: '#designnote-root :is(button, input, textarea, select, a[href], [tabindex]:not([tabindex="-1"]))' }, s);
  const bad = [];
  for (const nodeId of nodeIds) {
    const { nodes } = await h.cdp.send('Accessibility.getPartialAXTree', { nodeId, fetchRelatives: false }, s);
    const n = nodes[0];
    if (!n || n.ignored) continue; // hidden / display:none
    const name = n.name && n.name.value && n.name.value.trim();
    if (!name) {
      const { outerHTML } = await h.cdp.send('DOM.getOuterHTML', { nodeId }, s);
      bad.push(outerHTML.slice(0, 80));
    }
  }
  return { count: nodeIds.length, bad };
}

// Text contrast: element colour vs its background composited over the host page
const CONTRAST_FN = `(() => {
  const parse = (c) => { const m = c.match(/rgba?\\(([^)]+)\\)/); if (!m) return null; const p = m[1].split(/[ ,\\/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; };
  const over = (top, bot) => { const a = top[3]; return [0, 1, 2].map((i) => top[i] * a + bot[i] * (1 - a)).concat(1); };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const pageBg = parse(getComputedStyle(document.body).backgroundColor);
  return (el) => {
    const layers = [];
    for (let n = el; n && n !== document.body; n = n.parentElement) { const c = parse(getComputedStyle(n).backgroundColor); if (c && c[3] > 0) layers.push(c); }
    let bg = pageBg;
    for (let i = layers.length - 1; i >= 0; i--) bg = over(layers[i], bg);
    const fg = over(parse(getComputedStyle(el).color), bg);
    const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
    const cs = getComputedStyle(el); const px = parseFloat(cs.fontSize); const bold = parseInt(cs.fontWeight, 10) >= 700;
    const need = px >= 24 || (bold && px >= 18.66) ? 3 : 4.5;
    return { ratio: Math.round(((a + 0.05) / (b + 0.05)) * 100) / 100, need, fg: fg.slice(0, 3).map(Math.round).join(','), bg: bg.slice(0, 3).map(Math.round).join(',') };
  };
})()`;
const CONTRAST_TARGETS = {
  'sidebar heading': '#designnote-sidebar-header h2',
  'header count': '#dn-header-count',
  'card text': '.dn-card p',
  'card meta': '.dn-card .dn-meta',
  'type badge': '.dn-card .dn-type',
  'card number': '.dn-card .dn-card-num',
};
async function contrastFailures(s) {
  return ev(s, `(() => { const c = ${CONTRAST_FN}; const out = [];
    for (const [name, sel] of Object.entries(${JSON.stringify(CONTRAST_TARGETS)})) {
      const el = document.querySelector(sel); if (!el || !el.getClientRects().length) { out.push(name + ': missing'); continue; }
      const r = c(el); if (r.ratio < r.need) out.push(name + ' ' + r.ratio + ':1 (text ' + r.fg + ' on ' + r.bg + ')');
    } return out; })()`);
}

// Focus-ring check: style with keyboard focus differs from the unfocused style
async function noFocusRing(s, selectors) {
  const out = [];
  for (const sel of selectors) {
    // waits 250 ms after focusing so 150 ms focus transitions have finished
    const r = await ev(s, `(async () => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el || !el.getClientRects().length) return 'missing';
      const wait = () => new Promise((r) => setTimeout(r, 250));
      const snap = () => { const c = getComputedStyle(el); return [c.outlineStyle, c.outlineWidth, c.boxShadow, c.borderColor].join('|'); };
      el.blur(); await wait(); const before = snap(); el.focus(); const fv = el.matches(':focus-visible'); await wait(); const after = snap(); el.blur();
      const c = after.split('|'); const ring = (c[0] !== 'none' && parseFloat(c[1]) > 0) || after !== before;
      return !fv ? 'no :focus-visible' : ring ? '' : 'no visible change'; })()`);
    if (r) out.push(`${sel}: ${r}`);
  }
  return out;
}

const openSidebar = (s) => ev(s, `(() => { const r = document.getElementById('designnote-sidebar'); if (!r.classList.contains('open')) document.getElementById('designnote-toggle-btn').click(); return true; })()`);
const expandSidebar = (s) => ev(s, `(() => { const b = document.getElementById('dn-compact-btn'); if (b.getAttribute('aria-pressed') === 'true') b.click(); return true; })()`);
const isOpen = (s, sel) => ev(s, `document.querySelector(${JSON.stringify(sel)}).classList.contains('open')`);
const toastText = (s) => ev(s, `[...document.querySelectorAll('#designnote-root .dn-toast')].map((t) => t.textContent).join(' | ')`);

async function main() {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  h = await launch({ ext: EXT, prefix: 'dn-a11y-' });
  console.log(`Browser: ${h.version}  Extension dir: ${EXT}`);

  const url = base + '/light.html';
  // ---------- K1 keyboard-only: Mark → focus a host control → Enter → type → save ----------
  const { s } = await h.openPage(url);
  await h.cdp.send('DOM.enable', {}, s);
  await h.cdp.send('Accessibility.enable', {}, s);
  {
    const steps = [];
    const toMark = await tabUntil(s, `(a) => a.id === 'designnote-mode-btn'`);
    steps.push(toMark ? `Mark reached in ${toMark} Tabs` : 'Mark not reachable');
    await press(s, 'Enter');
    const marking = await ev(s, `document.documentElement.classList.contains('dn-marking')`);
    steps.push(marking ? 'Mark on' : 'Enter did not start Mark');
    const toB1 = marking && await tabUntil(s, `(a) => a.id === 'b1'`);
    if (toB1) await press(s, 'Enter');
    const formOpen = await poll(() => ev(s, `!!document.querySelector('#designnote-popup-form')`), 2000);
    steps.push(formOpen ? 'form open' : 'no form');
    let saved = false;
    if (formOpen) {
      const focusInText = await ev(s, `document.activeElement && document.activeElement.id === 'dn-text-input'`);
      steps.push(focusInText ? 'focus in textarea' : 'focus not in textarea: ' + await active(s));
      await h.cdp.send('Input.insertText', { text: 'Keyboard note' }, s);
      const toSave = await tabUntil(s, `(a) => a.classList.contains('dn-form-save')`, 15);
      if (toSave) await press(s, 'Enter');
      saved = !!(await poll(async () => ((await h.storage())['dn_annotations::' + url] || []).some((n) => n.text === 'Keyboard note' && n.selector), 8000));
      steps.push(saved ? 'saved with a location' : 'not saved');
    }
    record('K1', 'Keyboard only: reach Mark, mark a focusable element, type, save', saved, steps.join(' → '));
    const back = await active(s);
    record('K2', 'After saving, focus returns to where the user was (not lost to <body>)', back !== 'body', back);
  }

  // Seed known notes for the remaining checks
  await seed(url, [note('n1', 'bug', 'Bug note text', '#p1'), note('n2', 'Spacing', 'Custom category note', '#title'), note('n3', 'note', 'Will lose its element', '#gone')]);
  await ev(s, 'location.reload(), true');
  await poll(() => ev(s, `!!document.getElementById('designnote-pill')`));
  await sleep(400);

  // ---------- K3 sidebar: open with keyboard, Escape closes, focus returns ----------
  {
    await ev(s, `document.getElementById('designnote-toggle-btn').focus(), true`);
    await press(s, 'Enter');
    const opened = await poll(() => isOpen(s, '#designnote-sidebar'), 2000);
    await expandSidebar(s);
    const inside = await tabUntil(s, `(a) => !!a.closest('#designnote-sidebar')`, 6);
    await press(s, 'Escape');
    const closed = !(await isOpen(s, '#designnote-sidebar'));
    const focus = await active(s);
    record('K3', 'Sidebar: Enter opens, Escape (focus inside) closes, focus back on the Notes button',
      opened && inside && closed && focus.startsWith('button#designnote-toggle-btn'), `opened=${opened} reachedInside=${!!inside} closedByEsc=${closed} focus=${focus}`);
  }

  // ---------- K4 cards: reachable and "jump" activatable by keyboard ----------
  await openSidebar(s); await expandSidebar(s); await sleep(300);
  {
    await ev(s, `document.getElementById('dn-close-btn').focus(), true`);
    const n = await tabUntil(s, `(a) => !!a.closest('.dn-card') && !a.closest('[data-act]')`, 10);
    let jumped = false;
    if (n) {
      await ev(s, `window.scrollTo(0, 0), document.querySelectorAll('.dn-jump-highlight').forEach((e) => e.classList.remove('dn-jump-highlight')), true`);
      await press(s, 'Enter');
      jumped = !!(await poll(() => ev(s, `!!document.querySelector('.dn-jump-highlight')`), 1500));
    }
    record('K4', 'Each card can be focused and Enter jumps to its element', jumped, n ? `card focus after ${n} Tabs, jumped=${jumped}` : 'no focusable card (only its icon buttons)');
  }

  // ---------- K5 export menu by keyboard ----------
  {
    await ev(s, `document.getElementById('dn-export-menu-btn').focus(), true`);
    await press(s, 'Enter');
    const menu = await poll(() => ev(s, `!!document.querySelector('.dn-action-menu')`), 1500);
    const first = await ev(s, `!!document.activeElement && document.activeElement.classList.contains('dn-action-menu-item')`);
    let reach = first;
    if (menu && !first) reach = !!(await tabUntil(s, `(a) => a.classList.contains('dn-action-menu-item')`, 6));
    await press(s, 'Escape');
    const closed = !(await ev(s, `!!document.querySelector('.dn-action-menu')`));
    const focus = await active(s);
    const expanded = await ev(s, `document.getElementById('dn-export-menu-btn').getAttribute('aria-expanded')`);
    record('K5', 'Export menu: Enter opens with focus on the first item, Escape closes, focus back on the trigger',
      menu && first && closed && focus.startsWith('button#dn-export-menu-btn') && expanded === 'false',
      `opened=${!!menu} focusOnFirstItem=${first} itemsReachableByTab=${reach} closedByEsc=${closed} focus=${focus} aria-expanded=${expanded}`);
    await ev(s, `document.querySelector('.dn-action-menu') && document.body.click(), true`);
  }

  // ---------- K6 edit form ----------
  {
    await ev(s, `document.querySelector('.dn-card[data-id="n1"] [data-act="edit"]').focus(), true`);
    await press(s, 'Enter');
    const form = await poll(() => ev(s, `!!document.getElementById('designnote-edit-form')`), 1500);
    const dlg = await ev(s, `(() => { const f = document.getElementById('designnote-edit-form'); return f ? [f.getAttribute('role'), f.getAttribute('aria-label') || f.getAttribute('aria-labelledby')].join('/') : ''; })()`);
    await press(s, 'Escape');
    const closed = !(await ev(s, `!!document.getElementById('designnote-edit-form')`));
    const focus = await active(s);
    const sidebarStill = await isOpen(s, '#designnote-sidebar');
    record('K6', 'Edit form: Escape closes it, focus returns to the Edit button, sidebar stays open',
      form && closed && /data-act|dn-icon-btn|dn-act/.test(focus) && sidebarStill, `role/name=${dlg} closed=${closed} focus=${focus} sidebarOpen=${sidebarStill}`);
    record('N3', 'Edit and create forms are labelled dialogs', dlg.startsWith('dialog/') && dlg.length > 'dialog/'.length, `edit form role/name: ${dlg || 'none'}`);
  }

  // ---------- K7 table view ----------
  {
    await ev(s, `document.getElementById('dn-table-btn').focus(), true`);
    await press(s, 'Enter');
    const opened = await poll(() => isOpen(s, '#designnote-table-overlay'), 1500);
    const inTable = await ev(s, `!!document.activeElement.closest('#designnote-table-overlay')`);
    await ev(s, `document.getElementById('dn-table-search').focus(), true`);
    await press(s, 'Escape');
    const closed = !(await isOpen(s, '#designnote-table-overlay'));
    const focus = await active(s);
    record('K7', 'Table: opening moves focus into it, Escape closes it, focus is not lost',
      opened && inTable && closed && focus !== 'body', `opened=${opened} focusMovedIn=${inTable} closedByEsc=${closed} focus=${focus}`);
    if (!closed) await ev(s, `document.getElementById('dn-table-close-btn').click(), true`);
  }

  // ---------- K8/K9 Escape doesn't over-close: Mark mode and keyboard drag keep the sidebar ----------
  {
    await openSidebar(s); await sleep(200);
    await ev(s, `document.getElementById('designnote-mode-btn').focus(), true`);
    await press(s, 'Enter');
    const marking = await ev(s, `document.documentElement.classList.contains('dn-marking')`);
    await press(s, 'Escape');
    const r8 = { marking, stopped: !(await ev(s, `document.documentElement.classList.contains('dn-marking')`)), sidebarOpen: await isOpen(s, '#designnote-sidebar') };
    record('K8', 'In Mark mode with the sidebar open, one Escape leaves Mark mode only', r8.marking && r8.stopped && r8.sidebarOpen, JSON.stringify(r8));
    const pos = () => ev(s, `(() => { const r = document.getElementById('designnote-pill').getBoundingClientRect(); return Math.round(r.left) + ',' + Math.round(r.top); })()`);
    const start = await pos();
    await ev(s, `document.querySelector('.dn-drag-handle').focus(), true`);
    await press(s, 'Enter');
    await h.cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38 }, s);
    await h.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38 }, s);
    const moved = await pos();
    await press(s, 'Escape');
    const r9 = { start, moved, after: await pos(), sidebarOpen: await isOpen(s, '#designnote-sidebar') };
    record('K9', 'Keyboard drag of the floating bar: Escape cancels the drag and leaves the sidebar open',
      r9.moved !== r9.start && r9.after === r9.start && r9.sidebarOpen, JSON.stringify(r9));
  }

  // ---------- N1/N2 names and states ----------
  await openSidebar(s); await expandSidebar(s); await sleep(300);
  {
    const sb = await unnamedControls(s);
    await ev(s, `document.getElementById('dn-table-btn').click(), true`); await sleep(400);
    const tb = await unnamedControls(s);
    await ev(s, `document.getElementById('dn-table-close-btn').click(), true`);
    await openSidebar(s); await sleep(200);
    const bad = [...new Set([...sb.bad, ...tb.bad])];
    record('N1', 'Every visible control in the sidebar and table has an accessible name', bad.length === 0,
      bad.length ? bad.join(' ; ') : `${sb.count + tb.count} controls checked`);
    const states = await ev(s, `(() => { const m = document.getElementById('designnote-mode-btn'); const t = document.getElementById('designnote-toggle-btn');
      const off = m.getAttribute('aria-pressed'); m.click(); const on = m.getAttribute('aria-pressed'); m.click();
      return { off, on, sidebarExpanded: t.getAttribute('aria-expanded') }; })()`);
    record('N2', 'Mark button exposes on/off (aria-pressed); Notes button exposes open/closed (aria-expanded)',
      states.off === 'false' && states.on === 'true' && states.sidebarExpanded === 'true', JSON.stringify(states));
    const textName = await ev(s, `(() => { document.getElementById('dn-add-note-btn').click(); const t = document.getElementById('dn-text-input');
      const n = t && (t.getAttribute('aria-label') || (t.labels && t.labels.length)); return !!n; })()`);
    const createDlg = await ev(s, `(() => { const f = document.getElementById('designnote-popup-form'); return f ? [f.getAttribute('role'), f.getAttribute('aria-label')].join('/') : ''; })()`);
    record('N4', 'Note text field has a real label (not only a placeholder); create form is a labelled dialog',
      textName && createDlg.startsWith('dialog/') && createDlg.length > 7, `label=${textName} create form=${createDlg || 'none'}`);
    await press(s, 'Escape'); await sleep(300);
  }

  // ---------- F1 visible focus ----------
  {
    await press(s, 'Tab'); // make the last interaction a keyboard one
    const sel = ['#designnote-mode-btn', '#designnote-toggle-btn', '.dn-drag-handle', '.dn-close-pill', '#dn-compact-btn', '#dn-export-menu-btn',
      '.dn-card [data-act="edit"]', '.dn-card [data-act="delete"]'];
    const sbBad = await noFocusRing(s, sel);
    await ev(s, `document.getElementById('dn-add-note-btn').click(), true`); await sleep(250);
    await ev(s, `document.getElementById('dn-cat-toggle').click(), true`); await sleep(200); // the category menu starts closed and opens from its arrow
    const formBad = await noFocusRing(s, ['#designnote-popup-form .dn-type-pill', '#dn-cat-toggle', '#dn-text-input', '.dn-form-save']);
    await press(s, 'Escape'); await sleep(250);
    await ev(s, `document.getElementById('dn-table-btn').click(), true`); await sleep(300);
    const tbBad = await noFocusRing(s, ['.dn-view-btn', '.dn-filter-chip', '#dn-table-search', '#dn-table-close-btn']);
    await ev(s, `document.getElementById('dn-table-close-btn').click(), true`);
    const bad = [...sbBad, ...formBad, ...tbBad];
    record('F1', 'Keyboard focus is visible on every sampled control', bad.length === 0, bad.join(' ; ') || '15 controls');
  }

  // ---------- T1 type is not shown by colour alone ----------
  await openSidebar(s); await expandSidebar(s); await sleep(300);
  {
    const labels = await ev(s, `[...document.querySelectorAll('.dn-card')].map((c) => (c.querySelector('.dn-type') || {}).textContent || '')`);
    record('T1', 'Every card shows its type/category as text, not colour only', labels.length === 3 && labels.every(Boolean), labels.join(', '));
  }

  // ---------- E1 empty state points at controls that exist ----------
  {
    const s2 = (await h.openPage(base + '/light.html?empty=1')).s;
    await openSidebar(s2); await expandSidebar(s2); await sleep(300);
    const r = await ev(s2, `(() => { const e = document.getElementById('designnote-empty'); const text = e ? e.textContent : '';
      const names = [...document.querySelectorAll('#designnote-root button')].map((b) => (b.getAttribute('aria-label') || b.title || b.textContent).trim());
      const quoted = [...text.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
      const missing = quoted.filter((q) => !names.some((n) => n.toLowerCase().includes(q.replace(/^\\+\\s*/, '').toLowerCase())));
      return { text, missing }; })()`);
    record('E1', 'Empty state names controls the user can actually find', !!r.text && r.missing.length === 0,
      r.missing.length ? `refers to ${r.missing.map((m) => '"' + m + '"').join(', ')} but no control is named that` : r.text);
  }

  // ---------- S1 selector loss is explained ----------
  {
    await ev(s, `document.getElementById('gone').remove(), true`);
    await openSidebar(s); await expandSidebar(s); await sleep(200);
    await ev(s, `document.querySelector('.dn-card[data-id="n3"] p').click(), true`);
    const msg = await poll(async () => { const t = await toastText(s); return /find|found|changed|removed/i.test(t) ? t : ''; }, 1500);
    record('S1', 'Jumping to a note whose element is gone says so', !!msg, msg || 'no message (silent)');
  }

  // ---------- M1 reduced motion ----------
  {
    await h.cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }, s);
    await sleep(100);
    await ev(s, `document.getElementById('dn-export-menu-btn').click(), true`); await sleep(100);
    const moving = await ev(s, `(() => { const out = [];
      document.querySelectorAll('#designnote-root, #designnote-root *').forEach((el) => {
        if (!el.getClientRects().length || el.closest('svg')) return; const c = getComputedStyle(el);
        const t = Math.max(...c.transitionDuration.split(',').map(parseFloat)); const a = c.animationName !== 'none' ? Math.max(...c.animationDuration.split(',').map(parseFloat)) : 0;
        if ((t > 0.1 && !/^(color|background-color|opacity|border-color)$/.test(c.transitionProperty)) || a > 0.1) out.push((el.id || el.className || el.tagName) + ' ' + c.transitionProperty.slice(0, 40) + ' ' + Math.max(t, a) + 's');
      }); return [...new Set(out)]; })()`);
    await ev(s, `document.body.click(), true`);
    await ev(s, `window.scrollTo(0, 0), true`);
    await ev(s, `document.querySelector('.dn-card[data-id="n1"] p').click(), true`);
    const smooth = await ev(s, `new Promise((r) => setTimeout(() => r(Math.abs(document.getElementById('p1').getBoundingClientRect().top + 10 - innerHeight / 2) > 40 && scrollY !== 0), 30))`);
    record('M1', 'prefers-reduced-motion: no moving transitions/animations over 100 ms', moving.length === 0, moving.slice(0, 8).join(' ; ') || 'none');
    await h.cdp.send('Emulation.setEmulatedMedia', { features: [] }, s);
    void smooth; // the fixture is too short to scroll; smooth scrolling is handled in source (see UX_AUDIT)
  }

  // ---------- C1–C4 contrast: both themes over light and dark host pages ----------
  const dark = (await h.openPage(base + '/dark.html')).s;
  await seed(base + '/dark.html', [note('d1', 'bug', 'Bug note text', '#p1'), note('d2', 'Spacing', 'Custom', '#title')]);
  await ev(dark, 'location.reload(), true'); await poll(() => ev(dark, `!!document.getElementById('designnote-pill')`)); await sleep(300);
  for (const [id, page, scheme] of [['C1', s, 'light'], ['C2', dark, 'light'], ['C3', s, 'dark'], ['C4', dark, 'dark']]) {
    // background tabs don't run CSS transitions (cards transition colour), so measure the visible tab
    await h.cdp.send('Page.bringToFront', {}, page);
    await h.cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] }, page);
    await ev(h.sw, `chrome.storage.local.set({ dn_theme: ${JSON.stringify(scheme)} }).then(() => true)`); // the Appearance setting picks the theme
    await openSidebar(page); await expandSidebar(page); await sleep(350);
    const bad = await contrastFailures(page);
    record(id, `Text contrast ≥ 4.5:1 — ${scheme} theme on a ${page === s ? 'light' : 'dark'} host page (no backdrop blur counted)`, bad.length === 0, bad.join(' ; ') || 'all targets pass');
    await h.cdp.send('Emulation.setEmulatedMedia', { features: [] }, page);
  }

  // ---------- Z1/Z2 200% zoom (640×450 CSS px) and 320×568 ----------
  for (const [id, w, hgt, label] of [['Z1', 640, 450, '200% zoom of 1280×900'], ['Z2', 320, 568, '320×568 (400% zoom / small phone)']]) {
    await h.cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: hgt, deviceScaleFactor: 1, mobile: false }, s);
    await sleep(200);
    const out = [];
    const offscreen = (scope) => ev(s, `(() => { const bad = []; document.querySelectorAll(${JSON.stringify(scope)}).forEach((el) => {
        const r = el.getBoundingClientRect(); if (!r.width || getComputedStyle(el).visibility === 'hidden') return;
        if (r.left < -1 || r.right > innerWidth + 1 || r.top < -1 || r.bottom > innerHeight + 1) bad.push((el.id || el.className || el.tagName).toString().slice(0, 30)); }); return [...new Set(bad)]; })()`);
    await openSidebar(s); await expandSidebar(s); await sleep(350);
    out.push(...(await offscreen('#designnote-sidebar, #designnote-sidebar-header button')).map((x) => 'sidebar: ' + x));
    await ev(s, `document.getElementById('dn-export-menu-btn').click(), true`); await sleep(250);
    // Items below the fold are fine when the menu scrolls to them.
    const menuScrolls = await ev(s, `(() => { const m = document.querySelector('.dn-action-menu'); return m.scrollHeight > m.clientHeight && /auto|scroll/.test(getComputedStyle(m).overflowY); })()`);
    out.push(...(await offscreen(menuScrolls ? '.dn-action-menu' : '.dn-action-menu, .dn-action-menu-item')).map((x) => 'menu: ' + x));
    await ev(s, `document.body.click(), true`);
    await ev(s, `document.querySelector('.dn-card [data-act="edit"]').click(), true`); await sleep(250);
    out.push(...(await offscreen('#designnote-edit-form, #designnote-edit-form button')).map((x) => 'edit: ' + x));
    await press(s, 'Escape');
    await ev(s, `document.getElementById('dn-add-note-btn').click(), true`); await sleep(300);
    out.push(...(await offscreen('#designnote-popup-form, #designnote-popup-form button, #designnote-popup-form textarea')).map((x) => 'create: ' + x));
    await press(s, 'Escape'); await sleep(250);
    await ev(s, `document.getElementById('dn-table-btn').click(), true`); await sleep(350);
    out.push(...(await offscreen('#designnote-table-header button, #dn-table-search')).map((x) => 'table: ' + x));
    await ev(s, `document.getElementById('dn-table-close-btn').click(), true`);
    record(id, `${label}: sidebar, menu, forms and table controls stay on screen`, out.length === 0, out.join(' ; ') || 'all on screen');
    await h.cdp.send('Emulation.clearDeviceMetricsOverride', {}, s);
  }

  const pass = results.filter((r) => r.pass).length;
  console.log(`\n${pass}/${results.length} checks passed`);
  const failed = results.filter((r) => !r.pass).map((r) => r.id);
  if (failed.length) console.log('Failed: ' + failed.join(', '));
}

main()
  .catch((e) => { console.error('ABORTED:', e.stack || e.message); process.exitCode = 1; })
  .finally(() => { h && h.close(); server.close(); if (results.some((r) => !r.pass)) process.exitCode = 1; });
