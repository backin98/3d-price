const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const context = {
  URL, document: { querySelector: () => null, querySelectorAll: () => [] }, location: { hash: '' },
  window: {}, setInterval: () => 1, clearInterval() {}, setTimeout() {}, clearTimeout() {},
  fetch: async () => ({ ok: true, status: 200, json: async () => ({}) })
};
const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin', 'admin.js'), 'utf8').replace('  init();', '  globalThis.test={reviewBoardHtml};');
vm.runInNewContext(src, context);
const job = { id: 'j1', events: [{ card: { url: 'https://shop.example/mystery', name: 'Unmatched mystery', kind: 'printer' }, decision: {} }] };
const html = context.test.reviewBoardHtml(job, { catalog: { products: [], filaments: [] } });
assert.match(html, /Baseline-trained Laya help/);
assert.match(html, /id="laya-unmatched"[^>]*>Ask Laya: all unmatched \(1\)/);
assert.match(html, /id="laya-selected" disabled[^>]*>Ask Laya: selected \(0\)/);
console.log('PASS: review board sends unmatched cards to Laya, not Gemma.');
