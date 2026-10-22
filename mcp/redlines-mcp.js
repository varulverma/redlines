#!/usr/bin/env node
// Redlines MCP bridge — lets AI agents (Claude Code, Claude Desktop, Cursor, VS Code, Codex…)
// read and act on Redlines notes. No dependencies; Node 18+.
//
//   AI agent ⇄ (MCP over stdio) ⇄ this process ⇄ (WebSocket, 127.0.0.1 only) ⇄ extension
//
// Security: listens on loopback only; accepts only extension origins (web pages can't connect);
// the extension must prove the pairing token from Settings (REDLINES_TOKEN) before it is used.
// The extension enforces everything about the data itself (shared sites, screenshots, writes).
//
// Setup: Redlines Settings → Connect to AI agents shows the exact command, e.g.
//   claude mcp add redlines -e REDLINES_TOKEN=<token> -- node /path/to/mcp/redlines-mcp.js
'use strict';
const http = require('http');
const crypto = require('crypto');

const PORT = Number(process.env.REDLINES_PORT) || 17337;
const PORT_RANGE = 10; // one server per AI tool: each takes the next free port; the extension connects to all of them
const TOKEN = process.env.REDLINES_TOKEN || '';
const MAX_FRAME = 64 * 1024 * 1024; // screenshots are data URLs; a page of them can be large
const log = (...a) => process.stderr.write('[redlines-mcp] ' + a.join(' ') + '\n'); // stdout is the MCP channel

// ---------- Structure: site → section → page → category ----------
const PRESET_LABELS = { bug: 'Layout Bug', suggestion: 'Suggestion', text: 'Text Annotation', note: 'General Note' };
const GENERIC = new Set(['note', 'ui', 'general', 'general note', 'other', '']);

