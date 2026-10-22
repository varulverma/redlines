// Run: node tests/browser-selector.js   (HEADED=1 to watch)
// Loads the real selector.js into a real page and checks the fixes for fragile selectors:
// a shifted nth-child path must not land on the wrong element, generated ids/classes are
// skipped, duplicate text is not "matched" by guessing, and the anchor describes the element.
const fs = require('fs');
const path = require('path');
const http = require('http');
const { launch, recorder } = require('./lib/cdp');

const EXT = path.join(__dirname, '..', '..');
const SRC = fs.readFileSync(path.join(EXT, 'selector.js'), 'utf8');
const PAGE = `<!doctype html><html><body>
<ul id="list-1234"><li>Alpha</li><li>Beta</li><li>Gamma</li></ul>
<button id=":r3:">Gen A</button><button id="radix-123">Gen B</button>
<div class="css-1x2y3z card-title">Title</div><div class="css-9q8w7e">Hashed only</div>
<table><tr><td><span>Row 1</span><button>Delete</button></td></tr><tr><td><span>Row 2</span><button>Delete</button></td></tr><tr><td><span>Row 3</span><button>Delete</button></td></tr></table>
<main><h2>Checkout</h2><form aria-label="Payment"><p>Card</p><button data-testid="pay-btn">Pay now</button><button>Pay later</button></form></main>
</body></html>`;

(async () => {
  const server = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(PAGE); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { results, record } = recorder();
  const h = await launch({ ext: EXT, prefix: 'dn-sel-' });
  try {
    const { s } = await h.openPage(`http://127.0.0.1:${server.address().port}/`);
    await h.ev(s, `(() => { ${SRC} })(); true`);
    const run = (body) => h.ev(s, `(() => { const W = window; ${body} })()`);

    // 1. Shifted path: saved Gamma, then a new first item pushes a *different* li into slot 3.
    const shift = await run(`
      const ul = document.querySelector('ul'); const gamma = ul.children[2];
      const saved = W.__designNoteGetSelectorWithFingerprint(gamma);
      ul.insertBefore(Object.assign(document.createElement('li'), { textContent: 'New' }), ul.firstChild);
      const hit = W.__designNoteFindElement(saved.selector, saved.fingerprint);
      return { selector: saved.selector, method: hit.method, text: hit.element && hit.element.textContent };`);
    record('S1', 'shifted path finds the saved element, not its new neighbour', shift.text === 'Gamma', JSON.stringify(shift));

    // 2. Generated ids/classes are never the anchor.
    const gen = await run(`
      const [a, b] = document.querySelectorAll('button[id]');
      return { a: W.__designNoteGetSelector(a), b: W.__designNoteGetSelector(b),
        title: W.__designNoteGetSelector(document.querySelector('.card-title')),
        list: W.__designNoteGetSelector(document.querySelector('ul')) };`);
    record('S2', 'generated ids skipped', !/r3|radix/.test(gen.a + gen.b) && !gen.list.includes('1234'), JSON.stringify(gen));
    record('S3', 'semantic class used, CSS-in-JS class skipped', gen.title === 'div.card-title', gen.title);

    // 3. Duplicate text: when structure no longer helps, three "Delete" buttons must not resolve to the first.
    const dup = await run(`
      const btn = document.querySelectorAll('td button')[1];
      const fp = W.__designNoteGetSelectorWithFingerprint(btn).fingerprint;
      fp.siblingIndex = 9; fp.parent = null; // structure gone, only the text clue is left
      const hit = W.__designNoteFindElement('#gone', fp);
      return { method: hit.method };`);
    record('S4', 'ambiguous text match returns lost, not a guess', dup.method === 'none', JSON.stringify(dup));

    // 4. Anchor bundle: readable description for people and coding agents.
    const anchor = await run(`return W.__designNoteGetSelectorWithFingerprint(document.querySelector('[data-testid="pay-btn"]')).anchor;`);
    record('S5', 'anchor describes element, landmark and heading',
      anchor.describe === 'button "Pay now" in form "Payment" under "Checkout"' && anchor.testId === 'pay-btn', anchor.describe);

    // 5. Stable selector survives the same shift without consulting the fingerprint.
    const stable = await run(`
      const saved = W.__designNoteGetSelectorWithFingerprint(document.querySelector('[data-testid="pay-btn"]'));
      document.querySelector('form').prepend(document.createElement('hr'));
      const hit = W.__designNoteFindElement(saved.selector, saved.fingerprint);
      return { selector: saved.selector, method: hit.method };`);
    record('S6', 'attribute selector trusted after layout change', stable.method === 'selector' && stable.selector.includes('data-testid'), JSON.stringify(stable));
  } catch (e) {
    record('S0', 'harness', false, e.message);
  } finally {
    h.close();
    server.close();
  }
  const failed = results.filter((r) => !r.pass).length;
  console.log(failed ? `browser-selector: ${failed} FAILED` : 'browser-selector: PASS');
  process.exit(failed ? 1 : 0);
})();
