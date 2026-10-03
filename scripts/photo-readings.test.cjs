// The run reads every filament photo: the true tone of the spool (or a gradient's stops) and what the spool is made of.
//  - the fill rules: what the photo may fill and what it must leave alone;
//  - the real path: download, decode in Chromium, read, cached per image URL (a second run does not download again).
// The pictures are synthetic spools; how well it does on your real photos is measured by npm run eval-spool-photo.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'photo-readings-'));
process.env.PHOTO_READINGS_FILE = path.join(tmp, 'photo-readings.json');
const P = require('../lib/photo-readings.cjs');
const W = 96;

// ---- synthetic spool photos ------------------------------------------------------------------------------------------
const rgbOf = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
function spoolPixels({ ring = '#2e6fd0', flange = '#262626', hub = null, ringAt = null } = {}) {
  const px = new Uint8ClampedArray(W * W * 4);
  const c = W / 2;
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const d = Math.hypot(x - c, y - c);
    let rgb = [255, 255, 255];
    if (d <= 44 && d > 34) rgb = rgbOf(flange);
    else if (d <= 34 && d > 14) { const col = rgbOf(ringAt ? ringAt(Math.atan2(y - c, x - c)) : ring); const shade = 0.78 + 0.22 * ((d - 14) / 20); rgb = col.map((v) => Math.round(v * shade)); }
    else if (d <= 14 && hub) rgb = rgbOf(hub);
    const o = (y * W + x) * 4; px[o] = rgb[0]; px[o + 1] = rgb[1]; px[o + 2] = rgb[2]; px[o + 3] = 255;
  }
  return { data: px, w: W, h: W };
}
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function png({ data }) {
  const chunk = (type, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(type), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(W, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((W * 4 + 1) * W);
  for (let y = 0; y < W; y++) { raw[y * (W * 4 + 1)] = 0; Buffer.from(data.buffer, y * W * 4, W * 4).copy(raw, y * (W * 4 + 1) + 1); }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const deltaE = require('../public/admin/swatch-colours.js').deltaE;

(async () => {
  // ---- the fill rules ----------------------------------------------------------------------------------------------------
  const board = P.readPixels(spoolPixels({ ring: '#2e6fd0', flange: '#b28b5c', hub: '#b9976a' }));
  const plastic = P.readPixels(spoolPixels({ ring: '#c0392b', flange: '#262626' }));
  assert.equal(board.spool.value, 'cardboard');
  assert.equal(plastic.spool.value, 'plastic');
  assert.ok(deltaE(board.tone.hex, '#2e6fd0') < 10 && deltaE(plastic.tone.hex, '#c0392b') < 10, 'the tone of the filament');

  const fake = (readings) => async (url) => readings[url] || null;
  const listing = (extra) => ({ kind: 'filament', brand: 'Acme', url: 'https://x.test/' + Math.random(), image: 'https://img.test/' + Math.random().toString(36).slice(2) + '.png', ...extra });

  // a spool the text could not place: filled from a sure photo, with its evidence and its source
  let l = listing({ colorHex: '#999999', guess: { colorHex: { value: '#999999', from: 'your earlier picks', n: 1 } } });
  await P.applyPhotoReadings([l], { read: fake({ [l.image]: board }) });
  assert.equal(l.spoolMaterial, 'cardboard');
  assert.equal(l.spoolSource, 'photo');
  assert.equal(l.guess.spoolMaterial.from, 'photo');
  assert.ok(deltaE(l.colorHex, '#2e6fd0') < 10, 'the photo tone replaces the generic / learned shade');
  assert.equal(l.colorHexSource, 'photo');
  assert.equal(l.guess.colorHex.from, 'photo');

  // a spool you or the text already set stays; a shade you eyedropped stays
  l = listing({ spoolMaterial: 'plastic', colorHex: '#123456', colorHexSource: 'eyedropper' });
  await P.applyPhotoReadings([l], { read: fake({ [l.image]: board }) });
  assert.equal(l.spoolMaterial, 'plastic');
  assert.equal(l.colorHex, '#123456');
  assert.equal(l.colorHexSource, 'eyedropper');

  // not sure enough: only a hint, the field stays empty
  const unsure = { tone: plastic.tone, stops: [], spool: { value: 'plastic', confidence: 0.7, shellKraft: 0.1, midKraft: 0 } };
  l = listing({});
  await P.applyPhotoReadings([l], { read: fake({ [l.image]: unsure }) });
  assert.equal(l.spoolMaterial, undefined);
  assert.equal(l.guess.spoolMaterial.value, 'plastic');
  assert.equal(l.guess.spoolMaterial.from, 'photo');

  // a surer text / label guess is not replaced by a weaker photo; a weaker one is
  l = listing({ guess: { spoolMaterial: { value: 'cardboard', confidence: 0.7, from: 'your labels', n: 4 } } });
  await P.applyPhotoReadings([l], { read: fake({ [l.image]: unsure }) });
  assert.equal(l.guess.spoolMaterial.from, 'your labels', 'the 0.7 label guess is as sure as the 0.7 photo: it stays');
  l = listing({ guess: { spoolMaterial: { value: 'plastic', confidence: 0.6, from: 'your labels', n: 2 } } });
  await P.applyPhotoReadings([l], { read: fake({ [l.image]: board }) });
  assert.equal(l.spoolMaterial, 'cardboard', 'a sure photo beats a weak guess');

  // gradients take the stops; a single colour takes the tone; printers and photo-less listings are left alone
  const tri = ['#d83a2e', '#f2c61c', '#2f6fd6'];
  const gradientReading = P.readPixels(spoolPixels({ ringAt: (a) => tri[Math.min(2, Math.floor(((a + Math.PI) / (2 * Math.PI)) * 3))] }));
  l = listing({ multicolor: true });
  await P.applyPhotoReadings([l], { read: fake({ [l.image]: gradientReading }) });
  assert.equal(l.colorHexes.length, 3, 'three stops');
  assert.equal(l.colorHexSource, 'photo');
  const printer = { kind: 'printer', image: 'https://img.test/p.png' };
  const noPhoto = { kind: 'filament', image: '' };
  await P.applyPhotoReadings([printer, noPhoto], { read: async () => { throw new Error('must not be read'); } });
  assert.equal(printer.guess, undefined);
  assert.equal(noPhoto.guess, undefined);

  // ---- the real path: download, decode, read, cache ---------------------------------------------------------------------
  let chromium;
  try { ({ chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')); void chromium; } catch (_) { console.log('SKIP the real path: playwright is not available in this environment'); fs.rmSync(tmp, { recursive: true, force: true }); return; }
  let hits = 0;
  const photo = png(spoolPixels({ ring: '#2f9e57', flange: '#b28b5c', hub: '#b9976a' }));
  const server = http.createServer((req, res) => { hits++; res.writeHead(200, { 'content-type': 'image/png' }); res.end(photo); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = 'http://127.0.0.1:' + server.address().port + '/spool-photo.png';
  try {
    P.resetStore();
    let live = listing({ image: url });
    await P.applyPhotoReadings([live], {});
    assert.equal(hits, 1, 'downloaded once');
    assert.equal(live.spoolMaterial, 'cardboard', 'read from the real picture: ' + JSON.stringify(live.guess));
    assert.ok(deltaE(live.colorHex, '#2f9e57') < 10, 'tone ' + live.colorHex);
    assert.ok(fs.existsSync(process.env.PHOTO_READINGS_FILE), 'the answer is remembered on disk');
    P.resetStore();
    live = listing({ image: url });
    await P.applyPhotoReadings([live], {});
    assert.equal(hits, 1, 'a second run does not download the same photo again');
    assert.equal(live.spoolMaterial, 'cardboard');
    // an unreachable photo is not cached as unusable: it is tried again next time
    P.resetStore();
    const gone = listing({ image: 'http://127.0.0.1:1/never.png' });
    await P.applyPhotoReadings([gone], {});
    assert.equal(gone.guess, undefined, 'nothing read');
    P.resetStore();
    assert.ok(!(gone.image in JSON.parse(fs.readFileSync(process.env.PHOTO_READINGS_FILE, 'utf8'))), 'the failure was not remembered');
  } finally {
    server.close();
    await require('../lib/image-match.cjs').shutdown();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log('PASS: the run reads each filament photo once (tone or gradient stops, spool material), fills only what nobody set, keeps weak readings as hints, and remembers the answer per photo.');
})().catch((e) => { console.error(e); process.exit(1); });
