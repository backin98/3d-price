// Classical vision only: the hash math must be deterministic and the bands sane.
// Browser decode is exercised when a Chromium is available; skipped silently if not.
const assert = require('node:assert/strict');
const { hamming, hashesFromGray, visualScore, fingerprintBuffer, shutdown, VISUAL_SAME, VISUAL_WEAK, S } = require('../lib/image-match.cjs');

const gray = (fn) => Array.from({ length: S * S }, (_, i) => fn(i % S, Math.floor(i / S)));
const gradient = gray((x, y) => (x * 8 + y * 4) % 256);
const inverted = gradient.map((v) => 255 - v);
const flat = gray(() => 128);
const checker = gray((x, y) => ((x >> 2) + (y >> 2)) % 2 ? 255 : 0);

const g1 = hashesFromGray(gradient);
assert.match(g1.p, /^[0-9a-f]{16}$/, 'pHash is 64 bits of hex');
assert.match(g1.a, /^[0-9a-f]{16}$/, 'aHash is 64 bits of hex');
assert.deepEqual(hashesFromGray(gradient), g1, 'same pixels, same hash');

// A photo posted by two shops is the same photo, not byte-identical.
const jitter = gradient.map((v, i) => Math.max(0, Math.min(255, v + (i % 7) - 3)));
const same = visualScore(g1, hashesFromGray(jitter));
assert.ok(same.score >= VISUAL_SAME, 'near-identical pixels score above VISUAL_SAME, got ' + same.score);
assert.ok(same.distance <= 10, 'near-identical pixels are a few bits apart, got ' + same.distance);

const other = visualScore(g1, hashesFromGray(checker));
assert.ok(other.score <= VISUAL_WEAK, 'a different photo scores below VISUAL_WEAK, got ' + other.score);

assert.equal(hamming('0000000000000000', 'ffffffffffffffff'), 64);
assert.equal(hamming('0000000000000000', '0000000000000001'), 1);
assert.equal(hamming('', '0000000000000000'), 64, 'malformed hash is maximally distant');
assert.equal(hamming('0000000000000000', 'zzzzzzzzzzzzzzzz'), 64, 'non-hex is maximally distant');
assert.equal(visualScore(null, g1), null, 'a missing fingerprint is not evidence');
assert.equal(visualScore(g1, {}), null);
assert.ok(visualScore(hashesFromGray(flat), hashesFromGray(flat)).score === 1, 'identical hashes score 1');

// Inverting the brightness must not make a photo match itself: bits flip together.
assert.ok(visualScore(hashesFromGray(gradient), hashesFromGray(inverted)).score < VISUAL_SAME, 'a negative is not the same product');

(async () => {
  let decoded = null;
  try {
    decoded = await fingerprintBuffer(Buffer.from('not an image at all'));
  } catch (e) {
    throw new Error('undecodable bytes must return null, not throw: ' + e.message);
  }
  assert.equal(decoded, null, 'non-image bytes are not evidence');
  try {
    const png = Buffer.from('89504e470d0a1a0a0000000d494844520000000100000001080600000', 'hex');
    assert.equal(await fingerprintBuffer(png), null, 'truncated PNG is not evidence');
  } catch (e) {
    throw new Error('a broken image must not throw: ' + e.message);
  }
  console.log('PASS: pHash/aHash determinism, hamming guards, visual bands, junk-input rejection.');
  await shutdown(); // the decode above launches Chromium; leaving it open hangs this process
})().catch((e) => { console.error(e); process.exitCode = 1; });
