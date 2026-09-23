const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const url = 'https://shop.example/printer';
const listeners = [];
let refreshed = 0, reply, request, release;
const notices = [];
const context = { URL, console, window: {}, document: { addEventListener: (type, fn) => listeners.push({ type, fn }) },
  fetch: async (path, options) => { request = JSON.parse(options.body); return new Promise(resolve => { release = () => resolve({ ok: reply.ok !== false, status: reply.ok === false ? 400 : 200, json: async () => reply }); }); },
  refreshed: () => refreshed++, notice: text => notices.push(text) };
let source = fs.readFileSync('public/admin/admin.js', 'utf8').replace('  init();', `
  loadData = async () => globalThis.refreshed();
  toast = (text) => globalThis.notice(text);
  globalThis.test = { state, bindAppEvents };
`);
vm.runInNewContext(source, context);
context.test.state.data = { jobs: [{ id: 'job', url, cards: { [url]: { url, name: 'Old title', price: 12345, kind: 'printer', decision: { action: 'held' } } } }], catalog: { products: [], filaments: [] } };
context.test.bindAppEvents();
const click = listeners.find(x => x.type === 'click').fn;
async function press(kind, result) {
  reply = result;
  const card = { parentElement: null, querySelector: selector => ({ value: selector.includes('name') ? 'Edited title' : 'Edited brand' }) };
  const btn = { dataset: { [kind === 'save' ? 'uncertainSave' : 'uncertainPublish']: url }, disabled: false, closest: () => card };
  const target = { matches: () => false, closest: selector => selector.includes(',') && selector.includes('data-uncertain-save') ? btn : null };
  const pending = click({ target });
  assert.equal(btn.disabled, true);
  assert.equal(context.test.state.uncertainPublished.has(url), false, 'no success marker before response');
  assert.equal(request.action, 'publishSelected');
  assert.equal(request.placements[0].card.name, 'Edited title');
  release();
  await pending;
  assert.equal(btn.disabled, false);
}
(async () => {
  await press('save', { ok: false, error: 'Missing price' });
  assert.equal(refreshed, 0);
  assert.equal(context.test.state.uncertainPublished.has(url), false);
  await press('save', { published: 1, appliedUrls: [url] });
  assert.equal(refreshed, 1, 'Save reloads Catalog after confirmation');
  assert.equal(context.test.state.uncertainPublished.has(url), true);
  context.test.state.uncertainPublished.clear();
  await press('publish', { published: 1, appliedUrls: [url] });
  assert.equal(refreshed, 2, 'Force publish reloads Catalog');
  assert.equal(context.test.state.uncertainPublished.has(url), true);
  console.log('PASS: Uncertain Save and Force publish send edits, await confirmation, refresh Catalog, and allow retry after failure.');
})().catch(e => { console.error(e); process.exitCode = 1; });


