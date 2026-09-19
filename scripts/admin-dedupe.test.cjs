// The apply path must not mint a second catalog row for a printer we already carry.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const urlA = 'https://shop-a.example/urun/bambu-lab-p1s-combo-3d-yazici';
const urlB = 'https://shop-b.example/bambu-lab-p1s-combo-3d-yazici';
const name = 'Bambu Lab P1S Combo 3D Yazıcı';
const row = (id, url, store) => ({ id, name, kind: 'printer', brand: 'Bambu Lab', offers: [{ store, price: 100, url }] });

const store = {
  'desk.json': { id: 'desk', shops: [], categories: [], autoLlmMatch: false },
  'jobs.json': [],
  'catalog.json': { products: [row('qwen-abc', urlA, 'shop-a.example')], filaments: [] },
  'candidate.json': { products: [row('qwen-abc', urlA, 'shop-a.example')], filaments: [] }
};

const context = {
  URL,
  Response,
  crypto: require('node:crypto'),
  store: {
    readJSON: async (key, fallback) => (key in store ? store[key] : fallback),
    writeJSON: async (key, value) => { store[key] = value; },
    deleteKey: async (key) => { delete store[key]; }
  },
  auth: { ownerFromHeaders: () => ({ role: 'owner' }), authReady: () => true }
};
const source = fs.readFileSync('netlify/functions/admin.mjs', 'utf8')
  .replace(/^import .*;$/gm, '')
  .replace('export default async', 'globalThis.handler = async');
context.money = require('../lib/parse-money.cjs'); // the function imports this module
context.matcher = require('../lib/product-match.cjs'); // and this one
vm.runInNewContext(source, context);

const post = (body) => new Request('https://example.com/api/admin', {
  method: 'POST',
  headers: { origin: 'https://example.com', 'content-type': 'application/json' },
  body: JSON.stringify(body)
});
const products = () => store['catalog.json'].products;

(async () => {
  // Publishing a URL the live catalog already carries (the qwen- vs sel- bug).
  let res = await context.handler(post({ action: 'publishSelected', placements: [{ url: urlA, action: 'create' }] }));
  assert.equal(res.status, 200);
  assert.equal(products().length, 1, 'one row for a URL we already have');
  assert.equal(products()[0].offers.length, 1, 'the offer is not duplicated');
  assert.equal(products()[0].id, 'qwen-abc', 'the Magellan-owned row is kept');

  // Publishing the same candidate twice in a row.
  res = await context.handler(post({ action: 'publishSelected', placements: [{ url: urlA, action: 'create' }] }));
  assert.equal(res.status, 200);
  assert.equal(products().length, 1, 'republishing does not clone the row');
  assert.equal(products()[0].offers.length, 1);

  // A second shop with the same title but a fresh candidate id joins that row.
  store['candidate.json'].products.push(row('qwen-def', urlB, 'shop-b.example'));
  res = await context.handler(post({ action: 'publishSelected', placements: [{ url: urlB, action: 'create' }] }));
  assert.equal(res.status, 200);
  assert.equal(products().length, 1, 'same title joins the existing printer');
  assert.equal(products()[0].offers.map((o) => o.url).sort().join('|'), [urlA, urlB].sort().join('|'));
  assert.equal(products()[0].offers.length, 2, 'both shops are compared on one row');

  // Rows that already split before the fix collapse into one, keeping the qwen row.
  store['catalog.json'] = {
    products: [
      row('qwen-abc', urlA, 'shop-a.example'),
      row('sel-zzz', urlB, 'shop-b.example'),
      { id: 'qwen-keep', name: 'Bambu Lab A1 Combo 3D Yazıcı', kind: 'printer', brand: 'Bambu Lab', offers: [{ store: 'shop-a.example', price: 1, url: 'https://shop-a.example/a1' }] }
    ],
    filaments: []
  };
  res = await context.handler(post({ action: 'collapseDuplicates' }));
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.removed, 1, 'one duplicate row collapsed');
  assert.equal(body.groups[0].kept, 'qwen-abc');
  assert.equal(body.groups[0].dropped, 'sel-zzz');
  assert.equal(products().length, 2, 'a different printer is left alone');
  const merged = products().find((p) => p.id === 'qwen-abc');
  assert.equal(merged.offers.length, 2, 'offers survived the collapse');
  assert.equal(JSON.stringify(merged.mergedIds), JSON.stringify(['sel-zzz']), 'the swallowed id is recorded');
  assert.equal(products().some((p) => p.id === 'sel-zzz'), false, 'the duplicate row is gone');

  // Idempotent: nothing left to collapse.
  res = await context.handler(post({ action: 'collapseDuplicates' }));
  assert.equal((await res.json()).removed, 0);

  console.log('PASS: URL and title dedupe on publish, duplicate rows collapse into the Magellan row.');
})().catch((e) => { console.error(e); process.exitCode = 1; });
