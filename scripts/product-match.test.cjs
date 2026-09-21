const assert = require('node:assert/strict');
const { score, similar, decidePair, taxonomy, identity, normalizePrinterTitle, conflicts } = require('../lib/product-match.cjs');

assert.equal(similar('corolla', 'crolla'), true);
assert.ok(score('Toyota Corolla Hatchback Car', 'Toyota Crolla Hatchback Vehicle') >= 0.9);
assert.equal(decidePair(
  { name: 'Toyota Corolla Hatchback Car', brand: 'Toyota', kind: 'printer' },
  { id: 'a', name: 'Toyota Crolla Hatchback Vehicle', brand: 'Toyota', kind: 'printer' }
).action, 'merge');
assert.equal(decidePair(
  { name: 'Bambu Lab A1', brand: 'Bambu Lab', kind: 'printer' },
  { id: 'b', name: 'Bambu Lab A1 Combo', brand: 'Bambu Lab', kind: 'printer' }
).action, 'create');
assert.equal(decidePair(
  { name: 'Anycubic PLA 1kg Kırmızı', brand: 'Anycubic', kind: 'filament', polymer: 'pla', color: 'Kırmızı', weight: '1 kg' },
  { id: 'c', name: 'Anycubic PLA 1kg Mavi', brand: 'Anycubic', kind: 'filament', polymer: 'pla', color: 'Mavi', weight: '1 kg' }
).action, 'create');
assert.equal(decidePair(
  { name: 'Elegoo PLA Siyah 1kg', brand: 'Elegoo', kind: 'filament', polymer: 'pla', color: 'Siyah', weight: '1 kg' },
  { id: 'd', name: 'Elegoo PLA Black 1 kg', brand: 'Elegoo', kind: 'filament', polymer: 'pla', color: 'Black', weight: '1kg' }
).action, 'merge');
const tax = taxonomy({ name: 'Elegoo PLA+ Silk Gold 1kg 1.75mm', brand: 'Elegoo', kind: 'filament' });
assert.equal(tax.category, 'pla');
assert.equal(tax.subcategory, 'silk');
assert.equal(decidePair(
  { name: 'Elegoo PLA Black 1kg', brand: 'Elegoo', kind: 'filament', packaging: 'unspecified' },
  { id: 'e', name: 'Elegoo PLA Black 1kg', brand: 'Shop Brand', kind: 'printer', packaging: 'spool', color: 'Deep Black' }
).action, 'create');
assert.equal(decidePair(
  { name: 'Elegoo PLA İpek Siyah 1000gr Makarasız', brand: 'Elegoo', kind: 'filament', polymer: 'pla', variant: 'silk', color: 'Siyah', weight: '1 kg' },
  { id: 'f', name: 'Elegoo PLA Silk Black 1kg Spoolless', brand: 'Elegoo', kind: 'filament', polymer: 'pla', variant: 'silk', color: 'Black', weight: '1000 gr' }
).action, 'merge');
assert.equal(decidePair(
  { name: 'Elegoo PLA Silk Black 1kg Spool', brand: 'Elegoo', kind: 'filament', polymer: 'pla', variant: 'silk', color: 'Black', weight: '1 kg' },
  { id: 'g', name: 'Elegoo PLA İpek Siyah 1kg Makarasız', brand: 'Elegoo', kind: 'filament', polymer: 'pla', variant: 'silk', color: 'Siyah', weight: '1 kg' }
).action, 'create');
assert.equal(score('Elegoo PLA Black 1kg', 'Elegoo PLA Black 1kg'), 1);
assert.equal(decidePair(
  { name: 'Elegoo PLA Black 1kg', brand: 'Elegoo', kind: 'filament' },
  { id: 'h', name: 'Elegoo PLA Black 1kg', brand: 'Elegoo', kind: 'filament', packaging: 'spool' }
).action, 'review');
assert.equal(decidePair(
  { name: 'Elegoo PLA Black 1kg', brand: 'Elegoo', kind: 'filament', color: 'Red' },
  { id: 'i', name: 'Elegoo PLA Black 1kg', brand: 'Elegoo', kind: 'filament', color: 'Blue' }
).action, 'create');
assert.equal(decidePair(
  { name: 'Elegoo PLA 1kg', brand: 'Elegoo', kind: 'filament', polymer: 'pla', weight: '1 kg' },
  { id: 'j', name: 'Elegoo PLA 3kg', brand: 'Elegoo', kind: 'filament', polymer: 'pla', weight: '3 kg' }
).action, 'create');
assert.equal(decidePair(
  { name: 'Elegoo PLA Black 1kg', brand: 'Elegoo', kind: 'filament', polymer: 'pla' },
  { id: 'k', name: 'Elegoo PLABS Black 1kg', brand: 'Elegoo', kind: 'filament', polymer: 'plabs' }
).action, 'create');
assert.equal(decidePair(
  { name: 'Bambu Lab A1 AMS 2', brand: 'Bambu Lab', kind: 'printer' },
  { id: 'l', name: 'Bambu Lab A1 AMS Lite', brand: 'Bambu Lab', kind: 'printer' }
).action, 'create');
assert.equal(identity({ name: 'Elegoo PLA Black 1kg', brand: 'Elegoo', kind: 'filament' }).packaging, '');
assert.notEqual(identity({ name: 'Elegoo PLA Black 1kg', brand: 'Elegoo', kind: 'filament' }).packaging, 'spool');
assert.notEqual(identity({ name: 'Elegoo PLA Black 1kg', brand: 'Elegoo', kind: 'filament' }).packaging, 'refill');
assert.equal(identity({ name: 'Elegoo PLA Black 1kg Makaralı', brand: 'Elegoo', kind: 'filament' }).packaging, 'spool');
assert.equal(identity({ name: 'Elegoo PLA Black 1kg Makarasız', brand: 'Elegoo', kind: 'filament' }).packaging, 'refill');
assert.equal(taxonomy({ name: 'Elegoo PLA Black 1kg', brand: 'Elegoo', kind: 'filament' }).packaging, '');
assert.equal(identity({ name: 'Elegoo PLA Black 1kg', brand: 'Elegoo', kind: 'filament' }).diameter, '');
assert.equal(score('Elegoo PLA+ Silk Gold 1kg', 'Elegoo PLA Plus Silk Gold 1kg'), 1);
assert.equal(decidePair(
  { name: 'Bambu Lab A1 Mini Combo', brand: 'Bambu Lab', kind: 'printer' },
  { id: 'm', name: 'Bambu Lab A1 Combo', brand: 'Bambu Lab', kind: 'printer' }
).action, 'create');
assert.equal(decidePair(
  { name: 'Bambu Lab A1 Combo 3D Yazıcı', brand: 'Bambu Lab', kind: 'printer' },
  { id: 'n', name: 'Bambu Lab A1 Combo 3D Printer', brand: 'Bambu Lab', kind: 'printer' }
).action, 'merge');
assert.match(normalizePrinterTitle('Bambu Lab A1 Combo 3D Yazıcı'), /a1/);
assert.match(normalizePrinterTitle('Bambu A1 AMS üniteli yazici'), /combo/);
assert.equal(decidePair(
  { name: 'Photon P1 Combo MSLA 3D Yazıcı', brand: 'Anycubic', kind: 'printer' },
  { id: 'o', name: 'Photon P1 Combo 3D Yazıcı', brand: 'Anycubic', kind: 'printer' }
).action, 'merge');
assert.equal(decidePair(
  { name: 'Bambu Lab A1 Mini Combo', brand: 'Bambu Lab', kind: 'printer' },
  { id: 'p', name: 'Bambu Lab A1 Combo', brand: 'Bambu Lab', kind: 'printer' }
).action, 'create');
// Same printer, two shops, two ways of naming the bundle: Metatech writes "Combo",
// Robolink states the bundled AMS. Both carry AMS 2 Pro, so this is one product.
assert.equal(decidePair(
  { name: 'Bambu Lab P1S AMS 2 Pro Combo 3D Printer with Buffer', brand: 'Bambu Lab', kind: 'printer' },
  { id: 'q', name: 'Bambu Lab P1S AMS 2 Pro 3D Yazıcı', brand: 'bambu lab', kind: 'printer' }
).action, 'merge');
// …while naming the bundle never blurs a real difference.
const hard = [
  ['Bambu Lab P1S 3D Yazıcı', 'Bambu Lab P1S Combo 3D Yazıcı'],           // bare vs bundle
  ['Bambu Lab P1S Combo 3D Yazıcı', 'Bambu Lab P1S AMS 2 Pro 3D Yazıcı'], // AMS 1 vs AMS 2 Pro
  ['Bambu Lab A1 mini', 'Bambu Lab A1 mini Combo'],                       // bare vs bundle
  ['Bambu Lab A1 mini Combo', 'Bambu Lab A1 Combo'],                      // mini vs not
  ['Bambu Lab H2D Laser 40W Combo', 'Bambu Lab H2D Laser 10W Combo']      // laser watts
];
for (const [a, b] of hard) {
  assert.equal(decidePair({ name: a, brand: 'Bambu Lab', kind: 'printer' }, { id: 'h', name: b, brand: 'bambu lab', kind: 'printer' }).action, 'create', 'must stay separate: ' + a + ' / ' + b);
}
assert.equal(identity({ name: 'Bambu Lab P1S AMS 2 Pro 3D Yazıcı', brand: 'Bambu Lab', kind: 'printer' }).combo, true, 'a stated AMS is bundle evidence');
assert.equal(identity({ name: 'Bambu Lab P1S 3D Yazıcı', brand: 'Bambu Lab', kind: 'printer' }).combo, false, 'a bare printer is not a bundle');
// A named laser wattage is a configuration: one side naming it and the other not is a
// difference, so a 10W laser bundle never lands on the plain printer's row.
assert.equal(decidePair(
  { name: 'Bambu Lab H2D Laser Full Combo 10W 3D Yazıcı', brand: 'Bambu Lab', kind: 'printer' },
  { id: 'r', name: 'Bambu Lab H2D Combo 3D Yazıcı', brand: 'Bambu Lab', kind: 'printer' }
).action, 'create');
// A laser SKU differs on two axes: the wattage and the technology itself ("laser" vs the
// plain FDM machine), so both are reported.
assert.deepEqual(conflicts(
  identity({ name: 'Bambu Lab H2S Laser Full Combo 10W', brand: 'Bambu Lab', kind: 'printer' }),
  identity({ name: 'Bambu Lab H2S Combo 3D Yazıcı', brand: 'Bambu Lab', kind: 'printer' })
).sort(), ['laser', 'technology']);
// …but a bare "lazer" marketing mention without watts must not split a pair.
assert.equal(conflicts(
  identity({ name: 'Bambu Lab H2S Combo Lazer Kazıma Destekli', brand: 'Bambu Lab', kind: 'printer' }),
  identity({ name: 'Bambu Lab H2S Combo 3D Yazıcı', brand: 'Bambu Lab', kind: 'printer' })
).includes('laser'), false);
// "AMS ile" is Combo; "AMS'siz" is the bare printer. Both spellings must fold.
assert.equal(identity({ name: 'Bambu Lab P1S Combo 3D Yazıcı Ams ile 16 Renge Kadar', brand: 'Bambu Lab', kind: 'printer' }).combo, true);
assert.equal(identity({ name: "Bambu Lab P1S 3D Yazıcı Ams'siz", brand: 'Bambu Lab', kind: 'printer' }).combo, false);
assert.equal(decidePair(
  { name: "Bambu Lab P1s 3D Yazıcı Ams'siz 256 x 256mm", brand: 'Bambu Lab', kind: 'printer' },
  { id: 's', name: 'Bambu Lab P1S Combo 3D Yazıcı', brand: 'Bambu Lab', kind: 'printer' }
).action, 'create', 'a bare printer never merges into a Combo');
// A variant word names a different machine: the catalog had K2 Plus, K2 Pro and K2 all
// sitting on one row because "Plus"/"Pro" were treated as padding.
const k2 = (n) => ({ name: n, brand: 'Creality', kind: 'printer' });
assert.equal(decidePair(k2('Creality K2 Plus Combo 3D Yazici'), { id: 'k2', ...k2('Creality K2 Combo 3D Yazici') }).action, 'create', 'K2 Plus is not K2');
assert.equal(decidePair(k2('Creality K2 Pro Combo 3D Yazici'), { id: 'k2', ...k2('Creality K2 Combo 3D Yazici') }).action, 'create', 'K2 Pro is not K2');
assert.deepEqual(conflicts(identity(k2('Creality K2 Plus Combo')), identity(k2('Creality K2 Combo'))).sort(), ['model', 'variant']);
// ...but the same variant worded differently is still one product.
assert.equal(decidePair(k2('Creality K2 Plus Combo 3D Yazici'), { id: 'p', ...k2('Creality K2 Plus Combo 3D Printer') }).action, 'merge');
assert.equal(decidePair(k2('Bambu Lab H2S Combo 3D Yazici'), { id: 'h', name: 'Bambu Lab H2S Combo Yazici', brand: 'Bambu Lab', kind: 'printer' }).action, 'merge', 'no variant word, no new split');

