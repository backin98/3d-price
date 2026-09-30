// Shop Runs search: typos, partial words, Turkish colours, phrases, exclusions, filters, ranking, relaxed match.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const context = { URL, console, window: {}, document: { addEventListener() {}, getElementById: () => ({ innerHTML: '' }) } };
const source = fs.readFileSync('public/admin/admin.js', 'utf8').replace('  init();', 'globalThis.test = { state, reviewIndexOf, parseReviewQuery, scoreReview, editDistance, rsDidYouMean };');
vm.runInNewContext(source, context);
const { state, reviewIndexOf, parseReviewQuery, scoreReview, editDistance, rsDidYouMean } = context.test;
state.data = { baseline: { items: [] }, jobs: [], catalog: { products: [], filaments: [] }, desk: {}, filamentColours: require('../lib/filament-colours.cjs') };
const card = (url, name, extra = {}) => ({ card: { url, name, kind: 'filament', price: 600, decision: { action: 'held' }, ...extra }, decision: { action: 'held' }, shopName: 'Rhino' });
const cards = {
  bambuRed: card('https://www.rhino3dprinter.com/bambu-matte-red', 'Bambu Lab PLA Matte Filament', { brand: 'Bambu Lab', polymer: 'pla', variant: 'matte', colorName: 'Red', price: 650 }),
  bambuBlack: card('https://www.rhino3dprinter.com/bambu-basic-black', 'Bambu Lab PLA Basic Filament', { brand: 'Bambu Lab', polymer: 'pla', variant: 'basic', colorName: 'Black', price: 900, weight: '250 g' }),
  rhinoWood: card('https://www.rhino3dprinter.com/rhinolab-wood-pla', 'RhinoLab Wood PLA Filament', { brand: 'RhinoLab', polymer: 'pla', variant: 'wood', colorName: 'Oak', price: 480 }),
  rhinoSilk: card('https://www.rhino3dprinter.com/rhinolab-silk-pla-gold', 'RhinoLab PLA Silk Filament', { brand: 'RhinoLab', polymer: 'pla', variant: 'silk', colorName: 'Gold', price: 560 })
};
const ix = Object.fromEntries(Object.entries(cards).map(([k, v]) => [k, reviewIndexOf(v)]));
const hits = (q, relaxed = false) => Object.keys(ix).filter((k) => scoreReview(ix[k], parseReviewQuery(q), relaxed) != null).sort();
assert.deepEqual(hits('bambu'), ['bambuBlack', 'bambuRed']);
assert.deepEqual(hits('bam'), ['bambuBlack', 'bambuRed'], 'partial words');
assert.deepEqual(hits('bmabu'), ['bambuBlack', 'bambuRed'], 'a swapped-letter typo');
assert.deepEqual(hits('rhinolab sillk'), ['rhinoSilk'], 'a doubled-letter typo');
assert.deepEqual(hits('siyah'), ['bambuBlack'], 'Turkish colour names');
assert.deepEqual(hits('kırmızı'), ['bambuRed']);
assert.deepEqual(hits('"pla matte"'), ['bambuRed'], 'exact phrase');
assert.deepEqual(hits('pla -wood'), ['bambuBlack', 'bambuRed', 'rhinoSilk'], 'exclusion');
assert.deepEqual(hits('price:<600'), ['rhinoSilk', 'rhinoWood'], 'price below');
assert.deepEqual(hits('price:600-700'), ['bambuRed'], 'price range');
assert.deepEqual(hits('weight:250g'), ['bambuBlack'], 'weight');
assert.deepEqual(hits('weight:1kg'), ['bambuRed', 'rhinoSilk', 'rhinoWood'], 'unstated weight counts as 1 kg');
assert.deepEqual(hits('brand:rhinolab color:gold'), ['rhinoSilk'], 'field filters combine');
assert.deepEqual(hits('shop:rhino variant:wood'), ['rhinoWood']);
assert.deepEqual(hits('zzzxq'), []);
assert.deepEqual(hits('bambu rhinolab'), [], 'every word must match');
assert.deepEqual(hits('bambu rhinolab', true), ['bambuBlack', 'bambuRed', 'rhinoSilk', 'rhinoWood'], 'relaxed: at least half the words');
// Ranking: the phrase in the title beats a scattered match
const rank = Object.keys(ix).map((k) => [k, scoreReview(ix[k], parseReviewQuery('pla silk'), false)]).filter(([, s]) => s != null).sort((a, b) => b[1] - a[1]);
assert.equal(rank[0][0], 'rhinoSilk');
assert.equal(editDistance('silk', 'sillk', 2), 1); assert.equal(editDistance('bambu', 'bmabu', 2), 1, 'a swap is one edit');
assert.equal(rsDidYouMean(parseReviewQuery('bamboo'), 'bamboo', Object.values(ix)), 'bambu', 'two letters off still suggests the word');
assert.equal(rsDidYouMean(parseReviewQuery('qqqqqqq'), 'qqqqqqq', Object.values(ix)), '', 'nothing close: no guess');
assert.equal(rsDidYouMean(parseReviewQuery('rhinoblab zzz'), 'rhinoblab zzz', Object.values(ix)), 'rhinolab zzz', 'did you mean');
console.log('PASS: Shop Runs search forgives typos, folds Turkish, understands phrases, exclusions and filters, and ranks the best match first.');
