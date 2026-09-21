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
assert.equal(matchesSearch({ id: 'x', name: '', offers: [{ url: 'https://shop.example/urun/anycubic-kobra-2-pro' }] }, 'kobra 2 pro'), false, 'an offer URL alone does not enter the default haystack');
assert.equal(matchesSearch({ name: 'Bambu Lab A1 Mini', kind: 'printer' }, 'a1mini'), true, 'glued model queries match spaced model names');

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
  // Load the storefront module without running its bootstrap. Matching whole lines is
  // deliberate: a regex over the file mangled nested calls on me once already.
  const boot = /^\s*(?:initStatic|bind)\(\);\s*$|^\s*huntRhino\(state\.query \|\| \""\);\s*$/;
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8')
    .split('\r\n').join('\n')
    .split('\n')
    .filter((line) => !boot.test(line))
    .join('\n');
vm.runInNewContext(src, context);
const api = context.window.__3dp;
assert.ok(api.matchingProducts, 'the storefront search is exposed for testing');
// Drive the storefront the way a visitor does: set the query, ask for matches.
api.state.liveProducts = [branched, sibling, p1s];
api.state.liveFilaments = [];
api.state.query = 'Creality K2 Plus Combo 3D Yazıcı';
const found = api.matchingProducts().map((p) => p.id);
// Ranked with recall: the exact family match leads and the other variants follow below it.
assert.equal(found[0], 'man-sdqdo9', 'the storefront finds the branched row by its family, first');
assert.ok(found.length >= 1, 'and lists it with the rest of the family: ' + JSON.stringify(found));
api.state.query = 'k2';
assert.equal(api.matchingProducts().length, 2, 'the family query shows both K2 rows together');
api.state.query = 'with buffer';
assert.equal(api.matchingProducts().map((p) => p.id).join(), 'qwen-p1s', 'an offer title is searchable in the storefront too');
api.state.query = 'k2 plus';
const plusRanked = api.matchingProducts().map((p) => p.id);
assert.equal(plusRanked[0], 'man-sdqdo9', 'the Plus itself ranks first for "k2 plus"');
assert.ok(plusRanked.indexOf('qwen-k2') > 0, 'siblings rank below it rather than disappearing');
api.state.query = '';
assert.equal(api.matchingProducts().length, 3, 'an empty query returns everything');

// --- ranking, recall, prefixes and typos (the general search, not a K2 patch) -----------
const { searchScore, rankSearch } = require('../lib/search-match.cjs');
const four = [
  { id: 'k2', name: 'Creality K2 3D Yazıcı', offers: [{ url: 'https://x/creality-k2-3d-yazici' }] },
  { id: 'k2c', name: 'Creality K2 Combo 3D Yazıcı', offers: [{ url: 'https://x/creality-k2-combo' }, { sourceTitle: 'Creality K2 Pro Combo', url: 'https://x/creality-k2-pro-combo' }] },
  { id: 'k2pro', name: 'Creality K2 Pro Combo 3D Yazıcı', offers: [{ url: 'https://x/creality-k2-pro-combo' }] },
  { id: 'k2plus', name: 'Creality K2 Plus Combo', offers: [{ url: 'https://x/urun/creality-k2-plus-combo' }] }
];
const ids = (q) => rankSearch(four, q).map((p) => p.id);

// The complaint: "k2 pro" dropped the K2 Plus because a strict AND hid every sibling.
assert.equal(ids('k2').length, 4, 'the family query shows every variant');
assert.equal(ids('k2 pro')[0], 'k2pro', 'the row that really says "pro" ranks first');
assert.ok(ids('k2 pro').includes('k2plus'), 'and the other variants are still listed, ranked below');
assert.ok(searchScore(four[2], 'k2 pro').score > searchScore(four[3], 'k2 pro').score, 'exact beats related');

// The model number anchors it: unrelated "Pro" products must not outrank the K2 family.
const noisy = [
  ...four,
  { id: 'm7', name: 'Anycubic Photon Mono M7 Pro MSLA 3D Printer', offers: [{ url: 'https://x/anycubic-m7-pro' }] },
  { id: 'ams', name: 'Bambu Lab AMS 2 Pro - Automatic Material System', offers: [{ url: 'https://x/ams-2-pro' }] },
  { id: 'h2d', name: 'Bambu Lab H2D 3D Printer', offers: [{ url: 'https://x/h2d' }] }
];
const noisyIds = rankSearch(noisy, 'k2 pro').map((p) => p.id);
assert.equal(noisyIds[0], 'k2pro', 'the K2 Pro leads');
assert.ok(noisyIds.includes('k2plus'), 'the K2 Plus is still there: ' + JSON.stringify(noisyIds));
assert.equal(noisyIds.includes('m7'), false, 'an unrelated "Pro" printer is not this family');
assert.equal(noisyIds.includes('ams'), false, 'nor is an AMS module');
assert.equal(noisyIds.includes('h2d'), false, 'nor another model entirely');
assert.equal(rankSearch(noisy, 'k2').length, 4, 'a bare model query still shows the whole family');

// Typing half a word, or fat-fingering it, still finds the product.
assert.equal(ids('k2 plu')[0], 'k2plus', 'a prefix finds it');
assert.equal(ids('k2 plsu')[0], 'k2plus', 'a swapped pair finds it');
assert.equal(ids('creality k2 pro combo 3d yazici')[0], 'k2pro', 'a full title finds it, filler words ignored');
assert.equal(ids('bambu p1s').length, 0, 'a query with no match still returns nothing');

// Ranking is stable and deterministic.
assert.deepEqual(ids('k2 pro'), ids('k2 pro'), 'same query, same order');
assert.equal(searchScore(four[0], 'k2').score, searchScore(four[1], 'k2').score, 'equal rows score equally');

const polluted = { id: 'wrong', name: 'Bambu Lab H2S', brand: 'Bambu Lab', kind: 'printer', offers: [{ sourceTitle: 'Bambu Lab', url: 'https://shop.example/bambu-lab-a1' }] };
const real = { id: 'real', name: 'Bambu Lab A1', brand: 'Bambu Lab', kind: 'printer', offers: [] };
assert.deepEqual(rankSearch([polluted, real], 'a1').map((p) => p.id), ['real'], 'URL-only model tokens cannot rank a polluted card');
api.state.liveProducts = [polluted, real];
api.state.query = 'a1';
assert.deepEqual(Array.from(api.matchingProducts(), (p) => p.id), ['real'], 'the storefront mirror also ignores offer URL tokens');
assert.equal(require('../api/hunt.js').pickBrand('', 'Mystery Printer', 'printer'), '', 'missing printer brand has no hardcoded fallback');

console.log('PASS: family searches find branched and slug-named rows, offers are searchable, Turkish folds both ways, and siblings stay distinct.');