// Most notes are saved under the default category, which says nothing. For those, infer a kind
// from the wording so agents (and people) get useful groups.
// ponytail: keyword heuristic, first rule wins; swap for a model call if it mislabels too often.
const KIND_RULES = [
  ['Accessibility', /\b(a11y|accessib|contrast|screen ?reader|aria|alt text|keyboard|focus (ring|state|order)|tab order|wcag)/i],
  ['Bug', /\b(bug|broken|break|error|crash|fail|not working|doesn'?t work|wrong|overlap|overflow|cut off|clipp|misalign|glitch|404|500)/i],
  ['Copy / text', /\b(typo|spelling|grammar|wording|copy|rephrase|reword|text|label|headline|title|translate|capitali[sz])/i],
  ['Visual / layout', /\b(colou?r|spacing|padding|margin|font|size|align|big|bigger|small|smaller|large|larger|tiny|huge|width|height|radius|border|shadow|icon|layout|responsive|mobile|gap)\b/i],
  ['Question', /\?\s*$|^(why|how|what|should|can|could) /i],
  ['Suggestion', /\b(should|could|would be|maybe|consider|suggest|add|remove|instead|prefer|nice to)\b/i],
];
function inferKind(text) {
  for (const [kind, re] of KIND_RULES) if (re.test(text || '')) return kind;
  return 'General';
}
function categoryOf(n) {
  const type = String(n.type || '').trim();
  if (!GENERIC.has(type.toLowerCase())) return PRESET_LABELS[type.toLowerCase()] || type;
  return inferKind(n.text);
}

function pageParts(pageUrl) {
  try {
    const u = new URL(pageUrl);
    if (u.protocol === 'file:') return { site: 'local files', origin: 'file://', section: u.pathname.replace(/\/[^/]*$/, '/') || '/', path: u.pathname };
    const seg = u.pathname.split('/').filter(Boolean)[0];
    return { site: u.host, origin: u.origin, section: seg ? '/' + seg : '/', path: u.pathname + u.search };
  } catch (e) {
    return { site: pageUrl, origin: '', section: '/', path: pageUrl };
  }
}

// Which AI tool started this server, from MCP initialize clientInfo (Claude Code sends "claude-code",
// Codex "codex-mcp-client", Claude Desktop "claude-ai", Cursor "cursor-vscode", VS Code "Visual Studio Code").
// The id names the icon in icons/agents/<id>.svg. First match wins, so specific patterns come first.
const AGENTS = [
  ['claude-code', 'Claude Code', /claude[- ]?code/i],
  ['claude-desktop', 'Claude Desktop', /claude/i],
  ['codex', 'Codex', /codex/i],
  ['cursor', 'Cursor', /cursor/i],
  ['windsurf', 'Windsurf', /windsurf|codeium/i],
  ['gemini', 'Gemini CLI', /gemini/i],
  ['cline', 'Cline', /cline/i],
  ['zed', 'Zed', /\bzed\b/i],
  ['opencode', 'OpenCode', /opencode/i],
  ['copilot', 'GitHub Copilot', /visual studio code|vscode|copilot/i],
];
function agentFrom(clientInfo) {
  const raw = `${(clientInfo && clientInfo.name) || ''} ${(clientInfo && clientInfo.title) || ''}`.trim();
  const known = AGENTS.find(([, , re]) => re.test(raw));
  if (known) return { id: known[0], name: known[1] };
  const name = String((clientInfo && (clientInfo.title || clientInfo.name)) || 'AI agent').slice(0, 60);
  return { id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'agent', name };
}

function brief(n) {
  return {
    id: n.id,
    text: n.text,
    status: n.status || 'open',
    element: n.anchor ? n.anchor.describe : (n.selector ? undefined : '(whole page, no element)'),
    selector: n.selector || undefined,
    testId: (n.anchor && n.anchor.testId) || undefined,
    category: categoryOf(n),
    assignedTo: n.assignee ? n.assignee.name : undefined,
    by: n.source === 'ai' ? 'ai' : undefined,
    created: n.timestamp ? new Date(n.timestamp).toISOString() : undefined,
    replies: n.replies && n.replies.length ? n.replies.length : undefined,
    screenshot: n.hasScreenshot || undefined,
  };
}

function counts(list) {
  const byCategory = {};
  let open = 0;
  for (const n of list) {
    const c = categoryOf(n);
    byCategory[c] = (byCategory[c] || 0) + 1;
    if ((n.status || 'open') === 'open') open++;
  }
  return { notes: list.length, open, resolved: list.length - open, byCategory };
}

const groupBy = (list, key) => {
  const m = new Map();
  for (const x of list) {
    const k = key(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
};
const byName = (a, b) => (a === '/' ? -1 : b === '/' ? 1 : a.localeCompare(b));

// withNotes=false → counts only (overview). Sites/sections/pages sorted by name, categories by size.
function tree(list, withNotes) {
  const sites = [...groupBy(list, (n) => pageParts(n.pageUrl).site)].sort((a, b) => byName(a[0], b[0])).map(([site, siteNotes]) => ({
    site,
    origin: pageParts(siteNotes[0].pageUrl).origin,
    ...counts(siteNotes),
    sections: [...groupBy(siteNotes, (n) => pageParts(n.pageUrl).section)].sort((a, b) => byName(a[0], b[0])).map(([section, secNotes]) => ({
      section,
      notes: secNotes.length,
      pages: [...groupBy(secNotes, (n) => n.pageUrl)].sort((a, b) => pageParts(a[0]).path.localeCompare(pageParts(b[0]).path)).map(([url, pageNotes]) => {
        const page = { path: pageParts(url).path, url, title: (pageNotes.find((n) => n.pageTitle) || {}).pageTitle, ...counts(pageNotes) };
        if (withNotes) {
          page.categories = [...groupBy(pageNotes, categoryOf)].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
            .map(([category, notes]) => ({ category, notes: notes.slice().sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0)).map(brief) }));
        }
        return page;
      }),
    })),
  }));
  return { summary: { sites: sites.length, pages: new Set(list.map((n) => n.pageUrl)).size, ...counts(list) }, sites };
}

function filter(list, a) {
  const status = a.status || 'open';
  const q = (a.query || '').toLowerCase();
  return list.filter((n) => {
    const p = pageParts(n.pageUrl);
    if (a.site && !p.site.toLowerCase().includes(String(a.site).toLowerCase())) return false;
    if (a.page && !n.pageUrl.toLowerCase().includes(String(a.page).toLowerCase())) return false;
    if (a.category && categoryOf(n).toLowerCase() !== String(a.category).toLowerCase()) return false;
    if (status !== 'all' && (n.status || 'open') !== status) return false;
    if (q && !`${n.text} ${n.anchor ? n.anchor.describe : ''} ${n.selector || ''}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

function detail(n) {
  const p = pageParts(n.pageUrl);
  return {
    ...brief(n),
    site: p.site,
    page: p.path,
    url: n.pageUrl,
    pageTitle: n.pageTitle,
    anchor: n.anchor || undefined,
    rect: n.rect || undefined,
    updated: n.updatedAt ? new Date(n.updatedAt).toISOString() : undefined,
    resolved: n.resolvedAt ? { at: new Date(n.resolvedAt).toISOString(), by: n.resolvedBy || 'user' } : undefined,
    replies: n.replies && n.replies.length ? n.replies.map((r) => ({ by: r.by, text: r.text, at: new Date(r.at).toISOString() })) : undefined,
    screenshot: undefined,
  };
}

// ---------- Extension link (WebSocket server, RFC 6455 subset: unfragmented text + control frames) ----------
let ext = null;
let listenError = '';
let agent = null; // set by initialize
const pending = new Map();
let seq = 0;

function frame(payload, op = 1) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  let head;
  if (data.length < 126) head = Buffer.from([0x80 | op, data.length]);
  else if (data.length < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | op; head[1] = 126; head.writeUInt16BE(data.length, 2); }
  else { head = Buffer.alloc(10); head[0] = 0x80 | op; head[1] = 127; head.writeBigUInt64BE(BigInt(data.length), 2); }
  return Buffer.concat([head, data]);
}

function tokenOk(t) {
  const a = Buffer.from(String(t || ''));
  const b = Buffer.from(TOKEN);
  return TOKEN.length >= 16 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

function attach(socket) {
  let buf = Buffer.alloc(0);
  let parts = [];
  let authed = false;
  const conn = { send: (obj) => socket.writable && socket.write(frame(JSON.stringify(obj))) };
  const authTimer = setTimeout(() => socket.destroy(), 5000);

  const onText = (text) => {
    let msg;
    try { msg = JSON.parse(text); } catch (e) { return; }
    if (!authed) {
      clearTimeout(authTimer);
      if (msg.type !== 'hello' || !tokenOk(msg.token)) {
        log('rejected a connection: wrong pairing token');
        conn.send({ type: 'error', error: 'Pairing code does not match. Copy the setup command from Redlines settings again.' });
        socket.end();
        return;
      }
      authed = true;
      if (ext && ext !== conn) ext.close();
      conn.close = () => socket.destroy();
      ext = conn;
      conn.send({ type: 'welcome' });
      if (agent) conn.send({ type: 'agent', agent });
      log('extension connected');
      return;
    }
    if (msg.type === 'reply' && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? p.reject(new Error(msg.error)) : p.resolve(msg.result);
    }
  };

  socket.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      if (buf.length < 2) return;
      const fin = buf[0] & 0x80;
      const op = buf[0] & 0x0f;
      let len = buf[1] & 0x7f;
      let off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      if (!(buf[1] & 0x80) || len > MAX_FRAME) return socket.destroy(); // clients must mask
      if (buf.length < off + 4 + len) return;
      const mask = buf.subarray(off, off + 4);
      const data = Buffer.from(buf.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3];
      buf = buf.subarray(off + 4 + len);
      if (op === 8) return socket.end(frame(Buffer.alloc(0), 8));
      if (op === 9) { socket.write(frame(data, 10)); continue; }
      if (op === 0 || op === 1) {
        parts.push(data);
        if (!fin) continue;
        const text = Buffer.concat(parts).toString('utf8');
        parts = [];
        onText(text);
      }
    }
  });
  const gone = () => {
    clearTimeout(authTimer);
    if (ext === conn) { ext = null; log('extension disconnected'); }
  };
  socket.on('close', gone);
  socket.on('error', gone);
}

function startLink(port = PORT) {
  const server = http.createServer((req, res) => { res.writeHead(404); res.end(); });
  server.on('upgrade', (req, socket) => {
    const origin = req.headers.origin || '';
    const key = req.headers['sec-websocket-key'];
    // Web pages can open WebSockets to localhost (no CORS for WS), but can't fake an extension origin.
    if (req.url !== '/redlines' || !/^(chrome|moz)-extension:\/\/[a-z0-9-]+$/i.test(origin) || !key) {
      log('refused a connection from', JSON.stringify(origin || 'no origin'));
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    attach(socket);
  });
  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE' && port < PORT + PORT_RANGE - 1) return startLink(port + 1); // another AI tool has this one
    listenError = e.code === 'EADDRINUSE'
      ? `Ports ${PORT}–${port} are all in use — ${PORT_RANGE} AI tools are already connected to Redlines. Close one, or set REDLINES_PORT.`
      : e.message;
    log(listenError);
  });
  server.listen(port, '127.0.0.1', () => log(`waiting for the Redlines extension on 127.0.0.1:${port}`));
}

async function call(op, args) {
  if (!TOKEN) throw new Error('Redlines is not paired. In Redlines settings → Connect to AI agents, copy the setup command (it includes REDLINES_TOKEN) and re-add this MCP server.');
  if (listenError) throw new Error(listenError);
  // The extension retries about every 30 s; give a just-started browser a moment.
  for (let i = 0; !ext && i < 40; i++) await new Promise((r) => setTimeout(r, 250));
  if (!ext) throw new Error('The Redlines extension is not connected. Open Chrome, and check Redlines settings → Connect to AI agents is on (it reconnects within 30 seconds).');
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ext.send({ type: 'call', id, op, args: args || {} });
    setTimeout(() => pending.delete(id) && reject(new Error('The extension did not answer in time.')), 30000);
  });
}

// ---------- MCP tools ----------
const str = (description, extra) => ({ type: 'string', description, ...extra });
const TOOLS = [
  {
    name: 'get_my_annotations',
    description: 'Start here. Notes the user sent to you (this AI tool) from the Redlines note form, grouped site → section → page → category, with element, selector and data-testid for each. Open notes only unless status says otherwise. Fix them, then resolve_annotation each one.',
    inputSchema: { type: 'object', properties: { status: str('open (default), resolved or all.', { enum: ['open', 'resolved', 'all'] }) } },
    run: async (a) => {
      const me = agent || agentFrom(null);
      const mine = filter((await call('list')).filter((n) => n.assignee && n.assignee.id === me.id), { status: a.status });
      if (!mine.length) return `No ${a.status === 'all' ? '' : (a.status || 'open') + ' '}notes are assigned to you (${me.name}). get_overview shows every shared note.`;
      return { you: me.name, ...tree(mine, true) };
    },
  },
  {
    name: 'get_overview',
    description: 'Every site and page that has Redlines notes (only sites the user shares with AI agents), grouped site → section → page, with note counts by category and open/resolved.',
    inputSchema: { type: 'object', properties: {} },
    run: async () => tree(await call('list'), false),
  },
  {
    name: 'list_annotations',
    description: 'Redlines notes grouped site → section → page → category (categories are the user\'s own, or inferred from the wording: Bug, Copy / text, Visual / layout, Accessibility, Suggestion, Question). Each note has "element" (what it points at, e.g. button "Pay now" in form "Payment" under "Checkout"), a CSS "selector" and any data-testid — use them to find the matching code. Open notes only unless status says otherwise.',
    inputSchema: {
      type: 'object',
      properties: {
        site: str('Host to include, e.g. "localhost:3000" (substring match).'),
        page: str('Page path or URL substring, e.g. "/checkout".'),
        category: str('Category name exactly as shown in get_overview, e.g. "Bug".'),
        status: str('open (default), resolved or all.', { enum: ['open', 'resolved', 'all'] }),
        query: str('Search note text, element description and selector.'),
      },
    },
    run: async (a) => tree(filter(await call('list'), a), true),
  },
  {
    name: 'get_annotation',
    description: 'One note in full: text, element anchor (text, label, heading, landmark, classes), selector, position, replies, and the screenshot of the element as an image (if the user allows screenshots).',
    inputSchema: { type: 'object', properties: { id: str('Note id from list_annotations.') }, required: ['id'] },
    run: async ({ id }) => {
      const n = await call('get', { id });
      const out = [{ type: 'text', text: JSON.stringify(detail(n), null, 1) }];
      const m = /^data:(image\/[\w+.-]+);base64,(.+)$/.exec(n.screenshot || '');
      if (m) out.push({ type: 'image', mimeType: m[1], data: m[2] });
      return out;
    },
  },
  {
    name: 'get_current_page',
    description: 'The page open in the user\'s browser right now, with its notes grouped by category.',
    inputSchema: { type: 'object', properties: {} },
    run: async () => {
      const cur = await call('current');
      if (!cur.allowed) return 'The page open in the browser is not on a site the user shares with AI agents (or no page is open).';
      const notes = (await call('list')).filter((n) => n.pageUrl === cur.url);
      return { url: cur.url, title: cur.title, ...tree(filter(notes, { status: 'all' }), true) };
    },
  },
  {
    name: 'show_annotation',
    description: 'Open the note\'s page in the user\'s browser, scroll to its element and highlight it — to point the user at something.',
    inputSchema: { type: 'object', properties: { id: str('Note id.') }, required: ['id'] },
    run: (a) => call('show', a),
  },
  {
    name: 'resolve_annotation',
    description: 'Mark a note resolved after fixing it, optionally saying what changed (shown to the user as an AI reply). Needs the user to allow changes in Redlines settings.',
    inputSchema: { type: 'object', properties: { id: str('Note id.'), text: str('What you changed, e.g. "Fixed padding in Header.tsx".') }, required: ['id'] },
    run: (a) => call('write', { op: 'resolve', id: a.id, text: a.text }),
  },
  {
    name: 'reopen_annotation',
    description: 'Mark a resolved note open again.',
    inputSchema: { type: 'object', properties: { id: str('Note id.') }, required: ['id'] },
    run: (a) => call('write', { op: 'reopen', id: a.id }),
  },
  {
    name: 'reply_to_annotation',
    description: 'Add a reply to a note (labelled AI in the user\'s sidebar) — to explain a change or ask a question.',
    inputSchema: { type: 'object', properties: { id: str('Note id.'), text: str('Reply text.') }, required: ['id', 'text'] },
    run: (a) => call('write', { op: 'reply', id: a.id, text: a.text }),
  },
  {
    name: 'add_annotation',
    description: 'Pin a new note (labelled AI) on a page, e.g. review findings. Without a selector it is a general note for the whole page.',
    inputSchema: {
      type: 'object',
      properties: {
        url: str('Full page URL, e.g. http://localhost:3000/checkout'),
        text: str('Note text.'),
        selector: str('CSS selector of the element (optional).'),
        category: str('Category, e.g. "Bug" (optional).'),
      },
      required: ['url', 'text'],
    },
    run: (a) => call('write', { op: 'add', url: a.url, text: a.text, selector: a.selector, category: a.category }),
  },
];

// ---------- MCP over stdio (newline-delimited JSON-RPC 2.0) ----------
const SUPPORTED = ['2025-06-18', '2025-03-26', '2024-11-05'];
const send = (obj) => process.stdout.write(JSON.stringify(obj) + '\n');

async function handle(line) {
  let msg;
  try { msg = JSON.parse(line); } catch (e) { return send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); }
  if (msg.id === undefined || msg.id === null) return; // notification
  const ok = (result) => send({ jsonrpc: '2.0', id: msg.id, result });
  switch (msg.method) {
    case 'initialize': {
      const asked = msg.params && msg.params.protocolVersion;
      agent = agentFrom(msg.params && msg.params.clientInfo);
      if (ext) ext.send({ type: 'agent', agent });
      return ok({
        protocolVersion: SUPPORTED.includes(asked) ? asked : SUPPORTED[0],
        capabilities: { tools: {} },
        serverInfo: { name: 'redlines', version: '1.0.0' },
        instructions: 'Redlines notes are visual review comments a person pinned on web pages. The user can send notes to you by name: call get_my_annotations first. get_overview and list_annotations show every shared note. resolve_annotation after fixing one.',
      });
    }
    case 'ping': return ok({});
    case 'tools/list': return ok({ tools: TOOLS.map(({ run, ...t }) => t) });
    case 'tools/call': {
      const tool = TOOLS.find((t) => t.name === (msg.params && msg.params.name));
      if (!tool) return ok({ content: [{ type: 'text', text: 'Unknown tool.' }], isError: true });
      try {
        const out = await tool.run((msg.params && msg.params.arguments) || {});
        return ok({ content: Array.isArray(out) ? out : [{ type: 'text', text: typeof out === 'string' ? out : JSON.stringify(out, null, 1) }] });
      } catch (e) {
        return ok({ content: [{ type: 'text', text: e.message }], isError: true });
      }
    }
    default: return send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not found: ' + msg.method } });
  }
}

if (require.main === module) {
  startLink();
  let inBuf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    inBuf += chunk;
    let i;
    while ((i = inBuf.indexOf('\n')) >= 0) {
      const line = inBuf.slice(0, i).trim();
      inBuf = inBuf.slice(i + 1);
      if (line) handle(line);
    }
  });
  process.stdin.on('end', () => process.exit(0));
}

module.exports = { inferKind, categoryOf, tree, filter, pageParts, agentFrom };
