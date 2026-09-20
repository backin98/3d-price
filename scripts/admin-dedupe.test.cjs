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

// ---------------------------------------------------------------------------------------------
// Running the same shop twice (or publishing twice) must not show the same listing twice.
// The URL is the identity: one store's listing lives in exactly one product.
(async () => {
  const api = require('node:vm');
  const source = fs.readFileSync('netlify/functions/admin.mjs', 'utf8')
    .replace(/^import .*;$/gm, '')
    .replace('export default async', 'globalThis.handler = async');
  const files = {
    'catalog.json': {
      source: { id: 'multi', name: 'Shops' }, savedAt: '2026-01-01T00:00:00.000Z',
      products: [
        { id: 'a', name: 'Bambu Lab H2D Lazer Full Combo 10W 3D Yazıcı', offers: [
          { store: 'robotizmo.net', price: 114009.82, url: 'https://www.robotizmo.net/h2d-10w' },
          { store: 'robotizmo.net', price: 114009.82, url: 'https://www.robotizmo.net/h2s-10w' }
        ] },
        { id: 'b', name: 'Bambu Lab H2C Lazer Full Combo', offers: [
          { store: 'robotizmo.net', price: 114009.82, url: 'https://www.robotizmo.net/h2c-40w' },
          { store: 'robotizmo.net', price: 114009.82, url: 'https://www.robotizmo.net/h2s-10w' }
        ] }
      ],
      filaments: []
    },
    'desk.json': { shops: [], banners: [] }
  };
  const store = {
    readJSON: async (k, fb) => (k in files ? JSON.parse(JSON.stringify(files[k])) : fb),
    writeJSON: async (k, v) => { files[k] = JSON.parse(JSON.stringify(v)); },
    deleteKey: async (k) => { delete files[k]; }
  };
  const sandbox = {
    console, Response, crypto: require('node:crypto'), store,
    auth: { ownerFromHeaders: () => ({ role: 'owner' }), authReady: () => true },
    money: require('../lib/parse-money.cjs'),
    matcher: require('../lib/product-match.cjs')
  };
  api.runInNewContext(source, sandbox);
  const post = (body) => sandbox.handler({ method: 'POST', headers: { get: () => null, entries: () => [][Symbol.iterator]() }, json: async () => body });

  const before = await (await sandbox.handler({ method: 'GET', headers: { get: () => null, entries: () => [][Symbol.iterator]() } })).json();
  assert.equal(before.duplicateOffers.length, 1, 'the API reports the duplicated listing');
  assert.equal(before.duplicateOffers[0].url, 'https://www.robotizmo.net/h2s-10w');

  const fixed = await (await post({ action: 'dedupeOfferUrls' })).json();
  assert.equal(fixed.groups, 1, 'one group fixed');
  assert.equal(fixed.removed, 1, 'one duplicate copy removed');
  assert.equal(fixed.left, 0, 'nothing left duplicated');
  const rows = files['catalog.json'].products;
  assert.equal(rows.length, 2, 'both products survive — only the copied listing was taken off the wrong one');
  const owners = rows.filter((r) => (r.offers || []).some((o) => o.url === 'https://www.robotizmo.net/h2s-10w'));
  assert.equal(owners.length, 1, 'the listing now belongs to exactly one product: ' + JSON.stringify(owners.map((r) => r.name)));
  assert.equal(owners[0].id, 'a', 'and it is the product whose title matches the URL, not the one it leaked onto');
  assert.equal(rows.find((r) => r.id === 'b').offers.length, 1, 'the other product keeps its own listing');
  console.log('PASS: running a shop twice leaves one listing on one product — duplicates are detectable and fixable, not silent.');
})().catch((e) => { console.error(e); process.exitCode = 1; });
