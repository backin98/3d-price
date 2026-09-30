// The storefront reads the admin's Storefront tab through /api/hunt: banners, pins and shop
// names. desk.json also holds internal addresses, so only the public fields may leave, and the
// storefront must never turn a scraped or typed link into something other than a web address.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const merch = require('../lib/storefront-merch.cjs');

const desk = {
  modelUrl: 'http://127.0.0.1:1235',
  workerUrl: 'http://127.0.0.1:8788',
  shops: [
    { id: 'rhino', name: 'Rhino 3D Printer', url: 'https://www.rhino3dprinter.com', enabled: true },
    { id: 'valment.com.tr', name: 'valment', url: 'https://www.valment.com.tr', enabled: true },
    { id: 'no-url.example', name: '', enabled: true }
  ],
  banners: [
    // the template's grocery banner that was seeded into desk.json
    { id: 'aisle', image: 'assets/banners/aisle.jpg', title: 'Walk the aisle.', enabled: true },
    { id: 'own', image: 'https://cdn.example/banner.jpg', kicker: 'New', title: 'Bambu H2D is here', subtitle: 'x'.repeat(400), href: 'https://shop.example/h2d', enabled: true },
    { id: 'off', image: 'assets/banners/compare.svg', title: 'Switched off', enabled: false },
    { id: 'evil', image: 'javascript:alert(1)', title: 'Bad links', href: 'javascript:alert(1)', enabled: true },
    { id: 'local', image: '/assets/banners/stock.svg', title: 'Local art', href: '/#main', enabled: true }
  ],
  promoted: [
    { id: 'pin-1', productId: 'p-a1', query: 'bambu a1', slot: 'paid', enabled: true },
    { id: 'pin-2', productId: 'p-k2', query: '', slot: 'promoted' },
    { id: 'pin-3', productId: 'p-off', query: 'x', slot: 'paid', enabled: false },
    { id: 'pin-4', query: 'no product' }
  ]
};

// --- the public shape -------------------------------------------------------------------
const out = merch.storefrontMerch(desk);
const wire = JSON.stringify(out);
assert.ok(!wire.includes('127.0.0.1'), 'internal addresses never reach the storefront: ' + wire);
assert.deepEqual(Object.keys(out).sort(), ['merch', 'stores']);

const banners = out.merch.banners;
assert.deepEqual(banners.map((b) => b.title), ['Bambu H2D is here', 'Bad links', 'Local art'], 'legacy and disabled banners are dropped');
assert.equal(banners[0].subtitle.length, 280, 'copy is capped');
assert.equal(banners[0].href, 'https://shop.example/h2d');
assert.equal(banners[1].image, '', 'a javascript: image is not an image');
assert.equal(banners[1].href, '', 'a javascript: link is not a link');
assert.equal(banners[2].image, '/assets/banners/stock.svg');
assert.equal(banners[2].href, '/#main', 'a path on this site is a fine link');
assert.deepEqual(Object.keys(banners[0]).sort(), ['href', 'image', 'kicker', 'subtitle', 'title'], 'only public banner fields');

assert.deepEqual(out.merch.pins, [
  { productId: 'p-a1', query: 'bambu a1', slot: 'paid' },
  { productId: 'p-k2', query: '', slot: 'promoted' }
], 'disabled pins and pins without a product are dropped');

assert.equal(out.stores['rhino3dprinter.com'], 'Rhino 3D Printer', 'shops are keyed by host, www. dropped');
assert.equal(out.stores['valment.com.tr'], 'Valment', 'an all-lower-case name gets a capital');
assert.equal(out.stores['no-url.example'], 'No-url.example', 'a shop without a URL falls back to its id');

assert.equal(merch.ownBanners(desk).some((b) => b.id === 'aisle'), false, 'the admin editor no longer sees template banners');
assert.equal(merch.ownBanners(desk).length, 4);
assert.deepEqual(merch.storefrontMerch({}), { merch: { banners: [], pins: [] }, stores: {} }, 'an empty desk is fine');

