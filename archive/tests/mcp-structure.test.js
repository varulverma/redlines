// Run: node tests/mcp-structure.test.js
// Checks how the MCP bridge structures notes for AI agents: site → section → page → category,
// with the user's own category kept and generic ones ("note", "UI") given an inferred kind.
const assert = require('assert');
const { inferKind, tree, filter, agentFrom } = require('../../mcp/redlines-mcp.js');

assert.strictEqual(inferKind('Button text overlaps the icon on mobile'), 'Bug');
assert.strictEqual(inferKind('Typo in the headline'), 'Copy / text');
assert.strictEqual(inferKind('More padding here please'), 'Visual / layout');
assert.strictEqual(inferKind('Low contrast on this link'), 'Accessibility');
assert.strictEqual(inferKind('Why is this here?'), 'Question');
assert.strictEqual(inferKind('Consider a shorter form'), 'Suggestion');
assert.strictEqual(inferKind('Looks good'), 'General');

const n = (id, pageUrl, type, text, extra) => ({ id, pageUrl, type, text, timestamp: Number(id.slice(1)), ...extra });
const notes = [
  n('a3', 'http://localhost:3000/checkout/payment', 'note', 'Pay button is broken'),
  n('a1', 'http://localhost:3000/checkout/payment', 'Copy', 'Say "Pay now"'),
  n('a2', 'http://localhost:3000/', 'UI', 'Logo too small'),
  n('a4', 'http://localhost:3000/checkout?step=2', 'note', 'Typo in the title', { status: 'resolved' }),
  n('a5', 'https://staging.example.com/pricing', 'bug', 'Cards misaligned'),
];

const t = tree(notes, true);
assert.deepStrictEqual(t.summary, { sites: 2, pages: 4, notes: 5, open: 4, resolved: 1, byCategory: { Bug: 1, Copy: 1, 'Visual / layout': 1, 'Copy / text': 1, 'Layout Bug': 1 } });
assert.deepStrictEqual(t.sites.map((s) => s.site), ['localhost:3000', 'staging.example.com']);
const local = t.sites[0];
assert.deepStrictEqual(local.sections.map((s) => s.section), ['/', '/checkout']);
const checkout = local.sections[1];
assert.deepStrictEqual(checkout.pages.map((p) => p.path), ['/checkout?step=2', '/checkout/payment']); // parent page before sub-pages
const payment = checkout.pages[1];
assert.deepStrictEqual(payment.categories.map((c) => c.category), ['Bug', 'Copy']); // user's "Copy" kept, generic "note" inferred
assert.strictEqual(payment.categories[0].notes[0].element, '(whole page, no element)');

// Overview has counts but no note bodies
const o = tree(notes, false);
assert.strictEqual(o.sites[0].sections[1].pages[0].categories, undefined);
assert.strictEqual(o.sites[0].open, 3);

// Filters: open by default, by site, page, category, text
assert.strictEqual(filter(notes, {}).length, 4);
assert.strictEqual(filter(notes, { status: 'all' }).length, 5);
assert.deepStrictEqual(filter(notes, { site: 'staging' }).map((x) => x.id), ['a5']);
assert.deepStrictEqual(filter(notes, { page: '/checkout', category: 'bug' }).map((x) => x.id), ['a3']);
assert.deepStrictEqual(filter(notes, { query: 'logo' }).map((x) => x.id), ['a2']);

// Agent identity from MCP clientInfo: known tools get their id (= icon file), Claude Code before Claude Desktop,
// Cursor before VS Code; unknown tools keep their own name with a path-safe id.
const fs = require('fs');
const path = require('path');
const who = (name) => agentFrom({ name }).id;
assert.strictEqual(who('claude-code'), 'claude-code');
assert.strictEqual(who('claude-ai'), 'claude-desktop');
assert.strictEqual(who('codex-mcp-client'), 'codex');
assert.strictEqual(who('cursor-vscode'), 'cursor');
assert.strictEqual(who('Visual Studio Code'), 'copilot');
assert.deepStrictEqual(agentFrom({ name: '../My Tool!' }), { id: 'my-tool', name: '../My Tool!' });
assert.deepStrictEqual(agentFrom(null), { id: 'ai-agent', name: 'AI agent' });
for (const id of ['claude-code', 'claude-desktop', 'codex', 'cursor', 'windsurf', 'gemini', 'cline', 'zed', 'opencode', 'copilot', 'agent']) {
  assert.ok(fs.existsSync(path.join(__dirname, '..', '..', 'icons', 'agents', id + '.svg')), 'missing icon ' + id);
}
assert.strictEqual(tree([n('b1', 'http://localhost/', 'UI', 'x', { assignee: { id: 'codex', name: 'Codex' } })], true)
  .sites[0].sections[0].pages[0].categories[0].notes[0].assignedTo, 'Codex');
console.log('mcp-structure: PASS');
