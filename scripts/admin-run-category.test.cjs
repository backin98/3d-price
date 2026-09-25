const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const current = 'https://shop.example/pla-red';
const context = {
  URL, console, window: {},
  document: { addEventListener: () => {} },
  fetch: async () => ({ ok: true, json: async () => ({}) })
};
const source = fs.readFileSync('public/admin/admin.js', 'utf8').replace(
  '  init();',
  '  globalThis.test = { state, collectCards };'
);
vm.runInNewContext(source, context);

const job = {
  id: 'filament-run', kind: 'filament', url: 'https://shop.example/filaments',
  events: [{ type: 'gather', urls: [current] }], cards: {}
};
const data = {
  catalog: { products: [], filaments: [] },
  candidate: {
    products: [{ id: 'printer', kind: 'printer', offers: [{ url: 'https://shop.example/printer', price: 100 }] }],
    filaments: [
      { id: 'current', kind: 'filament', name: 'PLA Red', offers: [{ url: current, price: 10 }] },
      { id: 'other-category', kind: 'filament', name: 'Resin', offers: [{ url: 'https://shop.example/resin', price: 20 }] },
      { id: 'other-shop', kind: 'filament', name: 'PLA Blue', offers: [{ url: 'https://other.example/pla-blue', price: 30 }] }
    ]
  }
};
context.test.state.data = data;
const cards = context.test.collectCards(job, data);

assert.equal(cards.map((row) => row.card.url).join('|'), current);
assert.equal(cards[0].card.price, 10, 'the global candidate may enrich the listing gathered by this run');
console.log('PASS: Shop Runs shows only URLs gathered by the selected category run.');