// --- /api/hunt carries it, and caches the heavy collapse per catalog content ------------
const huntSrc = fs.readFileSync(path.join(__dirname, '..', 'netlify', 'functions', 'hunt.mjs'), 'utf8')
  .replace(/^import .*;$/gm, '')
  .replace('export default async', 'globalThis.handler = async');
const files = {
  'catalog.json': { products: [{ id: 'p-a1', name: 'Bambu Lab A1', offers: [{ store: 'valment.com.tr', price: 100, url: 'https://www.valment.com.tr/a1' }] }], filaments: [] },
  'baseline.json': { items: [] },
  'desk.json': desk
};
let collapses = 0;
const catalogUnion = require('../lib/catalog-union.cjs');
const sandbox = {
  Response, URL,
  store: { readJSON: async (key, fallback) => JSON.parse(JSON.stringify(key in files ? files[key] : fallback)) },
  catalogUnion: { ...catalogUnion, collapseByMagellan: (c) => { collapses += 1; return catalogUnion.collapseByMagellan(c); } },
  search: require('../lib/search-match.cjs'),
  boardLib: require('../lib/baseline-board.cjs'),
  merchLib: merch
};
vm.runInNewContext(huntSrc, sandbox);

// --- the storefront side ----------------------------------------------------------------
const nodes = new Map();
const node = (sel) => { if (!nodes.has(sel)) nodes.set(sel, { hidden: true, innerHTML: '', textContent: '', dataset: {}, contains: () => false }); return nodes.get(sel); };
const context = {
  URL, Response, console,
  window: {
    SITE_CONTENT: {
      banners: [{ image: 'assets/banners/compare.svg', title: 'Default' }], units: {}, live: { compared: 'Compared' },
      cart: {}, sheet: {}, bestOffer: 'Best', brand: {}, filament: {}, header: {}, hunter: {}, profile: {},
      productExact: {}, productPhrases: [['3D Yazıcı', '3D Printer'], ['Serisi', 'Series']], wasPrice: 'was'
    }
  },
  document: {
    querySelector: node, querySelectorAll: () => [], addEventListener() {}, body: {},
    documentElement: { lang: '', dataset: {}, classList: { add() {}, remove() {}, toggle() {} } },
    createElement: () => ({ dataset: {}, style: {}, appendChild() {}, setAttribute() {} })
  },
  location: { hash: '', search: '' }, localStorage: { getItem: () => null, setItem() {} },
  setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, clearTimeout() {}, requestAnimationFrame: () => 1,
  addEventListener() {}, fetch: async () => ({ ok: false, status: 404, json: async () => ({}) }),
  ResizeObserver: function () { this.observe = () => {}; }
};
// Load the storefront without its bootstrap (same whole-line match as the other storefront tests).
const boot = /^\s*(?:initStatic|bind)\(\);\s*$|^\s*huntRhino\(state\.query \|\| \""\);\s*$/;
const appSrc = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8')
  .split('\r\n').join('\n').split('\n').filter((line) => !boot.test(line)).join('\n');
vm.runInNewContext(appSrc, context);
const api = context.window.__3dp;

