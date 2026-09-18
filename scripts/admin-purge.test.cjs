// Purging one shop must take exactly one shop's data: its offers, the rows that only
// it filled, its category URLs, shared category names only it used, and its runs.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const R = (name, url) => ({ store: new URL(url).hostname.replace(/^www\./, ''), price: 1, url });
const row = (id, name, ...urls) => ({ id, name, kind: 'printer', brand: 'Bambu Lab', offers: urls.map((u) => R(name, u)) });

const store = {
  'desk.json': {
    id: 'desk',
    modelUrl: '',
    // ids are slugs, stores and URLs carry hosts: the purge must match on the host
    shops: [
      { id: 'robolink', name: 'Robolink Market', url: 'https://www.robolinkmarket.com', enabled: true, categories: [{ id: 'cat-a', name: 'Printers', url: 'https://www.robolinkmarket.com/3d-yazicilar' }], categoryIds: ['cat-a'] },
      { id: 'metatech', name: 'Metatech', url: 'https://store.metatechtr.com', enabled: true, categories: [{ id: 'cat-b', name: 'Printer', url: 'https://store.metatechtr.com/3d-yazicilar' }], categoryIds: ['cat-b'] }
    ],
    categories: [{ id: 'cat-a', name: 'Printers' }, { id: 'cat-b', name: 'Printer' }],
    banners: [],
    promoted: []
  },
  'jobs.json': [
    { id: 'job-1', url: 'https://www.robolinkmarket.com/3d-yazicilar', status: 'complete' },
    { id: 'job-2', url: 'https://store.metatechtr.com/3d-yazicilar', status: 'complete' }
  ],
  'catalog.json': {
    products: [
      row('qwen-only-robolink', 'Bambu Lab P1S 3D Yazıcı', 'https://www.robolinkmarket.com/p1s'),
      row('qwen-both', 'Bambu Lab P1S Combo 3D Yazıcı', 'https://www.robolinkmarket.com/p1s-combo', 'https://store.metatechtr.com/p1s-combo'),
      row('qwen-only-metatech', 'Bambu Lab H2D Combo', 'https://store.metatechtr.com/h2d')
    ],
    filaments: []
  },
  'candidate.json': {
    products: [row('qwen-both', 'Bambu Lab P1S Combo 3D Yazıcı', 'https://www.robolinkmarket.com/p1s-combo', 'https://store.metatechtr.com/p1s-combo')],
    filaments: []
  }
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
vm.runInNewContext(source, context);

const post = (body) => new Request('https://example.com/api/admin', {
  method: 'POST',
  headers: { origin: 'https://example.com', 'content-type': 'application/json' },
  body: JSON.stringify(body)
});
const products = () => store['catalog.json'].products;
const names = () => products().map((p) => p.name).join(' | ');
const hostOf = (o) => new URL(o.url).hostname.replace(/^www\./, '');

(async () => {
  // Products only, runs kept.
  let res = await context.handler(post({ action: 'purgeShop', shop: 'robolink', runs: false }));
  let body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.offers, 3, 'both robolink offers on the shared row plus its own row: ' + JSON.stringify(body));
  assert.equal(body.rows, 1, 'the row only robolink filled is gone');
  assert.equal(body.categories, 1, 'its own category URL entry is removed');
  assert.equal(body.jobs, 0, 'runs kept when asked');
  assert.equal(store['jobs.json'].length, 2, 'job list untouched');
  assert.equal(names(), 'Bambu Lab P1S Combo 3D Yazıcı | Bambu Lab H2D Combo', 'metatech rows survive');
  const shared = products()[0];
  assert.equal(shared.offers.length, 1, 'the shared row keeps the other shop');
  assert.equal(hostOf(shared.offers[0]), 'store.metatechtr.com');
  assert.equal(products().every((p) => (p.offers || []).every((o) => hostOf(o) !== 'robolinkmarket.com')), true, 'no robolink offer left anywhere');
  // "Printers" was only robolink's name, "Printer" is metatech's.
  assert.equal(store['desk.json'].categories.map((c) => c.name).join('|'), 'Printer');
  assert.equal(store['desk.json'].shops.find((s) => s.id === 'robolink').categories.length, 0);
  assert.equal(store['desk.json'].shops.find((s) => s.id === 'metatech').categories.length, 1, 'other shop categories untouched');
  // The candidate snapshot is cleaned the same way.
  assert.equal(store['candidate.json'].products[0].offers.length, 1);

  // Runs too, and a second pass finds nothing.
  res = await context.handler(post({ action: 'purgeShop', shop: 'robolink', runs: true }));
  body = await res.json();
  assert.equal(body.offers, 0, 'idempotent');
  assert.equal(store['jobs.json'].map((j) => j.id).join('|'), 'job-2', 'robolink runs removed, metatech run kept');

  // Single run by id.
  store['jobs.json'].push({ id: 'job-3', url: 'https://store.metatechtr.com/x', status: 'complete' });
  res = await context.handler(post({ action: 'deleteJobs', id: 'job-3' }));
  assert.equal((await res.json()).removed, 1);
  assert.equal(store['jobs.json'].length, 1);

  // All runs for one shop, then everything.
  store['jobs.json'].push({ id: 'job-4', url: 'https://store.metatechtr.com/y', status: 'complete' });
  res = await context.handler(post({ action: 'deleteJobs', shop: 'metatech' }));
  assert.equal((await res.json()).removed, 2);
  res = await context.handler(post({ action: 'deleteJobs' }));
  assert.equal((await res.json()).removed, 0, 'nothing left to delete');

  const bad = await context.handler(post({ action: 'purgeShop', shop: 'nope' }));
  assert.equal(bad.status, 400, 'unknown shop is rejected');

  console.log('PASS: purge removes one shop\'s offers, emptied rows, categories and runs, and leaves the rest alone.');
})().catch((e) => { console.error(e); process.exitCode = 1; });
