const assert = require('node:assert/strict');
const { score, similar, decidePair, taxonomy, identity, normalizePrinterTitle } = require('../lib/product-match.cjs');

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
console.log('PASS: Magellan merges typos/synonyms, splits combo and color, classifies polymer/variant.');
