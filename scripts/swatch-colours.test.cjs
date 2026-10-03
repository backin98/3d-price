// The photo reader behind the admin's "Auto" swatch: the true tone of the filament and the stops of a gradient, tested on
// synthetic spool photos (a filament ring on a flange, on white paper, with shading noise and glints).
// Real photos are checked on your PC with scripts/eval-swatch-colours.cjs (it compares with the shades you picked).
const assert = require('node:assert/strict');
const S = require('../public/admin/swatch-colours.js');

const W = 96;
let seed = 7;
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const rgbOf = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };

// A spool seen from the front: paper, a flange disc, the wound filament ring, an empty hub. `ringAt(angle)` gives the
// filament colour at that angle (a gradient changes it around the ring). Shading: darker toward the inner edge, noise.
function spool({ bg = '#ffffff', flange = '#262626', ring = '#c0392b', ringAt = null, glints = 0, alpha = 255 } = {}) {
  const px = new Uint8ClampedArray(W * W * 4);
  const c = W / 2;
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const d = Math.hypot(x - c, y - c);
    let rgb = rgbOf(bg), a = bg === 'none' ? 0 : 255;
    if (bg === 'none') rgb = [255, 255, 255];
    if (d <= 44 && d > 34) rgb = rgbOf(flange), a = 255;
    else if (d <= 34 && d > 14) {
      const col = rgbOf(ringAt ? ringAt(Math.atan2(y - c, x - c)) : ring);
      const shade = 0.78 + 0.22 * ((d - 14) / 20) + (rnd() - 0.5) * 0.08;
      rgb = col.map((v) => Math.max(0, Math.min(255, Math.round(v * shade)))); a = 255;
    } else if (d <= 14 && d > 0) a = bg === 'none' ? 0 : 255;
    const o = (y * W + x) * 4;
    px[o] = rgb[0]; px[o + 1] = rgb[1]; px[o + 2] = rgb[2]; px[o + 3] = a === 0 ? 0 : (alpha === 255 ? 255 : alpha);
  }
  for (let g = 0; g < glints; g++) {
    const gx = Math.round(c + (rnd() - 0.5) * 40), gy = Math.round(c + (rnd() - 0.5) * 40);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const o = ((gy + dy) * W + gx + dx) * 4; px[o] = px[o + 1] = px[o + 2] = 252; }
  }
  return px;
}

const near = (got, want, limit, label) => {
  const d = S.deltaE(got, want);
  assert.ok(d <= limit, label + ': got ' + got + ' for ' + want + ', distance ' + d.toFixed(1) + ' (limit ' + limit + ')');
};

// ---- one colour ---------------------------------------------------------------------------------------------------
for (const [name, truth] of [['red', '#c0392b'], ['blue', '#2e6fd0'], ['green', '#2f9e57'], ['yellow', '#e8c21a'], ['purple', '#7a3fa8'], ['pink', '#f08fb5'], ['orange', '#e8761a']]) {
  const t = S.tone(spool({ ring: truth }), W, W);
  assert.ok(t, name + ': a tone');
  near(t.hex, truth, 9, name + ' on a black flange');
  near(S.tone(spool({ ring: truth, flange: '#b28b5c' }), W, W).hex, truth, 9, name + ' on a cardboard flange');
}
// glints and a transparent background do not move it
near(S.tone(spool({ ring: '#2e6fd0', glints: 14 }), W, W).hex, '#2e6fd0', 9, 'blue with glints');
near(S.tone(spool({ ring: '#2e6fd0', bg: 'none' }), W, W).hex, '#2e6fd0', 9, 'blue on a transparent background');
// a grey table instead of white paper
near(S.tone(spool({ ring: '#c0392b', bg: '#9aa0a6' }), W, W).hex, '#c0392b', 10, 'red on a grey table');

// ---- no colour in the photo: black, white, grey ------------------------------------------------------------------
const black = S.tone(spool({ ring: '#1c1c1c', flange: '#3a3a3a' }), W, W);
assert.ok(S.rgbToLab(...S.labToRgb(...S.hexToLab(black.hex)))[0] < 30, 'black filament reads dark: ' + black.hex);
const white = S.tone(spool({ ring: '#ececec', flange: '#262626' }), W, W);
assert.ok(S.hexToLab(white.hex)[0] > 78, 'white filament reads light: ' + white.hex);
const grey = S.tone(spool({ ring: '#8a8d90', flange: '#262626' }), W, W);
assert.ok(S.hexToLab(grey.hex)[0] > 40 && S.hexToLab(grey.hex)[0] < 70, 'grey filament reads mid: ' + grey.hex);

// ---- gradients ----------------------------------------------------------------------------------------------------
const band = (angle, stops) => { const t = ((angle + Math.PI) / (2 * Math.PI)); return stops[Math.min(stops.length - 1, Math.floor(t * stops.length))]; };
const tri = ['#d83a2e', '#f2c61c', '#2f6fd6'];
const g3 = S.gradientStops(spool({ ringAt: (a) => band(a, tri) }), W, W, { max: 6 });
assert.equal(g3.length, 3, 'three bands are three stops: ' + g3.map((s) => s.hex));
for (const want of tri) assert.ok(g3.some((s) => S.deltaE(s.hex, want) < 10), 'a stop near ' + want + ' in ' + g3.map((s) => s.hex));
for (let i = 0; i < g3.length; i++) for (let j = i + 1; j < g3.length; j++) assert.ok(S.deltaE(g3[i].hex, g3[j].hex) >= 14, 'no two stops look alike');

// four bands where two are nearly the same shade: they are one stop, not a repeat
const dup = ['#d83a2e', '#dc4034', '#2f6fd6', '#2fb36a'];
const gd = S.gradientStops(spool({ ringAt: (a) => band(a, dup) }), W, W, { max: 6 });
assert.equal(gd.length, 3, 'near-identical shades merge: ' + gd.map((s) => s.hex));

// colours already on the card are not offered again
const gAvoid = S.gradientStops(spool({ ringAt: (a) => band(a, tri) }), W, W, { max: 6, avoid: ['#d83a2e'] });
assert.equal(gAvoid.length, 2, 'the red already on the card is left out: ' + gAvoid.map((s) => s.hex));
assert.ok(!gAvoid.some((s) => S.deltaE(s.hex, '#d83a2e') < 14));

// every colour already on the card: nothing left to offer, and no crash
assert.deepEqual(S.gradientStops(spool({ ringAt: (a) => band(a, tri) }), W, W, { max: 6, avoid: tri }), [], 'all three already on the card: no stops');

// the limit holds
const many = ['#d83a2e', '#f2c61c', '#2f6fd6', '#2fb36a', '#8a3fb8', '#e87b1c', '#1fb7c4'];
assert.ok(S.gradientStops(spool({ ringAt: (a) => band(a, many) }), W, W, { max: 4 }).length <= 4, 'at most max stops');

// the flange is not a stop
assert.ok(!g3.some((s) => S.hexToLab(s.hex)[0] < 22 && Math.hypot(S.hexToLab(s.hex)[1], S.hexToLab(s.hex)[2]) < 8), 'the black flange is not a gradient stop');

// an empty or all-background picture gives nothing rather than a guess
assert.equal(S.tone(new Uint8ClampedArray(W * W * 4).fill(255), W, W), null);
assert.deepEqual(S.gradientStops(new Uint8ClampedArray(W * W * 4).fill(255), W, W), []);

console.log('PASS: the photo reader finds the true tone of coloured, black, white and grey filament, ignores flange, glints and background, and picks distinct, ordered gradient stops without repeats.');
