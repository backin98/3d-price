const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('netlify/functions/stock-preview.mjs', 'utf8')
  .replace(/^import .*;$/gm, '')
  .replace('export default async', 'globalThis.handler = async');
const offers = Array.from({ length: 13 }, (_, i) => ({ url: `https://shop${i}.example/p`, price: 100 + i, vatAdded: true }));
const checked = [];
const context = {
  URL, Response, console,
  store: { readJSON: async () => ({ products: [{ id: 'p1', kind: 'printer', offers }], filaments: [] }) },
  stock: { checkOfferStock: async (url, options) => { checked.push({ url, options }); return { status: 'in_stock', verified: true, price: 200, priceSource: 'json-ld' }; } }
};
vm.runInNewContext(source, context);

(async () => {
  const response = await context.handler({ url: 'https://site.example/api/stock-preview?ids=p1' });
  const body = await response.json();
  assert.equal(checked.length, 13, 'price preview checks every seller instead of silently stopping after twelve');
  assert.ok(checked.every((row) => row.options.kind === 'printer' && row.options.vatAdded === true), 'preview preserves product and VAT rules');
  assert.ok(body.products.every((row) => row.price === 200 && row.priceSource === 'json-ld'));
  console.log('PASS: storefront preview returns current prices and checks all offers on the leading search result.');
})().catch((err) => { console.error(err); process.exitCode = 1; });
