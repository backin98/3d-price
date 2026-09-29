const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const lists = {};
const context = { URL, console, window: {}, document: { addEventListener() {}, getElementById: (id) => (lists[id] = lists[id] || { innerHTML: '' }) } };
const source = fs.readFileSync('public/admin/admin.js', 'utf8').replace('  init();', 'globalThis.test = { state, fillFilamentSuggestions, titleGuess, uncertainCard, colourFromPixels, colourNameOf, collectCards, nearestColour, listingName, weightLabel, weightOf, coloursIn, cardColour, colourFill, spoolGroupKey, findUncertainDupes, nearestColourT: nearestColour, basicColour, autoTone };');
vm.runInNewContext(source, context);
const { state, fillFilamentSuggestions, titleGuess, uncertainCard, colourFromPixels, colourNameOf, collectCards, nearestColour, listingName, weightLabel, weightOf, coloursIn, cardColour, colourFill, spoolGroupKey, findUncertainDupes, nearestColourT, basicColour, autoTone } = context.test;
state.data = { baseline: { items: [
  { category: 'filaments', brand: 'RhinoLab', subBrand: 'Premium', polymer: 'pla+', variant: 'hyper speed' },
  { category: 'filaments', brand: 'RhinoLab', subBrand: '', polymer: 'tpu', variant: '95a, hyper speed' },
  { category: 'filaments', brand: 'Filamix', subBrand: 'Rapid', polymer: 'pla+', variant: 'matte' },
  { category: 'printers', brand: 'Creality', subBrand: 'Ender' }
] } };
const card = (vals) => ({ querySelector: (sel) => { const k = sel.match(/field="(\w+)"/)[1]; return k in vals ? { value: vals[k] } : null; } });
const opts = (id) => [...lists[id].innerHTML.matchAll(/value="([^"]*)"/g)].map((m) => m[1]);

fillFilamentSuggestions('dl-brand', card({ brand: 'x', polymer: '' }));
assert.deepEqual(opts('dl-brand'), ['Filamix', 'RhinoLab'], 'brands from filament baseline only, not scoped');
fillFilamentSuggestions('dl-subBrand', card({ brand: 'rhinolab', polymer: '' }));
assert.deepEqual(opts('dl-subBrand'), ['Premium'], 'sub-brands scoped to brand');
fillFilamentSuggestions('dl-variant', card({ brand: 'RhinoLab', subBrand: '', polymer: 'TPU' }));
assert.deepEqual(opts('dl-variant'), ['95a', 'hyper speed'], 'variants scoped to brand + polymer, tags split');
fillFilamentSuggestions('dl-variant', card({ brand: 'Filamix', subBrand: 'Rapid', polymer: 'pla+' }));
assert.deepEqual(opts('dl-variant'), ['matte'], 'variants scoped to sub-brand');
fillFilamentSuggestions('dl-variant', card({ brand: 'NewBrand', polymer: 'petg' }));
assert.deepEqual(opts('dl-variant'), ['95a', 'hyper speed', 'matte'], 'nothing in scope falls back to every baseline value');
fillFilamentSuggestions('dl-subBrand', card({ brand: 'Creality' }));
assert.deepEqual(opts('dl-subBrand'), ['Ender'], 'printer cards get the same sub-brand menu from printer rows');
state.data.jobs = [{ id: 'job', url: 'https://shop.example/', cards: { u: { url: 'u', name: 'Creality CR Hyper PLA', kind: 'filament', brand: 'Creality', subBrand: 'CR', polymer: 'pla', handEdited: true, decision: { action: 'held' } } } }];
state.data.catalog = { products: [], filaments: [] };
fillFilamentSuggestions('dl-subBrand', card({ brand: 'Creality', polymer: '' }));
assert.deepEqual(opts('dl-subBrand'), ['CR'], 'an Uncertain card saved with Save feeds the menus');
console.log('PASS: filament suggestions come from the baseline, scoped by brand, sub-brand and polymer; printers share the sub-brand menu.');

