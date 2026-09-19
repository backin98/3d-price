// Searching a product family has to find every variant, including a row that was branched out
// and named from its URL slug. The real case from production: a row named
// "creality k2 plus combo" (sourceTitle was empty) was invisible to "Creality K2 Plus Combo
// 3D Yazıcı", because search asked "is the whole query inside the name?".
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { matchesSearch, searchTokens, filterSearch } = require('../lib/search-match.cjs');
const { filterSearch: huntFilter } = require('../lib/search-match.cjs');

// The exact branched row and its sibling from the live catalog.
const branched = {
  id: 'man-sdqdo9', name: 'creality k2 plus combo', brand: '', kind: 'printer',
  offers: [{ store: 'rhino3dprinter.com', sourceTitle: '', url: 'https://www.rhino3dprinter.com/urun/creality-k2-plus-combo' }]
};
const sibling = {
  id: 'qwen-k2', name: 'Creality K2 Combo 3D Yazıcı', brand: 'Creality', kind: 'printer', price: 32384.81,
  offers: [{ store: 'rhino3dprinter.com', sourceTitle: 'Creality K2 Combo 3D Yazıcı', url: 'https://www.rhino3dprinter.com/creality-k2-combo-3d-yazici' }]
};
const p1s = {
  id: 'qwen-p1s', name: 'Bambu Lab P1S Combo 3D Yazıcı', brand: 'Bambu Lab', kind: 'printer',
  offers: [{ store: 'rhino3dprinter.com', sourceTitle: 'Bambu Lab P1S AMS 2 Pro Combo 3D Printer with Buffer', url: 'https://www.rhino3dprinter.com/bambu-lab-p1s-ams-2-pro-combo' }]
};

// --- the family query finds the branched row -------------------------------------------
assert.equal(matchesSearch(branched, 'Creality K2 Plus Combo 3D Yazıcı'), true, 'the family query finds a slug-named row');
assert.equal(matchesSearch(branched, 'k2 plus'), true, 'a fragment finds it');
assert.equal(matchesSearch(branched, 'creality k2 plus combo'), true, 'its own name still works');
assert.equal(matchesSearch(branched, '3d yazıcı'), true, 'a filler-only query matches the category');
assert.equal(matchesSearch(branched, 'yazici k2 plus'), true, 'word order does not matter');
assert.equal(matchesSearch(branched, 'K2 PLUS COMBO 3D YAZICI'), true, 'case does not matter');
assert.equal(matchesSearch(branched, 'k2 ultra'), false, 'a token that is not there does not match');
assert.equal(matchesSearch(branched, 'p1s'), false, 'and neither does another family');

// --- precision: the plain K2 Combo is not the K2 Plus ----------------------------------
assert.equal(matchesSearch(sibling, 'K2 Plus'), false, 'the plain sibling is not returned for the Plus');
assert.equal(matchesSearch(sibling, 'Creality K2 Combo'), true, 'but its own family finds it');

// --- offers are searched, not just the row name -----------------------------------------
assert.equal(matchesSearch(p1s, 'with buffer'), true, 'a scraped offer title is searchable');
assert.equal(matchesSearch(p1s, 'AMS 2 Pro'), true, '...including its variant words');
assert.equal(matchesSearch(p1s, 'rhino3dprinter'), true, 'and the shop name');
assert.equal(matchesSearch({ id: 'x', name: '', offers: [{ url: 'https://shop.example/urun/anycubic-kobra-2-pro' }] }, 'kobra 2 pro'), true, 'even a row with no name matches through its URL');

// --- Turkish folding -------------------------------------------------------------------
assert.deepEqual(searchTokens('Creality K2 Plus Combo 3D Yazıcı'), ['creality', 'k2', 'plus', 'combo'], 'filler words drop out');
assert.equal(matchesSearch({ name: 'Creality Ender 3 V3 Ürün İnceleme' }, 'urun inceleme'), true, 'ASCII typing finds Turkish text');
assert.equal(matchesSearch({ name: 'Anycubic Kobra 3 V2 Combo' }, 'KOBRA'), true);

// --- the server filter and the storefront agree ----------------------------------------
const list = [branched, sibling, p1s];
assert.equal(huntFilter(list, 'Creality K2 Plus Combo 3D Yazıcı').length, 1, 'the API returns the branched row');
assert.equal(huntFilter(list, 'k2').length, 2, 'the family returns both K2 rows');
assert.equal(huntFilter(list, '').length, 3, 'an empty query returns everything');

// The storefront filters locally with its own mirror of this matcher.
const nodes = new Map();
const node = (sel) => { if (!nodes.has(sel)) nodes.set(sel, { hidden: true, innerHTML: '', textContent: '', dataset: {}, contains: () => false }); return nodes.get(sel); };
const context = {
  URL, Response, console,
  window: {
    SITE_CONTENT: {
      desk: {}, locations: [], aisles: [], banners: [], ads: [], units: [], products: [],
      live: { compared: 'Compared' }, cart: {}, sheet: {}, bestOffer: 'Best', brand: {}, dir: {},
      documentTitle: {}, emptyAisle: {}, emptySearchBody: {}, emptySearchTitle: {}, filament: {}, header: {},
      hunter: {}, lang: {}, offerCount: {}, productExact: {}, productPhrases: [], profile: {}, resultsCount: {},
      savedDeal: {}, saveDeal: {}, wasPrice: 'was'
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
const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8')
  .split('\r\n').join('\n')
  .replace(/\n\s*initStatic\(\);/, '').replace(/\n\s*bind\(\);/, '').replace(/\n\s*huntRhino\([^)]*\);/, '');
vm.runInNewContext(src, context);
const api = context.window.__3dp;
assert.ok(api.matchingProducts, 'the storefront search is exposed for testing');
// Drive the storefront the way a visitor does: set the query, ask for matches.
api.state.liveProducts = [branched, sibling, p1s];
api.state.liveFilaments = [];
api.state.query = 'Creality K2 Plus Combo 3D Yazıcı';
const found = api.matchingProducts().map((p) => p.id);
assert.deepEqual(found, ['man-sdqdo9'], 'the storefront finds the branched row by its family');
api.state.query = 'k2';
assert.equal(api.matchingProducts().length, 2, 'the family query shows both K2 rows together');
api.state.query = 'with buffer';
assert.equal(api.matchingProducts().map((p) => p.id).join(), 'qwen-p1s', 'an offer title is searchable in the storefront too');
api.state.query = 'k2 plus';
assert.equal(api.matchingProducts().map((p) => p.id).join(), 'man-sdqdo9', 'and the plain sibling stays out of it');
api.state.query = '';
assert.equal(api.matchingProducts().length, 3, 'an empty query returns everything');

console.log('PASS: family searches find branched and slug-named rows, offers are searchable, Turkish folds both ways, and siblings stay distinct.');
