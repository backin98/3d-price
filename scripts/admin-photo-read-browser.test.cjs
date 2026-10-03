// "Read photos (this page)" and the 📷 on the spool field, in a real browser, on synthetic spool photos:
//   - a cardboard-flange spool gets cardboard and its filament's tone; a black-flange spool gets plastic and its tone;
//   - a shade you eyedropped and a spool type you set are left alone; a card without a photo is skipped;
//   - what the photo fills is saved as "from the photo" (so it never teaches the rules as if you had chosen it), and choosing
//     the spool yourself afterwards clears that mark.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const zlib = require('node:zlib');

const ROOT = path.join(__dirname, '..', 'public');
const FM = 'https://www.filamentmarketim.com';
const W = 96;
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
function spool({ ring, flange, hub }) {
  const px = new Uint8ClampedArray(W * W * 4);
  const c = W / 2;
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const d = Math.hypot(x - c, y - c);
    let rgb = [255, 255, 255];
    if (d <= 44 && d > 34) rgb = rgbOf(flange);
    else if (d <= 34 && d > 14) { const shade = 0.78 + 0.22 * ((d - 14) / 20); rgb = rgbOf(ring).map((v) => Math.round(v * shade)); }
    else if (d <= 14 && hub) rgb = rgbOf(hub);
    const o = (y * W + x) * 4; px[o] = rgb[0]; px[o + 1] = rgb[1]; px[o + 2] = rgb[2]; px[o + 3] = 255;
  }
  return px;
}
const PHOTOS = {
  '/img/board-blue.png': png(spool({ ring: '#2e6fd0', flange: '#b28b5c', hub: '#b9976a' })),
  '/img/plastic-red.png': png(spool({ ring: '#c0392b', flange: '#262626' })),
  '/img/board-cream.png': png(spool({ ring: '#2f9e57', flange: '#a97c50', hub: '#b9976a' }))
};

let base = '';
const posts = [];
const card = (slug, name, extra) => ({ type: 'card', decision: { action: 'held', reason: 'no baseline model' }, card: { url: FM + '/' + slug, name, sourceTitle: name, kind: 'filament', brand: 'Acme', polymer: 'pla', weight: '1000 g', diameter: '1.75 mm', price: 500, colorName: name.split(' ').pop(), color: name.split(' ').pop().toLowerCase(), ...extra } });
const payload = () => ({
  configured: true,
  desk: { shops: [{ id: 'filamentmarketim.com', name: 'Filament Marketim', url: FM, enabled: true, categories: [{ id: 'fil', name: 'Filament', url: FM + '/filament' }] }], banners: [], promoted: [] },
  candidate: { products: [], filaments: [] }, heartbeat: null, counts: { products: 0, filaments: 0 },
  baseline: { categories: [{ id: 'filaments', name: 'Filament' }], items: [] },
  catalog: { savedAt: new Date().toISOString(), products: [], filaments: [] },
  jobs: [{ id: 'job-fm', url: FM + '/filament', site: 'filamentmarketim.com', status: 'done', events: [
    card('a', 'Acme Alpha PLA Filament - Blue', { image: base + '/img/board-blue.png' }),
    card('b', 'Acme Beta PLA Filament - Red', { image: base + '/img/plastic-red.png', brand: 'Beta' }),
    card('c', 'Acme Gamma PLA Filament - Green', { image: base + '/img/board-blue.png', brand: 'Gamma', colorHex: '#123456', colorHexSource: 'eyedropper', spoolMaterial: 'plastic' }),
    card('d', 'Acme Delta PLA Filament - Black', { image: '', brand: 'Delta' }),
    card('e', 'Acme Epsilon PLA Filament - Cream', { image: base + '/img/board-cream.png', brand: 'Epsilon' })
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
    await page.goto(base + '/#runs', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#review-board .review-card', { timeout: 15000 });
    const cardOf = (slug) => page.locator('#review-board .review-card[data-uncertain-url="' + FM + '/' + slug + '"]');
    const hexes = async (slug) => ((await cardOf(slug).locator('.colour-row').getAttribute('data-hexes')) || '').split(',').filter(Boolean);
    const spoolOf = (slug) => cardOf(slug).locator('[data-uncertain-field="spoolMaterial"]').inputValue();

    assert.equal(await spoolOf('a'), '', 'nothing is set before the photos are read');
    await page.locator('#read-photos').click();
    await page.waitForFunction(() => /Photos read:/.test(document.getElementById('toast').textContent), null, { timeout: 20000 });

    // the cardboard spool
    assert.equal(await spoolOf('a'), 'cardboard', 'a kraft flange is cardboard');
    assert.ok(deltaE((await hexes('a'))[0], '#2e6fd0') < 10, 'the tone of the filament: ' + (await hexes('a')));
    assert.equal(await cardOf('a').getAttribute('data-spool-source'), 'photo');
    assert.match(await cardOf('a').locator('.learned-notes').innerText(), /read from the photo/);
    // the plastic one
    assert.equal(await spoolOf('b'), 'plastic', 'a black flange is plastic');
    assert.ok(deltaE((await hexes('b'))[0], '#c0392b') < 10, 'red tone: ' + (await hexes('b')));
    // yours are left alone
    assert.deepEqual(await hexes('c'), ['#123456'], 'the shade you eyedropped stays');
    assert.equal(await spoolOf('c'), 'plastic', 'the spool type you set stays (the photo says cardboard)');
    assert.equal(await cardOf('c').getAttribute('data-spool-source'), '');
    // no photo: skipped, nothing invented
    assert.equal(await spoolOf('d'), '');
    assert.match(await page.locator('#toast').textContent(), /without a photo/);

    // saved as photo picks
    await page.waitForTimeout(1500);
    const patch = (slug) => posts.filter((b) => b.action === 'updateUncertainCard' && b.url === FM + '/' + slug).pop();
    assert.equal(patch('a').patch.spoolSource, 'photo', 'saved as read from the photo');
    assert.equal(patch('a').patch.colorHexSource, 'photo');
    assert.equal(patch('c'), undefined, 'a card the photos did not change is not saved');

    // choosing the spool yourself ends "from the photo"
    await cardOf('a').locator('[data-uncertain-field="spoolMaterial"]').selectOption('plastic');
    await page.waitForTimeout(1500);
    assert.equal(await cardOf('a').getAttribute('data-spool-source'), '', 'your choice is yours');
    assert.equal(patch('a').patch.spoolSource, '');
    assert.equal(patch('a').patch.spoolMaterial, 'plastic');

    // the 📷 on one card
    assert.equal(await spoolOf('e'), 'cardboard', 'the bulk read filled this one too');
    await cardOf('e').locator('[data-uncertain-field="spoolMaterial"]').selectOption('');
    assert.equal(await spoolOf('e'), '');
    await cardOf('e').locator('[data-spool-from-photo]').click();
    await page.waitForFunction(() => /Spool: cardboard from the photo/.test(document.getElementById('toast').textContent), null, { timeout: 8000 });
    assert.equal(await spoolOf('e'), 'cardboard');
    assert.equal(await cardOf('e').getAttribute('data-spool-source'), 'photo');

    assert.deepEqual(errors, [], 'no page errors: ' + errors.join(' | '));
    console.log('PASS: Read photos fills the true tone and the spool material from each photo, leaves your eyedropper pick and your spool choice alone, marks what it filled as from the photo, and the 📷 reads one card.');
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