for (const [brand, model] of [['Bambu Lab', 'A1'], ['Creality', 'K2'], ['Anycubic', 'Kobra 3']]) {
  assert.equal(decidePair(
    { name: brand, brand, kind: 'printer' },
    { id: model, name: brand + ' ' + model, brand, kind: 'printer' }
  ).action, 'create', brand + ' brand-only identity cannot merge into a model');
  assert.equal(decidePair(
    { name: brand + ' Combo 3D Printer', brand, kind: 'printer' },
    { id: model + '-combo', name: brand + ' ' + model + ' Combo 3D Printer', brand, kind: 'printer' }
  ).action, 'create', brand + ' generic combo identity cannot merge into a model');
}
assert.equal(decidePair(
  { name: 'Elegoo Neptune 4', brand: 'Elegoo', kind: 'printer' },
  { id: 'n3', name: 'Elegoo Neptune 3', brand: 'Elegoo', kind: 'printer' }
).action, 'create', 'distinct model cores create');
assert.notEqual(decidePair(
  { name: 'Bambu Lab A1 H2S', brand: 'Bambu Lab', kind: 'printer' },
  { id: 'a1', name: 'Bambu Lab A1', brand: 'Bambu Lab', kind: 'printer' }
).action, 'merge', 'an extra known model core blocks subset merge');