// Title help: a saved card's fields reach its colour siblings (not colour); per-word guesses fill blanks only.
state.data = { baseline: { items: [
  { id: 'r1', category: 'filaments', name: 'RhinoLab PLA+', brand: 'RhinoLab', polymer: 'pla+', variant: '' },
  { id: 'f1', category: 'filaments', name: 'Filamix Rapid PLA+', brand: 'Filamix', subBrand: 'Rapid', polymer: 'pla+', variant: '' }
] }, catalog: { products: [], filaments: [] }, jobs: [{ id: 'job', url: 'https://shop.example/', cards: {
  a: { url: 'a', name: 'RhinoLab PLA+ Premium Hyper Speed Filament Siyah', kind: 'filament', brand: 'RhinoLab', subBrand: 'Premium', polymer: 'pla+', variant: 'hyper speed', color: 'black', spoolMaterial: 'cardboard', handEdited: true, decision: { action: 'held' } },
  b: { url: 'b', name: 'RhinoLab PLA+ Premium Hyper Speed Filament Beyaz', kind: 'filament', brand: 'Rhino', color: 'white', decision: { action: 'held' } },
  c: { url: 'c', name: 'Filamix Rapid PLA+ Filament Matte', kind: 'filament', decision: { action: 'held' } }
} }] };
const b = titleGuess({ url: 'b', name: 'RhinoLab PLA+ Premium Hyper Speed Filament Beyaz' });
assert.equal(b.from, 'RhinoLab · Premium · pla+ · hyper speed', 'most specific confirmed model wins over the plain baseline row');
assert.equal(b.subBrand, 'Premium'); assert.equal(b.variant, 'hyper speed'); assert.equal(b.spoolMaterial, 'cardboard');
const html = uncertainCard({ card: state.data.jobs[0].cards.b, jobId: 'job', decision: { action: 'held' } });
assert.match(html, /data-uncertain-field="brand"[^>]*value="RhinoLab"/, 'confirmed model overrides the harvested brand');
assert.match(html, /data-uncertain-field="color"[^>]*value="white"/, 'colour is never copied');
assert.match(html, /<option value="cardboard" selected>/, 'spool material comes across');
assert.ok(html.includes('Matches RhinoLab · Premium · pla+ · hyper speed.'), 'card says which model it matched');
assert.equal(titleGuess({ url: 'c', name: 'Filamix Rapid PLA+ Filament Matte' }).subBrand, 'Rapid', 'baseline model matches from the title');
const none = titleGuess({ url: 'z', name: 'Elegoo PETG Rapid Filament' });
assert.equal(none.from, ''); assert.equal(none.brand, ''); assert.equal(none.polymer, '', 'unknown words guess nothing');
console.log('PASS: titles pre-fill filament fields from confirmed models; colour stays per card.');

// Baseline rows speak in codes (pla, plus-high-speed); the scraper turned the title into the same codes.
// A shop-stamped brand that is not in the title gets replaced. A published saved card still counts.
state.data = { baseline: { items: [
  { id: 'r2', category: 'filaments', name: 'RhinoLab PLA+ HS Black', brand: 'RhinoLab', polymer: 'pla', variant: 'plus-high-speed' },
  { id: 'r3', category: 'filaments', name: 'Polymaker PolyTerra PLA', brand: 'Polymaker', polymer: 'pla', variant: '' }
] }, catalog: { products: [], filaments: [] }, jobs: [{ id: 'old', url: 'https://shop.example/', published: ['p'], cards: {
  p: { url: 'p', name: 'Polymaker PolyTerra PLA Filament Grey', brand: 'Polymaker', subBrand: 'PolyTerra', polymer: 'pla', handEdited: true }
} }] };
const coded = titleGuess({ url: 'x', name: 'RhinoLab PLA+ Premium Hyper Speed Filament', brand: 'Bambu Lab', polymer: 'pla', variant: 'plus-high-speed' });
assert.equal(coded.from, 'RhinoLab · pla · plus-high-speed', 'code match against baseline rows');
assert.equal(coded.brand, 'RhinoLab', 'shop-stamped brand is replaced by the title brand');
assert.equal(titleGuess({ url: 'y', name: 'Polymaker PolyTerra PLA Filament Blue', polymer: 'pla' }).subBrand, 'PolyTerra', 'a saved card from an older, published run still helps');
const words = titleGuess({ url: 'z', name: 'Polymaker Something Filament', brand: 'Bambu Lab', polymer: 'x' });
assert.equal(words.brandWrong, true, 'fallback flags the wrong harvested brand');

