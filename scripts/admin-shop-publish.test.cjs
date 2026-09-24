const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const listeners = [];
let request;
const context = {
  URL, console, window: {}, confirm: () => true,
  document: { addEventListener: (type, fn) => listeners.push({ type, fn }) },
  fetch: async (_path, options) => {
    request = JSON.parse(options.body);
    return { ok: true, status: 200, json: async () => ({ published: 1, deferred: 1, appliedUrls: ['https://shop.example/a1'] }) };
  }
};
let source = fs.readFileSync('public/admin/admin.js', 'utf8').replace('  init();', `
  loadData = async () => {};
  toast = () => {};
  globalThis.test = { state, bindAppEvents };
`);
vm.runInNewContext(source, context);
const a1 = 'https://shop.example/a1';
const k2 = 'https://shop.example/k2';
context.test.state.data = {
  baseline: { items: [{ id: 'base-a1', name: 'Bambu Lab A1', brand: 'Bambu Lab', category: 'printers' }] },
  catalog: { products: [{ id: 'live-a1', baselineId: 'base-a1', name: 'Bambu Lab A1', offers: [] }], filaments: [] },
  jobs: [{ id: 'run', status: 'complete', cards: {
    [a1]: { url: a1, name: 'Bambu Lab A1', kind: 'printer', price: 100, decision: { action: 'merge', candidateId: 'live-a1' } },
    [k2]: { url: k2, name: 'Creality K2', kind: 'printer', price: 200, decision: { action: 'create' } }
  } }]
};
context.test.state.reviewSelected.add(a1);
context.test.state.reviewSelected.add(k2);
context.test.bindAppEvents();
const click = listeners.find((x) => x.type === 'click').fn;

(async () => {
  const button = {};
  await click({ target: { matches: () => false, closest: (selector) => selector === '#publish-selected' ? button : null } });
  assert.equal(request.action, 'publishSelected');
  assert.deepEqual(request.placements.map((x) => x.url), [a1]);
  assert.equal(request.placements[0].candidateId, 'baseline:base-a1');
  assert.deepEqual(request.deferred.map((x) => x.url), [k2]);
  assert.equal(context.test.state.reviewSelected.size, 0);
  console.log('PASS: Shop Run publishes baseline assignments and persists blank assignments for Uncertain.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
