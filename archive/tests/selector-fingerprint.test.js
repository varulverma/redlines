// Run: node tests/selector-fingerprint.test.js
// Loads the real selector.js against a minimal fake DOM and checks the fingerprint
// fallback (used when a saved selector no longer matches) finds the right element
// without blowing up on a realistically sized page.
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', '..', 'selector.js'), 'utf8');

function buildPage(cards) {
  const all = [];
  const mk = (tag, parent, text) => {
    const el = {
      nodeType: 1, tagName: tag.toUpperCase(), parentElement: parent || null, children: [], _text: text || '', id: '',
      get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); },
      getAttribute() { return null; },
    };
    if (parent) parent.children.push(el);
    all.push(el);
    return el;
  };
  const html = mk('html');
  const body = mk('body', html);
  const targets = [];
  for (let i = 0; i < cards; i++) {
    const d1 = mk('div', body); const d2 = mk('div', d1); const d3 = mk('div', d2);
    targets.push(mk('p', d3, 'Card text ' + i));
  }
  const doc = {
    documentElement: html,
    querySelectorAll: (sel) => all.filter((e) => e.tagName.toLowerCase() === sel),
    querySelector: () => null, // the saved selector never matches → forces the fingerprint path
  };
  return { all, targets, doc };
}

function load(doc) {
  const sandbox = { window: {}, document: doc };
  new Function('window', 'document', src)(sandbox.window, sandbox.document);
  return sandbox.window;
}

for (const cards of [10, 500]) {
  const { all, targets, doc } = buildPage(cards);
  const w = load(doc);
  const target = targets[7];
  const { fingerprint } = w.__designNoteGetSelectorWithFingerprint(target);
  const t0 = Date.now();
  const r = w.__designNoteFindElement('#gone', fingerprint, doc);
  const ms = Date.now() - t0;
  assert.strictEqual(r.method, 'fingerprint', `cards=${cards}: expected fingerprint match`);
  assert.strictEqual(r.element, target, `cards=${cards}: matched the wrong element`);
  assert.ok(ms < 2000, `cards=${cards}: took ${ms}ms (freeze risk)`);
  console.log(`ok cards=${cards} elements=${all.length} ${ms}ms`);
}

// Removed element: no false match is better than a wrong one.
{
  const { targets, doc } = buildPage(20);
  const w = load(doc);
  const fp = w.__designNoteGetSelectorWithFingerprint(targets[3]).fingerprint;
  fp.textHash = 'nonexistent';
  const r = w.__designNoteFindElement('#gone', fp, doc);
  assert.ok(r.element === null || r.element === targets[3], 'matched an unrelated element');
  console.log('ok removed-text case:', r.method);
}
console.log('selector-fingerprint: PASS');
