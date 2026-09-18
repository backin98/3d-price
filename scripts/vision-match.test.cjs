// Fusion bands: thumbnails may only tip a gray title, never a hard conflict.
const assert = require('node:assert/strict');
const { decidePair, rankCandidates } = require('../lib/product-match.cjs');

const P = (name, extra = {}) => ({ id: name, name, kind: 'printer', brand: 'Bambu Lab', ...extra });
const KE = P('Creality Ender 3 V3 KE', { brand: 'Creality' });
const SE = P('Creality Ender 3 V3 SE', { brand: 'Creality' });

// Gray band on titles alone: two model letters apart, same brand, no hard conflict.
const gray = decidePair(KE, SE);
assert.equal(gray.action, 'review');
assert.equal(gray.nearDupe, true, 'a gray title is a near-duplicate hold');

// The same photo confirms the call but never merges on its own: two different models
// can share one stock shot. The human (or Gemma, toggle on) decides.
const strong = decidePair(KE, SE, 0.95);
assert.equal(strong.action, 'review', 'a matching thumbnail holds, it does not merge');
assert.equal(strong.photoMatch, true);
assert.equal(strong.matchPath, 'magellan+visual');
assert.equal(strong.visual, 0.95, 'the visual score rides along for the review board');
assert.match(strong.reason, /confirm/);

// Bad/missing photo leaves the hold alone, and reads as a disagreement when weak.
assert.equal(decidePair(KE, SE, 0.2).action, 'review');
assert.equal(decidePair(KE, SE, 0.2).nearDupe, true);
assert.equal(decidePair(KE, SE, 0.2).photoMatch, false);
assert.match(decidePair(KE, SE, 0.2).reason, /disagree/);
assert.equal(decidePair(KE, SE, undefined).action, 'review', 'no visual evidence changes nothing');
assert.equal(decidePair(KE, SE, undefined).photoMatch, false);
assert.equal(decidePair(KE, SE, NaN).action, 'review', 'a broken score is not a score');

// Hard conflicts beat even a pixel-perfect photo.
const conflicts = [
  [P('Bambu Lab P1S'), P('Bambu Lab P1S Combo')],
  [P('Bambu Lab P1S AMS 2 Pro'), P('Bambu Lab P1S')],
  [P('Bambu Lab A1 mini'), P('Bambu Lab A1')],
  [P('Bambu Lab H2D Laser 40W'), P('Bambu Lab H2D Laser 10W')]
];
for (const [a, b] of conflicts) {
  const d = decidePair(a, b, 1);
  assert.equal(d.action, 'create', 'never merge across ' + d.reason);
  assert.equal(d.conflict, true);
}

// Low title + same photo is suspicious, not a merge.
const photoOnly = decidePair(P('Bambu Lab X1 Carbon', { brand: 'Bambu Lab' }), P('Bambu Lab A1 Combo 3D Yazıcı', { brand: 'Bambu Lab' }), 0.95);
assert.notEqual(photoOnly.action, 'merge', 'a shared photo alone must not merge');

// The real repro: marketing noise on the end of a title still folds to one printer.
const buffer = decidePair(
  P('Bambu Lab P1S AMS 2 Pro Combo 3D Printer with Buffer'),
  P('Bambu Lab P1S AMS 2 Pro Combo 3D Printer with buffer hediyeli bundle')
);
assert.equal(buffer.action, 'merge', 'noise-only titles merge without vision or Gemma');
assert.equal(buffer.matchPath, 'magellan');

// rankCandidates takes the same optional score map.
const ranked = rankCandidates(KE, [SE, P('Creality K2 Combo', { brand: 'Creality' })], { 'Creality Ender 3 V3 SE': 0.95 });
assert.equal(ranked[0].item.name, 'Creality Ender 3 V3 SE');
assert.equal(ranked[0].decision.photoMatch, true, 'the map reaches decidePair through rankCandidates');
assert.equal(rankCandidates(KE, [SE])[0].decision.action, 'review', 'without the map, plain Magellan');

console.log('PASS: vision confirms gray titles only, hard conflicts survive vision, noise folds on titles alone.');
