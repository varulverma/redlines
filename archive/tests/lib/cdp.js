// Shared harness for the real-browser tests: launches desktop Chrome (or another Chromium
// via CHROME_PATH) with a throw-away profile, talks CDP over --remote-debugging-pipe, and
// loads the unpacked extension with Extensions.loadUnpacked (branded Chrome ignores
// --load-extension). No dependencies.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function poll(fn, ms = 8000, step = 150) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn().catch(() => undefined);
    if (v) return v;
    if (Date.now() > end) return v;
    await sleep(step);
  }
}

class CDP {
  constructor(proc) {
    this.id = 0;
    this.pending = new Map();
    this.listeners = [];
    this.out = proc.stdio[3];
    let buf = Buffer.alloc(0);
    proc.stdio[4].on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      let i;
      while ((i = buf.indexOf(0)) >= 0) {
        const msg = JSON.parse(buf.subarray(0, i).toString('utf8'));
        buf = buf.subarray(i + 1);
        if (msg.id && this.pending.has(msg.id)) {
          const p = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
        } else this.listeners.forEach((fn) => fn(msg));
      }
    });
  }
  send(method, params = {}, sessionId, timeout = 15000) {
    const id = ++this.id;
    const msg = { id, method, params };
    if (sessionId) msg.sessionId = sessionId;
    this.out.write(JSON.stringify(msg) + '\0');
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`timeout: ${method}`));
      }, timeout);
    });
  }
}

const DEFAULT_CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

// Returns a handle with the CDP connection, extension id, service-worker session and helpers.
async function launch({ ext, prefix = 'dn-test-' } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const downloads = path.join(tmp, 'downloads');
  fs.mkdirSync(downloads);
  const args = ['--remote-debugging-pipe', '--enable-unsafe-extension-debugging', `--user-data-dir=${path.join(tmp, 'profile')}`,
    '--no-first-run', '--no-default-browser-check', '--window-size=1280,900', 'about:blank'];
  if (!process.env.HEADED) args.unshift('--headless=new');
  const proc = spawn(process.env.CHROME_PATH || DEFAULT_CHROME, args, { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
  const cdp = new CDP(proc);
  const h = { cdp, proc, tmp, downloads };

  h.ev = async (session, expression, timeout) => {
    const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, session, timeout);
    if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text);
    return r.result.value;
  };
  h.findSw = () => poll(async () => (await cdp.send('Target.getTargets')).targetInfos
    .find((t) => t.type === 'service_worker' && t.url.startsWith(`chrome-extension://${h.extId}/`)));
  h.attachSw = async () => {
    let t = await h.findSw();
    if (!t) {
      // MV3 workers start lazily (e.g. after chrome.runtime.reload); an extension page
      // that messages the worker (settings → CHECK_DRIVE) wakes it.
      const { targetId } = await cdp.send('Target.createTarget', { url: `chrome-extension://${h.extId}/settings.html` });
      t = await h.findSw();
      await cdp.send('Target.closeTarget', { targetId }).catch(() => {});
    }
    if (!t) throw new Error('extension service worker not found');
    h.sw = (await cdp.send('Target.attachToTarget', { targetId: t.targetId, flatten: true })).sessionId;
    await cdp.send('Network.enable', {}, h.sw);
    return h.sw;
  };
  h.storage = () => h.ev(h.sw, 'chrome.storage.local.get(null)');
  h.attach = async (targetId) => {
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    await cdp.send('Network.enable', {}, sessionId);
    await cdp.send('Page.enable', {}, sessionId).catch(() => {});
    await cdp.send('Runtime.enable', {}, sessionId);
    return sessionId;
  };
  // waitPill=false for pages where the content script is not expected to run
  h.openPage = async (url, { waitPill = true } = {}) => {
    const { targetId } = await cdp.send('Target.createTarget', { url });
    const s = await h.attach(targetId);
    await cdp.send('Page.bringToFront', {}, s).catch(() => {});
    if (waitPill && !(await poll(() => h.ev(s, `!!document.getElementById('designnote-pill')`)))) {
      throw new Error('content script did not inject into ' + url);
    }
    return { targetId, s };
  };
  h.center = (s, sel) => h.ev(s, `(() => { const el = document.querySelector(${JSON.stringify(sel)}); el.scrollIntoView({block:'center'}); const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
  h.realClick = async (s, x, y) => {
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
      await cdp.send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: 1 }, s);
    }
  };
  h.domClick = (s, sel) => h.ev(s, `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) throw new Error('missing ${sel.replace(/'/g, '')}'); el.click(); return true; })()`);
  h.close = () => proc.kill();

  h.version = (await cdp.send('Browser.getVersion')).product;
  h.extId = (await cdp.send('Extensions.loadUnpacked', { path: ext })).id;
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads, eventsEnabled: true });
  await h.attachSw();
  return h;
}

// Pass/fail recorder shared by the scripts
function recorder() {
  const results = [];
  const record = (id, name, pass, detail) => {
    results.push({ id, name, pass, detail });
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${id} ${name}${detail ? ' — ' + detail : ''}`);
  };
  return { results, record };
}

module.exports = { launch, recorder, sleep, poll };
