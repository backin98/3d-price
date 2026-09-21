// Laser wattage: written BEFORE the implementation, per the editing rules.
//
// The rule (resolved after the earlier contradiction):
//   (a) a `NN W` / `NN Watt` token counts as laser wattage BY DEFAULT - no laser word required, so
//       "H2C 10 Watt Combo" still matches "H2C Combo Laser 10 Watt";
//   (b) it is VETOED when a power/heater word sits within 2 tokens (adaptor, guc kaynagi, PSU, power,
//       isitici, heater, tabla, bed);
//   (c) it is IGNORED outside a plausible laser range. Set from real data: across 393 live catalog
//       and snapshot titles the only wattages present are 10 (x8) and 40 (x4), all Bambu laser
//       modules, so 1-80W is the range. 350W is a power supply, not a laser.
const assert = require('node:assert/strict');
const { axesOf, decidePair } = require('../lib/product-match.cjs');

const w = (n) => axesOf({ name: n, kind: 'printer' }).laserW;
const pair = (a, b) => decidePair({ name: a, kind: 'printer' }, { name: b, kind: 'printer' });

// --- (a) default: a bare wattage is the laser module -----------------------------------------
assert.equal(w('Bambu Lab H2C 10 Watt Combo 3D Yazıcı'), '10', 'bare wattage counts by default');
assert.equal(w('Bambu Lab H2C Combo Laser 10 Watt 3D Yazıcı'), '10', 'explicit laser word');
// The must-pass pair from step 1 must still merge.
assert.equal(
  pair('Bambu Lab H2C 10 Watt Combo 3D Yazıcı', 'Bambu Lab H2C Combo Laser 10 Watt 3D Yazıcı').action,
  'merge',
  'the H2C pair must still be one machine'
);

// --- real laser titles taken from the live catalog --------------------------------------------
assert.equal(w('Bambu Lab H2D Laser Combo 3D Printer 40W'), '40', 'real 40W laser row');
assert.equal(w('Bambu Lab H2C Laser Full Combo 10W'), '10', 'real 10W laser row');
assert.equal(w('Bambu Lab H2D 10W Lazer Full Combo 3D Yazıcı'), '10', 'wattage before the laser word');
assert.equal(w('Bambu Lab H2S 10W Lazer Full Combo 3D Yazıcı'), '10', 'wattage before the laser word');
// A real difference still splits.
assert.equal(
  pair('Bambu Lab H2D Laser Combo 10W', 'Bambu Lab H2D Laser Combo 40W').action,
  'create',
  '10W and 40W are different machines'
);

// --- (b) veto within 2 tokens of a power/heater word ------------------------------------------
assert.equal(w('Bambu Lab H2C 350W güç kaynağı dahil 3D Yazıcı'), '', 'guc kaynagi vetoes');
assert.equal(w('Bambu Lab A1 350W adaptör 3D Yazıcı'), '', 'adaptor vetoes');
assert.equal(w('Creality K1 600W ısıtıcı 3D Yazıcı'), '', 'isitici vetoes');
assert.equal(w('Bambu Lab P1S 500W PSU 3D Yazıcı'), '', 'PSU vetoes');
assert.equal(w('Bambu Lab P1S 350W power supply 3D Yazıcı'), '', 'power supply vetoes');
assert.equal(w('Anycubic Kobra 200W tabla ısıtıcı 3D Yazıcı'), '', 'tabla vetoes');
assert.equal(w('Bambu Lab A1 220W heated bed 3D Yazıcı'), '', 'heated bed vetoes');

// A laser wattage survives when the power figure is not adjacent to it.
assert.equal(
  w('Bambu Lab H2C 10W Lazer Full Combo 3D Yazıcı ile 350W güç kaynağı'),
  '10',
  'the laser wattage is kept when the power figure is elsewhere'
);

// --- (c) implausible wattage is ignored --------------------------------------------------------
assert.equal(w('Bambu Lab H2C 350W 3D Yazıcı'), '', '350W is outside the laser range');
assert.equal(w('Generic Printer 500 Watt 3D Yazıcı'), '', '500W is outside the laser range');
assert.equal(w('Bambu Lab A1 0W 3D Yazıcı'), '', 'zero is not a laser wattage');

console.log('PASS: bare wattage is the laser module, power/heater wattages are vetoed, and implausible');
console.log('      wattages are ignored - while the H2C pair still merges and 10W vs 40W still splits.');
