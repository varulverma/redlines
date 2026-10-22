// Run: node tests/content-helpers.test.js
// content.js is one IIFE with no exports, so this pulls the real source of a few pure
// helpers out of the file by name and evaluates them in isolation.
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', '..', 'content.js'), 'utf8');

function extract(name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `function ${name} not found in content.js`);
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces in ${name}`);
}
function extractConst(name) {
  const m = src.match(new RegExp(`const ${name} = [^;]+;`));
  assert.ok(m, `const ${name} not found`);
  return m[0];
}

const { csvCell, xmlEscape, normalizeCategory, escapeHtml } = new Function(
  [extractConst('PRESET_TYPES'), extract('csvCell'), extract('xmlEscape'), extract('normalizeCategory'), extract('escapeHtml'),
    'return { csvCell, xmlEscape, normalizeCategory, escapeHtml };'].join('\n')
)();

// CSV: every cell quoted; quotes doubled; commas/newlines stay inside the cell
assert.strictEqual(csvCell('plain'), '"plain"');
assert.strictEqual(csvCell('a, "b"\nc'), '"a, ""b""\nc"');
assert.strictEqual(csvCell(null), '""');
assert.strictEqual(csvCell('Layout, spacing'), '"Layout, spacing"'); // custom category with a comma
// CSV: formula injection neutralised
for (const bad of ['=HYPERLINK("x")', '+1', '-2+3', '@SUM(A1)', '\tx']) {
  assert.ok(csvCell(bad).startsWith(`"'`), `not guarded: ${bad}`);
}
assert.strictEqual(csvCell('Normal - dash later'), '"Normal - dash later"');

// XML escaping
assert.strictEqual(xmlEscape(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&apos;&amp;&apos;&lt;/a&gt;');

// Categories: a typed name reuses an existing category's spelling, new names keep theirs
assert.strictEqual(normalizeCategory('ui', ['UI', 'Copy']), 'UI');
assert.strictEqual(normalizeCategory('COPY', ['UI', 'Copy']), 'Copy');
assert.strictEqual(normalizeCategory('Layout', ['UI']), 'Layout');
assert.strictEqual(normalizeCategory('', ['UI']), '');

// HTML escaping is safe inside quoted attributes too (category names go into data-type="…")
assert.strictEqual(escapeHtml('x" onmouseover="y'), 'x&quot; onmouseover=&quot;y');
assert.strictEqual(escapeHtml("<img src=x onerror='a'>&"), '&lt;img src=x onerror=&#39;a&#39;&gt;&amp;');
assert.strictEqual(escapeHtml(null), '');

console.log('content-helpers: PASS');
