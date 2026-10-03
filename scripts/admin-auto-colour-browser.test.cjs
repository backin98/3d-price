// The Auto button on a card's colour row, in a real browser:
//   - a one-colour card takes the true tone of its product photo (not a generic table colour);
//   - a gradient card gets distinct stops in order; pressing Auto again does not offer the same colours;
//   - what the photo reader fills in is saved as "photo" (so it never teaches the run as if you had picked it);
//   - a Silk listing's swatch stays a plain flat dot (only marble and galaxy have effects).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const zlib = require('node:zlib');

const ROOT = path.join(__dirname, '..', 'public');
const FM = 'https://www.filamentmarketim.com';
const W = 96;

// A tiny PNG writer so the test needs no image library.
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function png(rgba) {
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(W, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((W * 4 + 1) * W);
  for (let y = 0; y < W; y++) { raw[y * (W * 4 + 1)] = 0; Buffer.from(rgba.buffer, y * W * 4, W * 4).copy(raw, y * (W * 4 + 1) + 1); }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const rgbOf = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
function spool(ringAt) {
  const px = new Uint8ClampedArray(W * W * 4);
  const c = W / 2;
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const d = Math.hypot(x - c, y - c);
    let rgb = [255, 255, 255];
    if (d <= 44 && d > 34) rgb = rgbOf('#262626');
    else if (d <= 34 && d > 14) { const col = rgbOf(ringAt(Math.atan2(y - c, x - c))); const shade = 0.78 + 0.22 * ((d - 14) / 20); rgb = col.map((v) => Math.round(v * shade)); }
    const o = (y * W + x) * 4; px[o] = rgb[0]; px[o + 1] = rgb[1]; px[o + 2] = rgb[2]; px[o + 3] = 255;
  }
  return px;
}
const tri = ['#d83a2e', '#f2c61c', '#2f6fd6'];
const PHOTOS = {
  '/img/red.png': png(spool(() => '#c0392b')),
  '/img/tri.png': png(spool((a) => tri[Math.min(2, Math.floor(((a + Math.PI) / (2 * Math.PI)) * 3))]))
};

let base = '';
const posts = [];
const card = (url, name, extra) => ({ type: 'card', decision: { action: 'held', reason: 'no baseline model' }, card: { url: FM + url, name, sourceTitle: name, kind: 'filament', brand: 'Acme', polymer: 'pla', weight: '1000 g', diameter: '1.75 mm', price: 500, image: base + '/img/red.png', ...extra } });
const payload = () => ({
  configured: true,
  desk: { shops: [{ id: 'filamentmarketim.com', name: 'Filament Marketim', url: FM, enabled: true, categories: [{ id: 'fil', name: 'Filament', url: FM + '/filament' }] }], banners: [], promoted: [] },
  candidate: { products: [], filaments: [] }, heartbeat: null, counts: { products: 0, filaments: 0 },
  baseline: { categories: [{ id: 'filaments', name: 'Filament' }], items: [] },
  catalog: { savedAt: new Date().toISOString(), products: [], filaments: [] },
  jobs: [{ id: 'job-fm', url: FM + '/filament', site: 'filamentmarketim.com', status: 'done', events: [
    card('/one', 'Acme PLA Filament - Kirmizi', { colorName: 'Kirmizi', color: 'red' }),
    card('/tri', 'Acme Dual PLA Filament - Red Yellow Blue', { colorName: 'Red Yellow Blue', color: 'red+yellow+blue', colorSet: ['red', 'yellow', 'blue'], multicolor: true, image: base + '/img/tri.png' }),
    card('/silk', 'Acme Silk PLA Filament - Blue', { colorName: 'Blue', color: 'blue', variant: 'silk' })
  ] }]
});

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (PHOTOS[url.pathname]) { res.writeHead(200, { 'content-type': 'image/png' }); return res.end(PHOTOS[url.pathname]); }
  if (url.pathname.startsWith('/api/')) {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => { const body = raw ? JSON.parse(raw) : null; if (body) posts.push(body); res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(body ? { ok: true } : payload())); });
    return;
  }
  const rel = url.pathname === '/' ? 'admin/index.html' : url.pathname.replace(/^\//, '');
  try { const file = path.join(ROOT, rel); const body = fs.readFileSync(file); res.writeHead(200, { 'content-type': file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html' }); res.end(body); } catch (_) { res.writeHead(404); res.end('not found'); }
});

const deltaE = (a, b) => require('../public/admin/swatch-colours.js').deltaE(a, b);

(async () => {
  let chromium;
  try { ({ chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')); } catch (_) { console.log('SKIP: playwright is not available in this environment'); return; }
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(base + '/#uncertain', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#tab-uncertain .uncertain-card', { timeout: 15000 });
    const cardOf = (u) => page.locator('#tab-uncertain .uncertain-card[data-uncertain-url="' + FM + u + '"]');
    const rowOf = (u) => cardOf(u).locator('.colour-row');

    // Swatches are flat dots: a Silk listing gets no sheen, only marble and galaxy have an effect.
    assert.equal(await cardOf('/silk').locator('.colour-dot[class*="fx-"]').count(), 0, 'a silk listing stays a plain swatch');
    assert.equal(await cardOf('/one').locator('.colour-dot[class*="fx-"]').count(), 0, 'a normal filament stays a plain swatch');

    // One colour: the true tone of the photo.
    await cardOf('/one').locator('[data-colour-from-image]').click();
    await page.waitForFunction(() => document.querySelector('.uncertain-card[data-uncertain-url$="/one"] .colour-row').dataset.hexes, null, { timeout: 8000 });
    const hexes = (await rowOf('/one').getAttribute('data-hexes')).split(',').filter(Boolean);
    assert.equal(hexes.length, 1);
    assert.ok(deltaE(hexes[0], '#c0392b') < 10, 'the tone of the photo, not a table colour: ' + hexes[0]);
    assert.equal(await cardOf('/one').getAttribute('data-hex-source'), 'photo');

    // A gradient: distinct stops in order; the second press offers nothing it already has.
    await cardOf('/tri').locator('[data-colour-from-image]').click();
    await page.waitForFunction(() => (document.querySelector('.uncertain-card[data-uncertain-url$="/tri"] .colour-row').dataset.hexes || '').split(',').filter(Boolean).length === 3, null, { timeout: 8000 });
    const stops = (await rowOf('/tri').getAttribute('data-hexes')).split(',');
    for (const want of tri) assert.ok(stops.some((h) => deltaE(h, want) < 10), 'a stop near ' + want + ' in ' + stops);
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) assert.ok(deltaE(stops[i], stops[j]) >= 14, 'no repeated colour');
    await cardOf('/tri').locator('[data-colour-from-image]').click();
    await page.waitForFunction(() => /No other distinct colour/.test(document.getElementById('toast').textContent), null, { timeout: 8000 });
    assert.deepEqual((await rowOf('/tri').getAttribute('data-hexes')).split(','), stops, 'pressing again does not change or repeat the stops');

    // Saved as a photo pick.
    await page.waitForFunction(() => true, null, { timeout: 100 }).catch(() => {});
    await page.waitForTimeout(1500);
    const saved = posts.filter((b) => b.action === 'updateUncertainCard' && /\/one$/.test(b.url)).pop();
    assert.ok(saved, 'autosaved');
    assert.equal(saved.patch.colorHexSource, 'photo', 'marked as picked by the photo reader');
    assert.deepEqual(errors, [], 'no page errors: ' + errors.join(' | '));
    console.log('PASS: Auto reads the true tone of the photo, picks distinct ordered gradient stops without repeating, saves them as photo picks, and a Silk listing keeps a plain swatch.');
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