(async () => {
  const res = await sandbox.handler({ url: 'https://3d-price.example/api/hunt' });
  const body = await res.json();
  assert.equal(body.products.length, 1);
  assert.equal(body.stores['valment.com.tr'], 'Valment');
  assert.equal(body.merch.banners.length, 3);
  assert.ok(!JSON.stringify(body).includes('127.0.0.1'), 'the catalog API leaks no internal address');
  await sandbox.handler({ url: 'https://3d-price.example/api/hunt' });
  assert.equal(collapses, 1, 'an unchanged catalog is collapsed once per warm instance');
  files['catalog.json'].products[0].offers[0].price = 90;
  const changed = await (await sandbox.handler({ url: 'https://3d-price.example/api/hunt' })).json();
  assert.equal(collapses, 2, 'a saved change is collapsed again on the next request');
  assert.equal(changed.products[0].offers[0].price, 90, 'and served at once');

  // Folded baseline names are re-cased for display; names typed with capitals are left alone.
  assert.equal(api.prettyName('creality k2 combo 3d yazici cfs cok renkli baski'), 'Creality K2 Combo 3D Yazıcı CFS Çok Renkli Baskı');
  assert.equal(api.prettyName('flsun t1 pro'), 'FLSUN T1 Pro');
  assert.equal(api.prettyName('bambu lab fah021 a1a1 mini 08mm sertlestirilmis celik hotend'), 'Bambu Lab FAH021 A1A1 Mini 0.8mm Sertleştirilmiş Çelik Hotend');
  assert.equal(api.prettyName('nozzle 0.4 mm 1.75mm'), 'Nozzle 0.4 mm 1.75mm');
  assert.equal(api.prettyName('Bambu Lab P1S Combo'), 'Bambu Lab P1S Combo', 'a name with its own capitals is untouched');
  assert.equal(api.prettyName('QIDI Q2C ve Outlet'), 'QIDI Q2C ve Outlet');

  // Shop display names come from the API; unknown shops show their host.
  api.applyMerch(body);
  assert.equal(api.storeLabel('valment.com.tr'), 'Valment');
  assert.equal(api.storeLabel('www.rhino3dprinter.com'), 'Rhino 3D Printer');
  assert.equal(api.storeLabel('www.unknown-shop.com'), 'unknown-shop.com');

  // Scraped or typed links: only web addresses reach an href.
  assert.equal(api.webUrl('javascript:alert(1)'), '');
  assert.equal(api.webUrl(' https://shop.example/x '), 'https://shop.example/x');
  assert.equal(api.bannerHref('javascript:alert(1)'), '');
  assert.equal(api.bannerHref('//evil.example/'), '', 'a protocol-relative link could leave the site');
  assert.equal(api.bannerImage('data:image/svg+xml,<svg/>'), '');
  assert.equal(api.bannerImage('assets/banners/match.svg'), 'assets/banners/match.svg');

  // Pins: a paid pin leads the shelf only when every word of its query is in the search.
  const products = [
    { id: 'p-k2', name: 'Creality K2', offers: [{ store: 'a', price: 10 }] },
    { id: 'p-a1', name: 'Bambu Lab A1', offers: [{ store: 'b', price: 20 }] },
    { id: 'p-a1-combo', name: 'Bambu Lab A1 Combo', offers: [{ store: 'c', price: 30 }] }
  ];
  api.state.liveProducts = products;
  api.state.query = 'bambu a1 combo';
  let shelf = api.pinnedFirst(products.slice(1).reverse());
  assert.equal(shelf.list[0].id, 'p-a1', 'the pinned product leads a matching search');
  assert.equal(shelf.pinOf.get('p-a1').slot, 'paid', 'and is marked as paid');
  assert.equal(shelf.list.filter((p) => p.id === 'p-a1').length, 1, 'never listed twice');
  api.state.query = 'a1';
  shelf = api.pinnedFirst(products.slice(1));
  assert.equal(shelf.pinOf.size, 0, 'a search missing a pin word does not show the pin');
  api.state.query = '';
  shelf = api.pinnedFirst(products);
  assert.equal(shelf.list[0].id, 'p-k2', 'a pin without a query leads the home shelf');
  assert.equal(shelf.pinOf.get('p-k2').slot, 'promoted');
  api.state.query = 'k2';
  assert.equal(api.pinnedFirst(products).pinOf.size, 0, 'a home pin stays off search results');

  console.log('PASS: the storefront gets only public banner/pin/shop fields, links stay web links, folded names read properly and pins are labelled.');
})().catch((e) => { console.error(e); process.exitCode = 1; });
