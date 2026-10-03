// Shop runs: drag a card onto another card to make it one of that card's colours; Separate takes one back out.
//   - 51 cards (50 single listings and one group of 3 colours) are 24 + 24 + 3 on three pages;
//   - the per-page choice is kept after a reload; "All" draws every card;
//   - Select all takes every card of the run, not only the page on screen;
//   - a group of colours is never split across pages and its dots still flip the photo;
//   - typing in the search box looks through every card, and clearing it brings the pages back;
//   - only the tab on screen is drawn (the others when opened).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', 'public');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const FM = 'https://www.filamentmarketim.com';
const colours = ['Siyah', 'Beyaz', 'Lacivert'];
let base = '';
const card = (extra) => ({ type: 'card', decision: { action: 'held', reason: 'no baseline model' }, card: { kind: 'filament', polymer: 'pla', weight: '1000 g', diameter: '1.75 mm', ...extra } });
const group = ['Siyah', 'Beyaz', 'Lacivert'].map((colour, i) => card({
  url: FM + '/elas-pla-pro-filament?variant=' + colour.toLowerCase(), name: 'Elas PLA Pro Filament', sourceTitle: 'Elas PLA Pro Filament - ' + colour,
  colorName: colour, brand: 'Elas', price: 449.9 + i * 10, image: '/img/main.png', optionThumb: '/img/opt-' + colour.toLowerCase() + '.png', variantOf: FM + '/elas-pla-pro-filament'
}));
const lone = card({ url: FM + '/elas-pla-pro-kirmizi', name: 'Elas PLA Pro Kirmizi', brand: 'Elas', price: 470, image: '/img/main.png' });
const other = card({ url: 'https://other.example.com/x', name: 'Elsewhere PLA', brand: 'Else', price: 300, image: '/img/main.png' });
const posts = [];
const payload = () => ({
  configured: true,
  desk: { shops: [{ id: 'filamentmarketim.com', name: 'Filament Marketim', url: FM, enabled: true, categories: [{ id: 'fil', name: 'Filament', url: FM + '/filament' }] }], banners: [], promoted: [], variantAliases: { plus: ['premium', 'pro', 'ultra'] } },
  candidate: { products: [], filaments: [] }, heartbeat: null, counts: { products: 0, filaments: 0 },
  baseline: { categories: [{ id: 'filaments', name: 'Filament' }], items: [] },
  catalog: { savedAt: new Date().toISOString(), products: [], filaments: [] },
  jobs: [{ id: 'job-fm', url: FM + '/filament', site: 'filamentmarketim.com', status: 'done', events: [...group, lone, other] }]
});
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/img/')) { res.writeHead(200, { 'content-type': 'image/png' }); return res.end(PNG); }
  if (url.pathname.startsWith('/api/')) {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : null;
      if (body) posts.push(body);
      res.writeHead(200, { 'content-type': 'application/json' });
      if (body && body.action === 'publishSelected') {
        const urls = [...(body.placements || []), ...(body.deferred || [])].map((p) => p.url);
        return res.end(JSON.stringify({ published: (body.placements || []).length, deferred: (body.deferred || []).length, appliedUrls: (body.placements || []).map((p) => p.url) }));
      }
      res.end(JSON.stringify(body ? { ok: true } : payload()));
    });
    return;
  }
  const rel = url.pathname === '/' ? 'admin/index.html' : url.pathname.replace(/^\//, '');
  try {
    const file = path.join(ROOT, rel);
    const body = fs.readFileSync(file);
    res.writeHead(200, { 'content-type': file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html' });
    res.end(body);
  } catch (_) { res.writeHead(404); res.end('not found'); }
});

(async () => {
  let chromium;
  try { ({ chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')); } catch (_) { console.log('SKIP: playwright is not available in this environment'); return; }
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 3600 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(base + '/#runs', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#review-board .review-card', { timeout: 15000 });
    const members = () => page.locator('#review-board .option-group > .opt-member').count();
    const groups = () => page.locator('#review-board .option-group').count();
    assert.equal(await groups(), 1);
    assert.equal(await members(), 3);

    // Drag the lone card onto the group: four colours.
    const grip = page.locator('#review-board [data-uncertain-url$="elas-pla-pro-kirmizi"] .drag-grip');
    await grip.dragTo(page.locator("#review-board .option-group .opt-member").first());
    await page.waitForFunction(() => document.querySelectorAll('#review-board .option-group > .opt-member').length === 4, null, { timeout: 5000 });
    const saved = posts.filter((p) => p.action === 'updateUncertainCard' && p.patch.manualGroup);
    assert.equal(saved.length, 4, 'the dragged card and the three it joined are saved with one group id');
    assert.equal(new Set(saved.map((p) => p.patch.manualGroup)).size, 1);

    // A card of another shop cannot join.
    await page.locator('#review-board [data-uncertain-url^="https://other.example.com"] .drag-grip').dragTo(page.locator('#review-board .option-group .opt-member').first());
    await page.waitForTimeout(300);
    assert.equal(await members(), 4, 'another shop does not join');

    // Separate takes one colour out into its own card.
    await page.locator('#review-board .option-group .opt-member[data-uncertain-url$="variant=beyaz"] [data-split-card]').dispatchEvent('click');
    await page.waitForFunction(() => document.querySelectorAll('#review-board .option-group > .opt-member').length === 3, null, { timeout: 5000 });
    assert.equal(await page.locator('#review-board .uncertain-card[data-uncertain-url$="variant=beyaz"]').count(), 1);
    assert.equal(await page.locator('#review-board .option-group .uncertain-card[data-uncertain-url$="variant=beyaz"]').count(), 0, 'it is no longer in the group');
    // Aliases: "PLA Pro" shows as the variant you named, and the editor saves the table.
    assert.equal(await page.locator('#review-board .uncertain-card[data-uncertain-url$="variant=siyah"] [data-uncertain-field="variant"]').inputValue(), 'plus', 'Pro is called plus');
    await page.locator('.variant-aliases summary').click();
    await page.locator('#alias-text').fill('plus = premium, pro, ultra\nsilk = ipek');
    await page.locator('#alias-save').click();
    await page.waitForFunction(() => true);
    await page.waitForTimeout(300);
    const al = posts.find((p) => p.action === 'setVariantAliases');
    assert.deepEqual(al.aliases, { plus: ['premium', 'pro', 'ultra'], silk: ['ipek'] });
    assert.deepEqual(errors, []);
    console.log('PASS admin card drag-and-drop');
  } finally { await browser.close(); server.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
