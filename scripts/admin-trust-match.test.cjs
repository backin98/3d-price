// Two pieces of the admin that have no screen of their own:
//  - the Ready / Check verdict of a Shop runs card, with the reasons;
//  - "Goes to": a card whose sub-brand the run read from the title still finds the baseline model that carries that line
//    only in its name ("Polymaker PolyLite ASA"), but a different line or a missing one is still a different model.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const nodes = new Map();
const node = (sel) => { if (!nodes.has(sel)) nodes.set(sel, { hidden: true, innerHTML: '', textContent: '', value: '', contains: () => false }); return nodes.get(sel); };
const context = { URL, Response, document: { querySelector: node, querySelectorAll: () => [] }, location: { hash: '#runs' }, window: {}, setInterval() { return 1; }, clearInterval() {}, setTimeout() {}, clearTimeout() {}, fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }) };
const source = fs.readFileSync('public/admin/admin.js', 'utf8').replace('  init();', '  globalThis.test = { state, trustOf, autoBaselinePlace };');
vm.runInNewContext(source, context);
const { state, trustOf, autoBaselinePlace } = context.test;

const baseline = [
  { id: 'b-lite', category: 'filaments', entityType: 'family', name: 'Polymaker PolyLite ASA', brand: 'Polymaker', subBrand: '', polymer: 'asa', variant: '', diameter: '1.75 mm' },
  { id: 'b-pm-pla', category: 'filaments', entityType: 'family', name: 'Polymaker Matte PLA', brand: 'Polymaker', subBrand: '', polymer: 'pla', variant: 'matte', diameter: '1.75 mm' },
  { id: 'b-pan', category: 'filaments', entityType: 'family', name: 'Polymaker Panchroma Matte PLA', brand: 'Polymaker', subBrand: 'Panchroma', polymer: 'pla', variant: 'matte', diameter: '1.75 mm' },
  { id: 'b-cr', category: 'filaments', entityType: 'family', name: 'Creality CR PETG', brand: 'Creality', subBrand: 'CR', polymer: 'petg', variant: '', diameter: '1.75 mm' },
  { id: 'b-tpu', category: 'filaments', entityType: 'family', name: 'Creality TPU', brand: 'Creality', subBrand: '', polymer: 'tpu', variant: '', diameter: '1.75 mm' }
];
state.data = { baseline: { items: baseline }, jobs: [], catalog: { products: [], filaments: [] } };
const fields = (o) => ({ kind: 'filament', diameter: '1.75 mm', variant: '', subBrand: '', ...o });
const placed = (o) => (autoBaselinePlace(fields(o)) || {}).candidateId;

// the line is in the model's name, never typed into its sub-brand box: still that model
assert.equal(placed({ brand: 'Polymaker', subBrand: 'PolyLite', polymer: 'asa' }), 'baseline:b-lite');
// a model that really has the line wins over a plain one
assert.equal(placed({ brand: 'Polymaker', subBrand: 'Panchroma', polymer: 'pla', variant: 'matte' }), 'baseline:b-pan');
// a line the model does not carry is another model
assert.equal(placed({ brand: 'Polymaker', subBrand: 'PolyTerra', polymer: 'pla', variant: 'matte' }), undefined, 'PolyTerra is not in "Polymaker Matte PLA"');
// no line on the card: it still finds the plain model, never one with a line
assert.equal(placed({ brand: 'Polymaker', polymer: 'pla', variant: 'matte' }), 'baseline:b-pm-pla');
// "Creality TPU" is not "Creality CR TPU" (the rule that was already there)
assert.equal(placed({ brand: 'Creality', subBrand: 'CR', polymer: 'tpu' }), undefined);
assert.equal(placed({ brand: 'Creality', polymer: 'tpu' }), 'baseline:b-tpu');
assert.equal(placed({ brand: 'Creality', subBrand: 'CR', polymer: 'petg' }), 'baseline:b-cr');

// ---- Ready / Check -------------------------------------------------------------------------------------------------
const ev = (card, extra) => ({ card: { url: 'https://shop.example/x', kind: 'filament', brand: 'Creality', polymer: 'tpu', price: 400, weight: '1000 g', color: 'red', colorName: 'Red', spoolMaterial: 'plastic', ...card }, decision: {}, ...extra });
let t = trustOf(ev({}));
assert.equal(t.level, 'ready', 'everything known, a baseline model to go to: ' + JSON.stringify(t));
t = trustOf(ev({ spoolMaterial: '' }));
assert.equal(t.level, 'check'); assert.deepEqual(Array.from(t.why), ['spool unknown']);
t = trustOf(ev({ price: 0, weightAssumed: true, color: '', colorName: '' }));
assert.deepEqual(Array.from(t.why), ['no price', 'weight not in the listing', 'colour unknown']);
t = trustOf(ev({ brand: 'Nobody', polymer: 'pla' }));
assert.deepEqual(Array.from(t.why), ['no baseline model yet'], 'everything known, but nowhere to go');
// The verdict judges what the card shows. A spool the run never set, which the card takes from the baseline model its
// title matches (or from the model's linked spool group), is known; one nothing supplies is not.
// (a data reload hands the admin new arrays; its profile cache is keyed on them)
state.data = { ...state.data, baseline: { items: [...baseline, { id: 'b-eco', category: 'filaments', entityType: 'family', name: 'Acme Eco PLA', brand: 'Acme', subBrand: '', polymer: 'pla', variant: '', diameter: '1.75 mm', spoolMaterial: 'cardboard' }] } };
t = trustOf(ev({ brand: 'Acme', polymer: 'pla', name: 'Acme Eco PLA Filament - Red', sourceTitle: 'Acme Eco PLA Filament - Red', spoolMaterial: '' }));
assert.equal(t.level, 'ready', 'spool comes from the matching baseline model: ' + JSON.stringify(t));
state.data.desk = { filamentGroups: { 'creality||tpu|': { spoolMaterial: 'plastic', spoolLinked: true } } };
t = trustOf(ev({ spoolMaterial: '' }));
assert.equal(t.level, 'ready', 'spool comes from the linked spool group: ' + JSON.stringify(t));
state.data.desk = {};
t = trustOf(ev({ spoolMaterial: '' }));
assert.deepEqual(Array.from(t.why), ['spool unknown'], 'nothing supplies a spool: still unknown');
state.uncertainEdit.set('https://shop.example/x', { spoolMaterial: 'cardboard' });
assert.equal(trustOf(ev({ spoolMaterial: '' })).level, 'ready', 'a spool you set counts at once');
state.uncertainEdit.delete('https://shop.example/x');
assert.equal(trustOf(ev({}, { error: 'out_of_stock' })).why[0], 'held: out of stock');
assert.equal(trustOf(ev({}, { published: true })).level, 'done');

console.log('PASS: Goes to keeps matching models that carry a line in their name (and still tells lines apart), and each card gets a Ready / Check verdict with the exact reasons.');
