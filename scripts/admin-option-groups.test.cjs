// A product sold in several options (the colours of one filament) is one card on Shop runs and
// Uncertain: a dot per option showing that option's own picture, the option's fields under it.
// Every option stays its own listing (own URL, price, Goes to, Select). Two shop shapes:
//   Filament Marketim: options read from one product page (variantOf = that page),
//   Rhino: each colour is its own listing in the category (same shop, model, brand, weight).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin', 'admin.js'), 'utf8')
  .replace('  init();', 'globalThis.test = { state, optionGroupsHtml, optionGroupKey, uncertainCard, collectCards };');
const context = { URL, console, window: {}, document: { addEventListener() {}, getElementById: () => null } };
vm.runInNewContext(source, context);
const { state, optionGroupsHtml, optionGroupKey, uncertainCard } = context.test;
state.data = { jobs: [], catalog: { products: [], filaments: [] }, baseline: { items: [] }, filamentColours: require('../lib/filament-colours.cjs') };

const FM = 'https://www.filamentmarketim.com';
const RH = 'https://www.rhino3dprinter.com';
const ev = (card, extra) => ({ card: { kind: 'filament', polymer: 'pla', weight: '1000 g', diameter: '1.75 mm', ...card }, decision: { action: 'held' }, jobId: 'job', ...extra });
const marketim = ['Siyah', 'Beyaz', 'Lacivert'].map((colour, i) => ev({
  url: FM + '/elas-pla-pro-filament?variant=' + colour.toLowerCase(), name: 'Elas PLA Pro Filament', sourceTitle: 'Elas PLA Pro Filament - ' + colour, colorName: colour,
  brand: 'Elas', price: 449.9 + i * 10, image: FM + '/img/main.jpg', optionThumb: FM + '/img/opt-' + colour.toLowerCase() + '.png', variantOf: FM + '/elas-pla-pro-filament'
}));
const rhino = ['Black', 'Beige', 'Red'].map((colour) => ev({
  url: RH + '/bambu-lab-pla-basic-filament-' + colour.toLowerCase(), name: 'Bambu Lab PLA Basic Filament', sourceTitle: 'Bambu Lab PLA Basic Filament - ' + colour, colorName: colour,
  brand: 'Bambu Lab', price: 944.69, image: RH + '/img/basic-' + colour.toLowerCase() + '.webp'
}));
const otherModel = ev({ url: RH + '/bambu-lab-pla-matte-filament-black', name: 'Bambu Lab PLA Matte Filament', sourceTitle: 'Bambu Lab PLA Matte Filament - Black', colorName: 'Black', brand: 'Bambu Lab', price: 944.69, image: RH + '/img/matte.webp' });
const printer = { card: { url: RH + '/bambu-lab-a1', name: 'Bambu Lab A1', kind: 'printer', brand: 'Bambu Lab', price: 20000 }, decision: { action: 'create' } };
const held = ev({ url: RH + '/qidi-box', name: 'Qidi Box Renk Modülü', brand: 'Qidi', price: 9000 }, { mismatch: { detectedType: 'accessory', declaredType: 'filament' } });
const pack = ev({ url: RH + '/bambu-lab-pla-basic-filament-4lu', name: 'Bambu Lab PLA Basic Filament', sourceTitle: "Bambu Lab PLA Basic Filament 4'lü Set", brand: 'Bambu Lab', price: 3400, packCount: 4, bundle: true, image: RH + '/img/pack.webp' });

// Keys: one product per group, nothing else pulled in.
const keyOf = (e) => optionGroupKey(e);
assert.equal(new Set(marketim.map(keyOf)).size, 1, 'Filament Marketim colours of one page are one product');
assert.equal(new Set(rhino.map(keyOf)).size, 1, 'Rhino colours of one model are one product');
assert.notEqual(keyOf(otherModel), keyOf(rhino[0]), 'another model is another card');
assert.notEqual(keyOf(pack), keyOf(rhino[0]), 'a 4-pack is not an option of the single spool');
assert.equal(keyOf(printer), '', 'printers are not grouped');
assert.equal(keyOf(held), '', 'a held-out module is not grouped');