// Colour from pixels: red spool on white background; black spool on white background.
state.data.filamentColours = { red: { name: 'Red', hex: '#E53935' }, black: { name: 'Black', hex: '#000000' }, white: { name: 'White', hex: '#FFFFFF' } };
const px = (n, rgb) => Array.from({ length: n }, () => [...rgb, 255]).flat();
const red = colourFromPixels([...px(60, [255, 255, 255]), ...px(40, [220, 40, 40])], state.data.filamentColours);
assert.equal(red.color, 'red'); assert.equal(red.hex, '#dc2828', 'dot shows the averaged pixel colour');
assert.equal(colourFromPixels([...px(60, [255, 255, 255]), ...px(40, [20, 20, 20])], state.data.filamentColours).color, 'black', 'dark spools still read');
assert.equal(colourFromPixels(px(100, [255, 255, 255]), state.data.filamentColours), null, 'plain background finds nothing');

const rfidCard = { url: 'rf', name: 'Creality Hyper PLA RFID Filament', kind: 'filament', brand: 'Creality', polymer: 'pla', decision: { action: 'held' } };
assert.match(uncertainCard({ card: rfidCard, jobId: 'old', decision: { action: 'held' } }), /data-uncertain-field="rfid"[^>]*aria-pressed="true"/, 'RFID in the title turns the button on');
assert.match(uncertainCard({ card: { ...rfidCard, url: 'rf2', name: 'Creality Hyper PLA Filament' }, jobId: 'old', decision: { action: 'held' } }), /data-uncertain-field="rfid"[^>]*aria-pressed="false"/, 'otherwise it stays off');