const slugIdentity = identity({ name: 'Bambu Lab', brand: 'Bambu Lab', kind: 'printer', url: 'https://shop.example/products/bambu-lab-a1mini-combo' });
assert.equal(slugIdentity.modelCore, 'a1-mini');
assert.equal(slugIdentity.comboAxis, 'combo');
assert.equal(slugIdentity.mini, true);
assert.equal(decidePair(
  { name: 'Bambu Lab', brand: 'Bambu Lab', kind: 'printer', url: 'https://shop.example/bambu-lab-a1mini-combo' },
  { id: 'mini', name: 'Bambu Lab A1 Mini Combo', brand: 'Bambu Lab', kind: 'printer' }
).action, 'merge', 'slug-derived model axes match the titled product');
assert.equal(identity({ name: 'Creality', brand: 'Creality', kind: 'printer', url: 'https://shop.example/collections/all-printers' }).modelCore, '', 'category URL invents no model');
assert.equal(decidePair(
  { name: 'Bambu Lab', brand: 'Bambu Lab', kind: 'printer', url: 'https://shop.example/bambu-lab-a1' },
  { id: 'a1-real', name: 'Bambu Lab A1', brand: 'Bambu Lab', kind: 'printer' }
).action, 'merge', 'URL-derived model identity merges with the same model');
const blackTr = { name: 'Elegoo PLA Siyah 1kg', brand: 'Elegoo', kind: 'filament', polymer: 'pla' };
const blackEn = { id: 'black', name: 'Elegoo PLA Black 1kg', brand: 'Elegoo', kind: 'filament', polymer: 'pla' };
assert.equal(identity(blackTr).modelCore, '');
assert.equal(decidePair(blackTr, blackEn).action, 'merge', 'filament still merges without a model core');
console.log('PASS: Magellan merges typos/synonyms, splits combo and color, classifies polymer/variant.');