const html = optionGroupsHtml([...marketim, printer, ...rhino, otherModel, held, pack], (e) => uncertainCard(e, false, { isSel: false, isFlag: false, where: '', mismatchActions: '' }));
const groups = html.split('class="option-group"').length - 1;
assert.equal(groups, 2, 'two products with options, two option cards');
const cardsInPage = (html.match(/class="product-card baseline-card uncertain-card/g) || []).length;
assert.equal(cardsInPage, 3 + 1 + 3 + 1 + 1 + 1, 'every option is still its own card (own Select, fields, Goes to)');
// The Marketim group: three dots, each with that colour's own picture; the first option shown.
const fm = html.slice(html.indexOf('class="option-group"'), html.indexOf('class="option-group"', html.indexOf('class="option-group"') + 10));
assert.deepEqual([...fm.matchAll(/data-opt-dot="(\d)"[^>]*>\s*<img src="([^"]+)"/g)].map((m) => [m[1], m[2].replace(FM, '')]), [['0', '/img/opt-siyah.png'], ['1', '/img/opt-beyaz.png'], ['2', '/img/opt-lacivert.png']], 'each dot shows its own option\'s picture');
assert.match(fm, /3 options · 449\.9–469\.9 TL/);
assert.equal((fm.match(/opt-member opt-hidden/g) || []).length, 2, 'one option shown, the others a click away');
// Rhino's dots fall back to each listing's own photo.
const rh = html.slice(html.indexOf('class="option-group"', html.indexOf('class="option-group"') + 10));
assert.deepEqual([...rh.matchAll(/data-opt-dot="\d"[^>]*>\s*<img src="([^"]+)"/g)].map((m) => m[1].replace(RH, '')), ['/img/basic-black.webp', '/img/basic-beige.webp', '/img/basic-red.webp']);
// The order on the board stays the shop's: a group sits where its first option was.
assert.ok(html.indexOf('opt-siyah') < html.indexOf('bambu-lab-a1') && html.indexOf('bambu-lab-a1') < html.indexOf('basic-black'));

// One product photo on every option (Filament Marketim's buttons): the dots show the colours, not that
// photo repeated.
const shared = ['Siyah', 'Beyaz', 'Kırmızı'].map((colour) => ev({
  url: FM + '/porima-pla-filament?variant=' + colour, name: 'Porima PLA Filament - 1Kg', sourceTitle: 'Porima PLA Filament - 1Kg - ' + colour, colorName: colour,
  color: { Siyah: 'black', Beyaz: 'white', 'Kırmızı': 'red' }[colour], brand: 'Porima', price: 771.37, image: FM + '/img/porima-main.jpg', variantOf: FM + '/porima-pla-filament'
}));
const sharedHtml = optionGroupsHtml(shared, (e) => uncertainCard(e, false, { isSel: false, isFlag: false, where: '', mismatchActions: '' }));
const dots = [...sharedHtml.matchAll(/<button type="button" class="opt-dot[^"]*"[^>]*>([\s\S]*?)<\/button>/g)].map((m) => m[1]);
assert.equal(dots.length, 3);
assert.ok(dots.every((d) => !/<img/.test(d) && /opt-dot-fill/.test(d)), 'shared photo: colour dots, not three copies of one photo');
assert.deepEqual(dots.map((d) => (d.match(/(?:background|--dot):([^";]+)/) || [])[1]), ['#111111', '#F5F5F5', '#E53935'].map((h) => require('../lib/filament-colours.cjs')[{ '#111111': 'black', '#F5F5F5': 'white', '#E53935': 'red' }[h]].hex), 'each dot its own colour');

console.log('PASS: colours of one product are one card with a dot per option (each with its own picture), for one-page shops and one-listing-per-colour shops alike; printers, modules, packs and other models stay their own cards.');
