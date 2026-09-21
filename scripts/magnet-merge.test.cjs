// The H2S/A1 magnet. Written FIRST, against the matcher that was welding "Bambu Lab" into the H2S card.
//
// FIXED (verified, passing below): a printer title with no model in it no longer merges. Brand-only
// ("Bambu Lab"), brand plus packaging ("Bambu Lab Combo", "Bambu Lab 3D Yazıcı Combo") and brand-only
// against a real model all now refuse, because `conflicts()` treats a one-sided model core as a
// conflict for printers. That check previously required BOTH sides to be populated, which is the whole
// reason a brand-only title sailed through to the `titleSubset` merge.
//
// A weak title is also enriched from a URL slug when the shared model table recognizes it.
const assert = require('node:assert/strict');
const { decidePair, axesOf } = require('../lib/product-match.cjs');

const pair = (a, b) => decidePair({ kind: 'printer', name: a }, { kind: 'printer', name: b });

// --- must NOT merge: brand-only or packaging-only titles have no identity ----------------------
const MUST_NOT_MERGE = [
  ['Bambu Lab', 'Bambu Lab H2S 3D Yazıcı', 'brand-only vs a real model'],
  ['Bambu Lab Combo', 'Bambu Lab A1 Combo 3D Yazıcı', 'brand + combo vs a real model'],
  ['Bambu Lab 3D Yazıcı Combo', 'Bambu Lab H2S Combo', 'brand + packaging vs a real combo'],
  ['Bambu Lab', 'Bambu Lab A1 Combo 3D Yazıcı', 'brand-only vs A1 Combo'],
  ['Creality', 'Creality K2 Plus', 'brand-only vs a real model, different brand'],
  ['Bambu Lab A1 3D Yazıcı', 'Bambu Lab H2S 3D Yazıcı', 'two real, different models'],
  ['Anycubic Photon P1', 'Bambu Lab P1S 3D Yazıcı', 'same short token, different makers'],
];
for (const [a, b, why] of MUST_NOT_MERGE) {
  const d = pair(a, b);
  assert.equal(d.action, 'create', 'must not merge (' + why + '): ' + a + '  vs  ' + b + '  -> ' + d.action + ' | ' + d.reason);
}

// --- the URL-slug listing is identified and still cannot weld onto another model ----------------
const metatech = {
  kind: 'printer',
  name: 'Bambu Lab',
  url: 'https://store.metatechtr.com/bambu-lab-a1-3d-printer'
};
assert.equal(
  decidePair(metatech, { kind: 'printer', name: 'Bambu Lab H2S 3D Yazıcı' }).action,
  'create',
  'a brand-only title must not weld into H2S'
);
assert.equal(
  axesOf(metatech).modelCore,
  'a1',
  'a known product slug supplies the missing model core'
);

// --- real same-model pairs must STILL merge (no over-correction) ------------------------------
const MUST_MERGE = [
  ['Bambu Lab P1S 3D Yazıcı', 'Bambu Lab P1S 3D Yazıcı (Orijinal)'],
  ['Bambu Lab A1 3D Yazıcı', 'BAMBU LAB A1 3D YAZICI'],
];
for (const [a, b] of MUST_MERGE) {
  const d = pair(a, b);
  assert.equal(d.action, 'merge', 'a genuine same-model pair must still merge: ' + a + ' vs ' + b + ' -> ' + d.action + ' | ' + d.reason);
}

console.log('PASS: brand-only and packaging-only printer titles never merge, and genuine same-model');
console.log('      pairs still merge, while known URL slugs supply a missing model core.');