const { normalizeFilamentListing } = require('../lib/qwen-website-job.cjs');
assert.equal(normalizeFilamentListing({ kind: 'filament', name: 'Filamix Rapid PLA+ Filament', brand: 'Bambu Lab' }).brand, 'Filamix', 'new runs take the brand from the title');
assert.equal(normalizeFilamentListing({ kind: 'filament', name: 'Bambu Lab PLA Basic', brand: 'Bambu Lab' }).brand, 'Bambu Lab');
// Colour names as the listing wrote them: stored by new runs, recovered from older titles.
const dr = normalizeFilamentListing({ kind: 'filament', name: 'Bambu Lab PLA Matte Filament - Dark Red', brand: 'Bambu Lab' });
assert.equal(dr.name, 'Bambu Lab PLA Matte Filament', 'the whole colour tail leaves the grouping title');
assert.equal(dr.color, 'red'); assert.equal(dr.colorName, 'Dark Red');
assert.equal(normalizeFilamentListing({ kind: 'filament', name: 'eSUN PLA+ Siyah 1KG' }).colorName, 'Siyah');
state.data.filamentColours = require('../lib/filament-colours.cjs');
const old = collectCards({ id: 'j', events: [
  { card: { url: 'u1', name: 'Bambu Lab PLA Matte Filament - Dark Red', color: 'red' } },
  { card: { url: 'u1', name: 'Bambu Lab PLA Matte Filament - Dark', color: 'red', kind: 'filament' } }
] }, state.data).find((ev) => ev.card.url === 'u1').card;
assert.equal(colourNameOf(old), 'Dark Red', 'older cards get the listing colour back from an earlier title');
assert.equal(colourNameOf({ name: 'eSUN PLA+ 1KG', listingTitles: ['eSUN PLA+ Siyah 1KG'], color: 'black' }), 'Siyah');
assert.equal(colourNameOf({ name: 'Acme PLA', color: 'black' }), 'Black', 'no title colour: the readable name');
const shown = uncertainCard({ card: { ...old, decision: { action: 'held' } }, jobId: 'j', decision: { action: 'held' } });
assert.match(shown, /data-uncertain-field="color"[^>]*value="Dark Red"/);
assert.match(shown, /colour-dot" style="--dot:#D32F2F"/, 'the dot keeps the colour');

assert.equal(listingName(old), 'Bambu Lab PLA Matte Filament', 'a half-cut colour tail is cleaned from the product line');
assert.equal(listingName({ name: 'Acme PLA' }), 'Acme PLA');
assert.match(shown, /data-uncertain-field="name"[^>]*>Bambu Lab PLA Matte Filament</);
assert.equal(nearestColour('#d43030').id, 'red', 'eyedropper pick maps to the nearest named colour');

// Weight: kg and g listings, Turkish thousands separators, part numbers rejected; shown as g under 1 kg, kg from 1 kg.
const { gramsFromText } = require('../api/filament-classify.js');
for (const [text, g] of [['eSUN PLA+ 1KG', 1000], ['1,5 kg', 1500], ['250gr', 250], ['0.25 kg', 250], ['1.000 gr', 1000], ['1 Kilogram', 1000], ['750 gram', 750], ['TPU 95A 500G', 500], ['PC White 2 g', 0], ['1.75mm', 0]]) assert.equal(gramsFromText(text), g, text);
assert.equal(weightLabel('1000 g'), '1 kg'); assert.equal(weightLabel('1500 g'), '1.5 kg'); assert.equal(weightLabel('250 g'), '250 g'); assert.equal(weightLabel('0.25 kg'), '250 g'); assert.equal(weightLabel('3000 g'), '3 kg');
assert.equal(weightOf({ name: 'Acme PLA', url: 'https://x/acme-pla-1kg-black' }), '1000 g', 'URL slug fallback');
const { pageWeight } = require('../lib/qwen-website-job.cjs');
assert.equal(pageWeight('<title>Bambu Lab PLA Basic Silver Filament 1.75mm 1Kg | RFID</title>'), '1000 g', 'weight from the page title');
assert.equal(pageWeight('<meta content="Acme PETG 750 gr makara" name="description">'), '750 g', 'weight from the meta description');
assert.match(uncertainCard({ card: { url: 'w1', name: 'Acme PLA', kind: 'filament', weight: '1000 g', decision: { action: 'held' } }, jobId: 'j', decision: { action: 'held' } }), /data-uncertain-field="weight"[^>]*value="1 kg"/);
assert.match(uncertainCard({ card: { url: 'w2', name: 'Acme PLA', kind: 'filament', weight: '250 g', decision: { action: 'held' } }, jobId: 'j', decision: { action: 'held' } }), /data-uncertain-field="weight"[^>]*value="250 g"/);

// A re-run is a new run: a card saved in an earlier run keeps your fields, the new run keeps price and image.
state.data.jobs = [
  { id: 'new', url: 'https://shop.example/', events: [{ type: 'extract', card: { url: 'same', name: 'Acme PLA Filament', brand: 'Wrong', kind: 'filament', price: 99, image: 'new.jpg', colorName: 'Silver', sourceTitle: 'Acme PLA Filament - Silver' }, decision: { action: 'held' } }] },
  { id: 'old', url: 'https://shop.example/', published: ['same'], cards: { same: { url: 'same', name: 'Acme PLA Filament', brand: 'Acme', subBrand: 'Pro', polymer: 'pla', kind: 'filament', rfid: true, weight: '750 g', handEdited: true } } }
];
const rerun = collectCards(state.data.jobs[0], state.data).find((e) => e.card.url === 'same');
const rerunHtml = uncertainCard({ ...rerun, jobId: 'new' });
assert.match(rerunHtml, /data-uncertain-field="brand"[^>]*value="Acme"/, 'earlier save wins over the new run');
assert.match(rerunHtml, /data-uncertain-field="subBrand"[^>]*value="Pro"/);
assert.match(rerunHtml, /data-uncertain-field="weight"[^>]*value="750 g"/);
assert.match(rerunHtml, /data-uncertain-field="rfid"[^>]*aria-pressed="true"/);
assert.match(rerunHtml, /Shop price: 99 TL/, 'the new run keeps its price');
assert.match(rerunHtml, /data-uncertain-field="color"[^>]*value="Silver"/, 'colour name from the new run arrives');

assert.equal(normalizeFilamentListing({ kind: 'filament', name: 'RhinoLab PC-CF Filament - Black 1Kg' }).colorName, 'Black', 'weight in the colour tail is not part of the colour');
assert.equal(colourNameOf({ name: 'RhinoLab PC-CF Filament', listingTitles: ['RhinoLab PC-CF Filament - Black 1Kg'], color: 'black' }), 'Black');

assert.equal(normalizeFilamentListing({ kind: 'filament', name: 'Acme PLA - Glass Blue 1Kg' }).colorName, 'Glass Blue', 'letters survive the cleanup');
assert.equal(colourNameOf({ name: 'Acme PLA', colorName: 'Glass Blue 1Kg', color: 'blue' }), 'Glass Blue');

// Dual / tri colour and rainbow: listing name kept, colour set recorded, split or rainbow dot.
const tri = normalizeFilamentListing({ kind: 'filament', name: 'RhinoLab Silk PLA Mystic 3 Renkli Filament - Rose Dark Blue Green' });
assert.equal(tri.colorName, 'Rose Dark Blue Green'); assert.deepEqual(tri.colorSet, ['dark-blue', 'green', 'rose']); assert.equal(tri.color, 'dark-blue+green+rose'); assert.equal(tri.multicolor, true);
const volcano = normalizeFilamentListing({ kind: 'filament', name: 'Apex3D Rainbow PLA Filament - Volcanic Eruption' });
assert.equal(volcano.colorName, 'Volcanic Eruption', 'a made-up rainbow name is still the colour name'); assert.equal(volcano.color, 'volcanic-eruption');
assert.deepEqual([...coloursIn('Black Purple')].sort(), ['black', 'purple']);
assert.equal(colourFill(cardColour({}, {}, 'Black Purple')).length, 2, 'dual colour dot has two colours');
assert.equal(colourFill(cardColour({ multicolor: true }, {}, 'Volcanic Eruption')), 'rainbow');
assert.equal(cardColour({ name: 'Bambu Lab PLA Marble Filament' }, {}, 'Red Granite').fx, 'marble', 'marble from the title');
assert.equal(cardColour({ sourceTitle: 'Acme Galaxy PLA - Black' }, {}, 'Black').fx, 'galaxy', 'galaxy from the title');
assert.equal(cardColour({ name: 'Acme PLA' }, { colorEffect: 'galaxy' }, 'Black').fx, 'galaxy', 'your choice wins');
assert.equal(JSON.stringify(cardColour({}, { colorSet: ['black'] }, 'Black Purple').set), '["black"]', 'minus: a trimmed set sticks');
assert.equal(JSON.stringify(cardColour({}, {}, 'Rose Dark Blue Green').set), '["rose","dark-blue","green"]', 'colours are numbered in name order');
assert.equal(normalizeFilamentListing({ kind: 'filament', name: 'Acme Marble PLA - Stone' }).colorEffect, 'marble');
const dualHtml = uncertainCard({ card: { url: 'd1', name: 'RhinoLab PLA Silk Dual Renk Filament', colorName: 'Black Purple', kind: 'filament', decision: { action: 'held' } }, jobId: 'j', decision: { action: 'held' } });
assert.match(dualHtml, /--dot:conic-gradient\(/, 'dual colour card gets a split dot');
assert.ok(dualHtml.includes('#000000') && dualHtml.includes('#7B1FA2'), 'with both colours');

// Weight: 1 kg when nothing says otherwise, shown as assumed; a stated weight is never marked assumed.
assert.equal(normalizeFilamentListing({ kind: 'filament', name: 'Acme PLA Filament' }).weight, '1000 g');
assert.equal(normalizeFilamentListing({ kind: 'filament', name: 'Acme PLA Filament' }).weightAssumed, true);
assert.equal(normalizeFilamentListing({ kind: 'filament', name: 'Acme PLA 250g' }).weightAssumed, false);
assert.equal(pageWeight('<div><span>Ağırlık</span>: <b>1 kg</b></div>'), '1000 g', 'labelled spec line');
assert.equal(pageWeight('<p>We printed a 30 g test part</p>'), '', 'a stray mention in a description is not the weight');
const noWeight = uncertainCard({ card: { url: 'nw', name: 'Acme PLA', kind: 'filament', decision: { action: 'held' } }, jobId: 'j', decision: { action: 'held' } });
assert.match(noWeight, /data-uncertain-field="weight"[^>]*value="1 kg"/); assert.match(noWeight, /Assumed: the listing gives no weight/);

// Spool chain: a linked group shows the group's spool type; a broken link lets each card keep its own.
const key = spoolGroupKey('RhinoLab', '', 'pla', 'silk');
state.data.desk = { filamentGroups: { [key]: { spoolMaterial: 'plastic' } } };
const silk = { url: 's1', name: 'RhinoLab PLA Silk Filament', brand: 'RhinoLab', polymer: 'pla', variant: 'silk', kind: 'filament', spoolMaterial: 'cardboard', handEdited: true, decision: { action: 'held' } };
assert.match(uncertainCard({ card: silk, jobId: 'j', decision: { action: 'held' } }), /<option value="plastic" selected>/, 'linked: the group decides');
state.data.desk.filamentGroups[key].spoolLinked = false;
const own = uncertainCard({ card: silk, jobId: 'j', decision: { action: 'held' } });
assert.match(own, /<option value="cardboard" selected>/, 'broken: the card keeps its own');
assert.match(own, /data-spool-chain aria-pressed="false"/);

// Find duplicates: same listing, same shop, across runs or title forms. Other colours, weights and shops stay apart.
const dcard = (url, name, extra = {}) => ({ type: 'extract', card: { url, name, brand: 'RhinoLab', kind: 'filament', price: 900, ...extra }, decision: { action: 'held' } });
state.uncertainHeld.clear(); state.uncertainPublished.clear(); state.uncertainShop = '';
state.data = { desk: {}, baseline: { items: [] }, catalog: { products: [], filaments: [] }, filamentColours: require('../lib/filament-colours.cjs'), jobs: [
  { id: 'r1', url: 'https://www.rhino3dprinter.com/', events: [dcard('https://www.rhino3dprinter.com/rhinolab-pla-black', 'RhinoLab PLA Filament - Black'), dcard('https://www.rhino3dprinter.com/rhinolab-pla-white', 'RhinoLab PLA Filament - White')] },
  { id: 'r2', url: 'https://www.rhino3dprinter.com/', events: [dcard('https://www.rhino3dprinter.com/filament/rhinolab-pla-black', 'RhinoLab PLA Filament', { colorName: 'Black', color: 'black' }), dcard('https://www.rhino3dprinter.com/rhinolab-pla-black-250g', 'RhinoLab PLA Filament - Black', { weight: '250 g' })] },
  { id: 'r3', url: 'https://www.rhino3dprinter.com/', events: [dcard('https://www.rhino3dprinter.com/filamix-pla-matte-mint-green', 'Filamix PLA Matte - Green'), dcard('https://www.rhino3dprinter.com/filamix-pla-matte-green', 'Filamix PLA Matte - Green')] },
  { id: 'o', url: 'https://other.example/', events: [dcard('https://other.example/rhinolab-pla-black', 'RhinoLab PLA Filament - Black')] }] };
const dupes = findUncertainDupes(state.data);
assert.equal(dupes.length, 1, 'one group: ' + JSON.stringify(dupes));
assert.equal(JSON.stringify([...dupes[0]].sort()), JSON.stringify(['https://www.rhino3dprinter.com/filament/rhinolab-pla-black', 'https://www.rhino3dprinter.com/rhinolab-pla-black']), 'same black 1 kg across runs; not 250 g, white, mint green or another shop');

// Rainbow colourway named inside the title; a photo guess (cardboard → light brown) never names a multicolour spool.
const lake = normalizeFilamentListing({ kind: 'filament', name: 'Creality Hyper PLA Rainbow Spring Lake Filament 1.75mm 1Kg' });
assert.equal(lake.colorName, 'Spring Lake'); assert.equal(lake.color, 'spring-lake'); assert.equal(lake.multicolor, true);
const lakeCard = { url: 'lake', name: 'Creality Hyper PLA Rainbow Spring Lake Filament 1.75mm 1Kg', color: 'light-brown', kind: 'filament' };
assert.equal(colourNameOf(lakeCard), 'Spring Lake', 'stored cards show the colourway, not the photo guess');
assert.equal(colourFill(cardColour(lakeCard, {}, 'Spring Lake')), 'rainbow', 'and a rainbow dot, not light brown');
(async () => {
  let asked = 0;
  await require('../lib/qwen-website-job.cjs').fillMissingFilamentColours([{ kind: 'filament', color: '', image: 'https://x/y.jpg', multicolor: true }], null, async () => { asked++; return { color: 'light-brown', confidence: 1 }; });
  assert.equal(asked, 0, 'no photo colour guess for a multicolour spool');
})();

// Look-alike colour by eye (ΔE 2000), not raw RGB: a deep purple is purple, a grey stays grey,
// and see-through "transparent" colours are never a look-alike.
state.data.filamentColours = require('../lib/filament-colours.cjs');
assert.equal(nearestColourT('#48395b').id, 'dark-purple', 'Indigo Purple pick is not dark grey');
assert.equal(nearestColourT('#7d5ba6').id, 'purple');
assert.equal(nearestColourT('#5a5a5e').id, 'dark-gray', 'real greys stay grey');
assert.equal(nearestColourT('#dba351').id, 'gold', 'not transparent orange');

// Internal colour = a plain everyday name, whatever the maker calls it; set automatically from the card's colours.
for (const [hex, plain] of [['#c8bb8e', 'beige'], ['#48395b', 'purple'], ['#7f6d5c', 'brown'], ['#79756d', 'gray'], ['#eadfd8', 'beige'], ['#f88094', 'pink'], ['#1f3a93', 'blue'], ['#000000', 'black'], ['#ffffff', 'white']]) assert.equal(basicColour(hex), plain, hex);
assert.equal(autoTone({ set: ['a', 'b', 'c'], hexes: ['#d1efe3', '#68abb1', '#5794a9'] }), 'white+cyan+blue', 'every colour of a multicolour spool, in order');
assert.equal(autoTone(cardColour({}, {}, 'Sky Blue Purple Yellow')), 'blue+purple+yellow', 'no picks needed');
assert.match(uncertainCard({ card: { url: 'dt', name: 'Bambu Lab PLA Matte Filament', colorName: 'Desert Tan', colorHex: '#c8bb8e', kind: 'filament', decision: { action: 'held' } }, jobId: 'j', decision: { action: 'held' } }), /value="Desert Tan"[\s\S]*Looks Beige \(for search\)/i, 'shows the maker name, searches by the plain one');

console.log('PASS: code matches, brand repair, cross-run saves, colour from pixels, scraper brand from title.');
