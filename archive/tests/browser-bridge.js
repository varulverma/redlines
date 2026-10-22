// Run: node tests/browser-bridge.js   (HEADED=1 to watch)
// End-to-end check of the AI agent bridge: real Chrome + the unpacked extension, and the real
// MCP server (mcp/redlines-mcp.js) driven over stdio exactly as an AI tool would. Covers the
// security rules (origin, pairing code, shared sites, screenshots, read-only by default), the
// site → section → page → category structure, writes showing up in the sidebar, and Re-pin.
const path = require('path');
const http = require('http');
const net = require('net');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { launch, recorder, sleep, poll } = require('./lib/cdp');

const EXT = path.join(__dirname, '..', '..');
const SERVER = path.join(EXT, 'mcp', 'redlines-mcp.js');
const TOKEN = crypto.randomBytes(24).toString('base64url');
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PAGE = `<!doctype html><html><head><title>Checkout</title></head><body style="font:14px sans-serif">
<h1>Checkout</h1><form aria-label="Payment" onsubmit="return false"><button data-testid="pay">Pay now</button>
<button id="new-target" type="button" style="margin:40px">New spot</button></form></body></html>`;

const freePort = () => new Promise((r) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });

// A raw WebSocket attempt, as a web page or another local program would make it.
function rawWs(port, origin, token) {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/redlines', headers: {
      Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13',
      'Sec-WebSocket-Key': crypto.randomBytes(16).toString('base64'), Origin: origin } });
    req.on('response', (res) => resolve({ status: res.statusCode }));
    req.on('upgrade', (res, socket) => {
      const payload = Buffer.from(JSON.stringify({ type: 'hello', token }));
      const mask = crypto.randomBytes(4);
      socket.write(Buffer.concat([Buffer.from([0x81, 0x80 | payload.length]), mask, Buffer.from(payload.map((b, i) => b ^ mask[i & 3]))]));
      let got = '';
      socket.on('data', (d) => { got += d.subarray(2).toString(); });
      socket.on('close', () => resolve({ status: 101, reply: got }));
      setTimeout(() => socket.destroy(), 3000);
    });
    req.on('error', (e) => resolve({ error: e.message }));
    req.end();
  });
}

