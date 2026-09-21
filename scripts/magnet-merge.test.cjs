// The H2S/A1 magnet. Written FIRST, against the matcher that was welding "Bambu Lab" into the H2S card.
//
// FIXED (verified, passing below): a printer title with no model in it no longer merges. Brand-only
// ("Bambu Lab"), brand plus packaging ("Bambu Lab Combo", "Bambu Lab 3D Yazıcı Combo") and brand-only
// against a real model all now refuse, because `conflicts()` treats a one-sided model core as a
// conflict for printers. That check previously required BOTH sides to be populated, which is the whole
// reason a brand-only title sailed through to the `titleSubset` merge.
//
// NOT YET DONE: identifying the listing from its URL slug. Metatech serves
// ".../bambu-lab-a1-3d-printer" while the page text says only "Bambu Lab". Today that listing is now
// safely refused a merge, but it still creates as an *unnamed* card instead of being identified as A1.
// The assertion for it is kept below, marked as the known gap, so the next pass starts here.
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

// --- the URL-slug listing no longer welds, even though it is not yet identified ----------------
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
// KNOWN GAP, deliberately asserted as current behaviour so it cannot be forgotten:
// `axesOf(metatech).modelCore` is still '' - the slug ".../bambu-lab-a1-3d-printer" is not read, so the
// listing creates as unnamed instead of becoming an A1 card. When that is implemented this line
// becomes assert.equal(axesOf(metatech).modelCore, 'a1') and the comment above is deleted.
assert.equal(
  axesOf(metatech).modelCore,
  '',
  'slug->modelCore is NOT implemented yet; if this fails, it has been implemented - update this test'
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
console.log('      pairs still merge. KNOWN GAP: a URL slug does not yet supply the missing model core.');
