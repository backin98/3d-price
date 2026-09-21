// Order sensitivity: the same machine written with its modifiers in a different order, or with the
// wattage standing in for the word "Laser", must be one identity.
//
// This exists because Magellan reported "different technology" for
//   "Bambu Lab H2C 10 Watt Combo 3D Yazici"          (no word "Laser")
//   "Bambu Lab H2C Combo Laser 10 Watt 3D Yazici"   (wattage and Laser)
// which is the same printer twice, and it was creating two catalogue rows.
const assert = require('node:assert/strict');
const { decidePair } = require('../lib/product-match.cjs');

const pair = (a, b) => decidePair({ name: a, kind: 'printer' }, { name: b, kind: 'printer' });

const SAME = [
  ['Bambu Lab H2C 10 Watt Combo 3D Yazici', 'Bambu Lab H2C Combo Laser 10 Watt 3D Yazici'],
  ['Bambu Lab H2C Combo Lazer 10W 3D Yazici', 'Bambu Lab H2C 10W Combo 3D Yazici'],
  ['Bambu Lab H2S Combo Lazer 40W 3D Yazici', 'Bambu Lab H2S 40W Combo 3D Yazici'],
];
for (const [a, b] of SAME) {
  const d = pair(a, b);
  assert.equal(d.action, 'merge', 'modifier order must not split one machine: ' + d.reason + ' | ' + a + ' vs ' + b);
}

// The split still has to hold: 10W is not 40W, and a bare machine is not the combo.
const DIFFERENT = [
  ['Bambu Lab H2C Combo Lazer 10W 3D Yazici', 'Bambu Lab H2C Combo Lazer 40W 3D Yazici'],
  ['Bambu Lab H2C 10 Watt Combo 3D Yazici', 'Bambu Lab H2C 3D Yazici'],
];
for (const [a, b] of DIFFERENT) {
  const d = pair(a, b);
  assert.equal(d.action, 'create', 'a real difference must still split: ' + d.reason + ' | ' + a + ' vs ' + b);
}

// A wattage in the title is a laser machine, and it must not also become a different technology from
// the same machine written with the word spelled out.
const { axesOf } = require('../lib/product-match.cjs');
assert.equal(axesOf({ name: 'Bambu Lab H2C 10 Watt Combo 3D Yazici', kind: 'printer' }).technology, 'laser');
assert.equal(axesOf({ name: 'Bambu Lab H2C Combo Laser 10 Watt 3D Yazici', kind: 'printer' }).technology, 'laser');

console.log('PASS: modifier order and implied laser wattage no longer split one machine into two rows.');
