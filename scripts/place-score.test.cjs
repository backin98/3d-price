const assert = require('node:assert/strict');
const { score, similar } = require('../lib/qwen-place.cjs');

assert.equal(similar('corolla', 'crolla'), true);
assert.equal(similar('hatchback', 'hatchback'), true);
assert.equal(similar('combo', 'a1'), false);
assert.ok(score('Toyota Corolla Hatchback Car', 'Toyota Crolla Hatchback Vehicle') >= 0.9);
assert.ok(score('Creality K1 Max Yazıcı Fiyat 2026', 'Creality K1 Max 3D Printer') >= 0.8);
assert.ok(score('Bambu Lab A1', 'Bambu Lab A1 Combo') < 0.9);
assert.ok(score('Anycubic PLA 1kg Kırmızı', 'Anycubic PLA 1kg Mavi') < 0.8);
console.log('PASS: typos/synonyms score as the same SKU; combo and color stay distinct.');