(async () => {
  const { results, record } = recorder();
  const site = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(PAGE); });
  await new Promise((r) => site.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${site.address().port}`;
  const CHECKOUT = `${base}/shop/checkout`;
  const PORT = await freePort();

  // One MCP server per AI tool, as each tool starts its own (the second one takes the next port)
  function startServer() {
    const proc = spawn(process.execPath, [SERVER], { env: { ...process.env, REDLINES_TOKEN: TOKEN, REDLINES_PORT: String(PORT) }, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let rid = 0;
    const waiters = new Map();
    proc.stdout.on('data', (d) => {
      out += d;
      let i;
      while ((i = out.indexOf('\n')) >= 0) {
        const m = JSON.parse(out.slice(0, i));
        out = out.slice(i + 1);
        if (waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); }
      }
    });
    const rpc = (method, params) => new Promise((r) => { const id = ++rid; waiters.set(id, r); proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
    const tool = async (name, args) => (await rpc('tools/call', { name, arguments: args || {} })).result;
    return { proc, rpc, tool };
  }
  const { proc: srv, rpc, tool } = startServer();
  let srv2 = null;
  const text = (r) => r.content.find((c) => c.type === 'text').text;
  const json = (r) => JSON.parse(text(r));

  const h = await launch({ ext: EXT, prefix: 'dn-bridge-' });
  const sw = (expr) => h.ev(h.sw, expr);
  const notes = async (url) => (await h.storage())['dn_annotations::' + url] || [];
  try {
    const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-code', version: '1' } });
    const tools = (await rpc('tools/list', {})).result.tools.map((t) => t.name);
    record('B1', 'MCP handshake + 10 tools', init.result.serverInfo.name === 'redlines' && tools.length === 10, tools.join(', '));

    await sw(`chrome.storage.local.set(${JSON.stringify({
      ['dn_annotations::' + CHECKOUT]: [
        { id: 'n1', type: 'note', text: 'Pay button overlaps the total', selector: 'button[data-testid="pay"]', fingerprint: null,
          anchor: { describe: 'button "Pay now" in form "Payment" under "Checkout"', testId: 'pay' }, pageTitle: 'Checkout', rect: null, screenshot: PNG, timestamp: 1 },
        { id: 'n2', type: 'note', text: 'Old banner is misaligned', selector: '#gone', fingerprint: null, rect: null, screenshot: null, timestamp: 2 },
      ],
      ['dn_annotations::' + base + '/shop/']: [{ id: 'n3', type: 'Copy', text: 'Say hello', selector: null, timestamp: 3 }],
      'dn_annotations::https://bank.example.com/account': [{ id: 'p1', type: 'note', text: 'secret', selector: null, timestamp: 4 }],
      dn_bridge_port: PORT, dn_bridge_token: TOKEN, dn_bridge_enabled: true,
    })}).then(() => true)`);
    const connected = await poll(() => sw(`chrome.storage.session.get('dn_bridge_status').then((r) => r.dn_bridge_status === 'connected')`), 15000);
    record('B2', 'extension connects with the pairing code', !!connected);

    // ---- security ----
    const evil = await rawWs(PORT, 'https://evil.example', TOKEN);
    record('B3', 'web page origin refused (even with the right code)', evil.status === 403, JSON.stringify(evil));
    const badCode = await rawWs(PORT, 'chrome-extension://abcdefghijklmnop', 'wrong-code-wrong-code');
    record('B4', 'wrong pairing code refused', badCode.status === 101 && /does not match/.test(badCode.reply), JSON.stringify(badCode));
    const plainHttp = await new Promise((r) => http.get(`http://127.0.0.1:${PORT}/`, (res) => r(res.statusCode)));
    record('B5', 'plain HTTP reveals nothing', plainHttp === 404, String(plainHttp));

    // ---- structure ----
    const ov = json(await tool('get_overview'));
    record('B6', 'only shared sites are visible', ov.summary.notes === 3 && ov.sites.length === 1 && !JSON.stringify(ov).includes('bank'), JSON.stringify(ov.summary));
    const list = json(await tool('list_annotations'));
    const shop = list.sites[0].sections.find((s) => s.section === '/shop');
    const checkout = shop && shop.pages.find((p) => p.path === '/shop/checkout');
    record('B7', 'grouped site → section → page → category',
      !!checkout && shop.pages.map((p) => p.path).join() === '/shop/,/shop/checkout' && checkout.title === 'Checkout' &&
      checkout.categories[0].category === 'Bug' && checkout.categories[0].notes.length === 2,
      JSON.stringify(shop.pages.map((p) => [p.path, (p.categories || []).map((c) => c.category + ':' + c.notes.length)])));
    record('B8', 'notes carry element description + selector', checkout.categories[0].notes[0].element.startsWith('button "Pay now"'), checkout.categories[0].notes[0].element);

    const full = await tool('get_annotation', { id: 'n1' });
    record('B9', 'screenshot sent as an image when allowed', full.content.some((c) => c.type === 'image' && c.mimeType === 'image/png'));
    await sw(`chrome.storage.local.set({ dn_bridge_screenshots: false }).then(() => true)`);
    const noShot = await tool('get_annotation', { id: 'n1' });
    record('B10', 'no screenshot when the user turns it off', !noShot.content.some((c) => c.type === 'image') && !text(noShot).includes('base64'));
    const priv = await tool('get_annotation', { id: 'p1' });
    record('B11', 'note on a private site cannot be read by id', priv.isError === true, text(priv));

    // ---- writes: read-only until allowed ----
    const ro = await tool('resolve_annotation', { id: 'n1', text: 'Fixed' });
    record('B12', 'read-only by default', ro.isError === true && /not change/.test(text(ro)), text(ro));
    await sw(`chrome.storage.local.set({ dn_bridge_write: true }).then(() => true)`);
    await tool('resolve_annotation', { id: 'n1', text: 'Fixed spacing in Checkout.tsx <b>' });
    const n1 = (await notes(CHECKOUT)).find((a) => a.id === 'n1');
    record('B13', 'resolve with a reply', n1.status === 'resolved' && n1.resolvedBy === 'ai' && n1.replies[0].by === 'ai', JSON.stringify({ status: n1.status, replies: n1.replies }));
    const added = await tool('add_annotation', { url: CHECKOUT, text: 'Missing focus ring', selector: '#new-target' });
    const blocked = await tool('add_annotation', { url: 'https://bank.example.com/account', text: 'x' });
    record('B14', 'add on shared site only', !added.isError && blocked.isError === true, text(blocked));

    // ---- what the user sees ----
    const { s } = await h.openPage(CHECKOUT);
    await h.domClick(s, '#designnote-toggle-btn');
    await poll(() => h.ev(s, `!!document.querySelector('.dn-card[data-id="n2"]')`));
    const ui = await h.ev(s, `(() => {
      const card = (id) => document.querySelector('.dn-card[data-id="' + id + '"]');
      const aiCard = [...document.querySelectorAll('.dn-card')].find((c) => c.textContent.includes('Missing focus ring'));
      return {
        resolved: !!card('n1').querySelector('.dn-tag-done'),
        reply: (card('n1').querySelector('.dn-reply') || {}).textContent,
        escaped: !card('n1').querySelector('.dn-reply b'),
        aiTag: !!aiCard && [...aiCard.querySelectorAll('.dn-tag')].some((t) => t.textContent === 'AI'),
        lost: !!card('n2').querySelector('.dn-tag-lost') && !!card('n2').querySelector('[data-act="repin"]'),
        okNotLost: !card('n1').querySelector('.dn-tag-lost'),
      }; })()`);
    record('B15', 'sidebar shows Resolved, AI reply (escaped) and AI tag', ui.resolved && /AI\s*Fixed spacing/.test(ui.reply) && ui.escaped && ui.aiTag, JSON.stringify(ui));
    record('B16', 'lost element flagged with Re-pin', ui.lost && ui.okNotLost, JSON.stringify(ui));

    await h.domClick(s, '.dn-card[data-id="n2"] [data-act="repin"]');
    const [x, y] = await h.center(s, '#new-target');
    await sleep(150);
    await h.realClick(s, x, y);
    const repinned = await poll(async () => ((await notes(CHECKOUT)).find((a) => a.id === 'n2') || {}).selector === '#new-target', 5000);
    record('B17', 'Re-pin saves the newly picked element', !!repinned);

    // AI agent edits refresh an open sidebar without reload
    await tool('reopen_annotation', { id: 'n1' });
    const live = await poll(() => h.ev(s, `!document.querySelector('.dn-card[data-id="n1"] .dn-tag-done')`), 5000);
    record('B18', 'open sidebar updates live after an agent change', !!live);

    const shown = await tool('show_annotation', { id: 'n1' });
    const highlighted = await poll(() => h.ev(s, `!!document.querySelector('.dn-jump-highlight')`), 5000, 50);
    record('B19', 'show_annotation highlights the element', !shown.isError && !!highlighted, text(shown));

    const cur = json(await tool('get_current_page'));
    record('B20', 'get_current_page returns the open page', cur.url === CHECKOUT && cur.summary.notes === 3, cur.url);

    // ---- send a note to one agent ----
    const agentIds = () => sw(`chrome.storage.session.get('dn_bridge_agents').then((r) => (r.dn_bridge_agents || []).map((a) => a.id).sort().join())`);
    record('B23', 'connected agent identified from MCP clientInfo', (await agentIds()) === 'claude-code', await agentIds());
    srv2 = startServer();
    await srv2.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'codex-mcp-client', version: '1' } });
    await sleep(300);
    await sw('connectBridge().then(() => true)'); // instead of waiting for the 30 s reconnect alarm
    const both = await poll(async () => (await agentIds()) === 'claude-code,codex', 8000);
    record('B24', 'a second AI tool takes the next port and is listed too', !!both, await agentIds());

    // ---- toolbar popup: which agents are connected, blinking while one works, details on hover ----
    const { s: pop } = await h.openPage(`chrome-extension://${h.extId}/popup.html`, { waitPill: false });
    const chips = await poll(() => h.ev(pop, `(() => { const ids = [...document.querySelectorAll('.agent-wrap')].map((w) => w.dataset.agent).sort().join();
      return ids === 'claude-code,codex' ? document.getElementById('agents-count').textContent + ' ' + ids : null; })()`), 5000);
    record('B31', 'popup lists the connected agents and how many', chips === '2 connected claude-code,codex', String(chips));
    await sleep(2600); // let the blink from earlier requests fade
    const codexState = `(() => { const w = document.querySelector('.agent-wrap[data-agent="codex"]');
      return w.querySelector('.agent').classList.contains('busy') + ':' + w.querySelector('.card-state').textContent; })()`;
    const idle = await h.ev(pop, codexState);
    await srv2.tool('get_overview');
    const working = await poll(async () => { const v = await h.ev(pop, codexState); return v.startsWith('true') ? v : null; }, 3000, 50);
    const calm = await poll(async () => { const v = await h.ev(pop, codexState); return v.startsWith('false') ? v : null; }, 5000);
    record('B32', 'the agent blinks while it works, then settles', idle === 'false:Connected' && working === 'true:Working…' && calm === 'false:Connected', `${idle} → ${working} → ${calm}`);
    const cardShown = `getComputedStyle(document.querySelector('.agent-wrap[data-agent="codex"] .agent-card')).display !== 'none'`;
    const hiddenBefore = !(await h.ev(pop, cardShown));
    const [cx, cy] = await h.center(pop, '.agent-wrap[data-agent="codex"] .agent');
    await h.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx, y: cy }, pop);
    const card = await poll(async () => (await h.ev(pop, cardShown)) && h.ev(pop, `document.querySelector('.agent-wrap[data-agent="codex"] .agent-card').innerText`), 3000);
    record('B33', 'hovering an agent shows its details', hiddenBefore && !!card && /Requests\s+\d+/.test(card) && /Can see\s+\d+ notes?/.test(card) && /Listed notes/.test(card), String(card).replace(/\s+/g, ' '));
    if (process.env.SHOT_DIR) {
      const r = await h.ev(pop, `(() => { const b = document.body.getBoundingClientRect(); return { x: 0, y: 0, width: b.width, height: b.height, scale: 2 }; })()`);
      const shot = await h.cdp.send('Page.captureScreenshot', { format: 'png', clip: r }, pop);
      require('fs').writeFileSync(path.join(process.env.SHOT_DIR, 'popup-agents.png'), Buffer.from(shot.data, 'base64'));
    }

    await h.domClick(s, '#dn-add-note-btn');
    await poll(() => h.ev(s, `!!document.querySelector('#designnote-popup-form')`), 3000);
    // Every active agent is an icon-only button under Esc/Save, at the far right
    const pills = await poll(() => h.ev(s, `(() => { const row = document.querySelector('#designnote-popup-form #dn-form-agents'); if (!row || row.hidden) return null;
      const p = [...row.querySelectorAll('button')]; const save = document.querySelector('#designnote-popup-form .dn-form-save').getBoundingClientRect(); const r = row.getBoundingClientRect();
      const cap = document.querySelector('#designnote-popup-form .dn-form-cap'); const capSel = cap.querySelector('.dn-form-sel').getBoundingClientRect();
      const placed = row.parentElement === cap && r.top >= save.bottom - 1 && Math.abs((r.top + r.height / 2) - (capSel.top + capSel.height / 2)) < 8 && r.left > capSel.left && Math.abs(row.lastElementChild.getBoundingClientRect().right - save.right) < 14;
      return placed + '|' + p.map((b) => b.dataset.agentId + ':' + (b.textContent.trim() === '') + ':' + getComputedStyle(b.querySelector('.dn-agent-ico')).maskImage.includes('icons/agents/' + b.dataset.agentId + '.svg')).sort().join(); })()`), 5000);
    record('B25', 'note form shows every active agent as an icon-only button at the right end of the selector caption line, with its logo', pills === 'true|claude-code:true:true,codex:true:true', String(pills));
    await h.ev(s, `document.querySelector('#dn-text-input').value = 'Make the total bold'`);
    await h.domClick(s, '#designnote-popup-form #dn-form-agents button[data-agent-id="codex"]');
    await h.domClick(s, '#designnote-popup-form .dn-form-save');
    const sent = await poll(async () => (await notes(CHECKOUT)).find((a) => a.text === 'Make the total bold'), 5000);
    record('B26', 'saved note is assigned to the picked agent', !!sent && !!sent.assignee && sent.assignee.id === 'codex' && sent.assignee.name === 'Codex', JSON.stringify(sent && sent.assignee));
    // The note's own Send button: first click takes it back, the next lists the agents
    await poll(() => h.ev(s, `!![...document.querySelectorAll('.dn-card')].find((c) => c.textContent.includes('Make the total bold'))`), 5000);
    await h.ev(s, `[...document.querySelectorAll('.dn-card')].find((c) => c.textContent.includes('Make the total bold')).querySelector('[data-act="agent"]').click()`);
    const takenBack = await poll(async () => { const a = (await notes(CHECKOUT)).find((x) => x.text === 'Make the total bold'); return a && !a.assignee; }, 5000);
    await sleep(400);
    await h.ev(s, `[...document.querySelectorAll('.dn-card')].find((c) => c.textContent.includes('Make the total bold')).querySelector('[data-act="agent"]').click()`);
    const menu = await poll(() => h.ev(s, `(() => { const p = [...document.querySelectorAll('.dn-action-menu .dn-action-menu-item')]; return p.length ? p.map((b) => b.textContent.trim()).sort().join() : null; })()`), 5000);
    await h.ev(s, `[...document.querySelectorAll('.dn-action-menu .dn-action-menu-item')].find((b) => b.textContent.includes('Codex')).click()`);
    const reassigned = await poll(async () => { const a = (await notes(CHECKOUT)).find((x) => x.text === 'Make the total bold'); return a && a.assignee && a.assignee.id === 'codex' ? a : null; }, 5000);
    record('B26b', "the note's Send button takes it back, then lists the agents to send it again", takenBack && /Claude Code,Codex/.test(String(menu)) && !!reassigned, `takenBack=${takenBack} menu=${menu}`);
    const mine = json(await srv2.tool('get_my_annotations'));
    const mineNotes = JSON.stringify(mine);
    const notMine = text(await tool('get_my_annotations'));
    record('B27', 'get_my_annotations: only the agent it was sent to gets it',
      mine.you === 'Codex' && mineNotes.includes('Make the total bold') && !mineNotes.includes('Pay button') && /No open notes are assigned to you \(Claude Code\)/.test(notMine), notMine);
    const tag = await poll(() => h.ev(s, `(() => { const c = [...document.querySelectorAll('.dn-card')].find((x) => x.textContent.includes('Make the total bold'));
      const t = c && c.querySelector('.dn-tag-agent'); return t ? t.textContent.trim() : null; })()`), 5000);
    record('B28', 'sidebar card shows who the note was sent to', tag === 'Codex', String(tag));
    // Sending a note on a site that isn't shared shares that one note with that one agent
    await sw(`chrome.storage.local.set({ 'dn_annotations::https://bank.example.com/account': [
      { id: 'p1', type: 'note', text: 'secret', selector: null, timestamp: 4 },
      { id: 'p2', type: 'note', text: 'Fix the statement table', selector: null, timestamp: 5, assignee: { id: 'claude-code', name: 'Claude Code' } }] }).then(() => true)`);
    const claudeSees = JSON.stringify(json(await tool('get_my_annotations')));
    const codexSees = JSON.stringify(json(await srv2.tool('get_overview'))) + text(await srv2.tool('get_annotation', { id: 'p2' }));
    record('B30', 'note sent from an unshared site reaches only that agent',
      claudeSees.includes('Fix the statement table') && !claudeSees.includes('secret') && !codexSees.includes('statement table'), claudeSees.slice(0, 120));
    srv2.proc.kill();
    const gone = await poll(async () => (await agentIds()) === 'claude-code', 5000);
    record('B29', 'closing an AI tool removes it from the list', !!gone, await agentIds());

    const log = (await h.storage()).dn_bridge_log || [];
    record('B21', 'every access is logged for the user', log.length >= 8 && log.some((e) => e.action === 'Resolved a note'), `${log.length} entries`);

    await sw(`chrome.storage.local.set({ dn_bridge_enabled: false }).then(() => true)`);
    await sleep(300);
    const off = await tool('get_overview');
    record('B22', 'turning it off cuts access', off.isError === true, text(off).slice(0, 80));
  } catch (e) {
    record('B0', 'harness', false, e.stack);
  } finally {
    h.close();
    srv.kill();
    if (srv2) srv2.proc.kill();
    site.close();
  }
  const failed = results.filter((r) => !r.pass).length;
  console.log(failed ? `browser-bridge: ${failed} FAILED` : 'browser-bridge: PASS');
  process.exit(failed ? 1 : 0);
})();
