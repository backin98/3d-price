// Shop runs and Uncertain draw a page of cards at a time (12 / 24 / 36 / 48 or all), in a real browser:
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
const singles = Array.from({ length: 50 }, (_, i) => card({
  url: FM + '/single-' + i, name: 'Single Spool Model ' + String(i).padStart(2, '0') + ' PLA Filament', brand: 'Brand' + i,
  price: 300 + i, image: base + '/img/main.png'
}));
const group = colours.map((colour, i) => card({
  url: FM + '/elas-pla-pro-filament?variant=' + colour.toLowerCase(), name: 'Elas PLA Pro Filament', sourceTitle: 'Elas PLA Pro Filament - ' + colour,
  colorName: colour, brand: 'Elas', price: 449.9 + i * 10, image: '/img/main.png', optionThumb: '/img/opt-' + colour.toLowerCase() + '.png', variantOf: FM + '/elas-pla-pro-filament'
}));
const posts = [];
const payload = () => ({
  configured: true,
  desk: { shops: [{ id: 'filamentmarketim.com', name: 'Filament Marketim', url: FM, enabled: true, categories: [{ id: 'fil', name: 'Filament', url: FM + '/filament' }] }], banners: [], promoted: [] },
  candidate: { products: [], filaments: [] }, heartbeat: null, counts: { products: 0, filaments: 0 },
  baseline: { categories: [{ id: 'filaments', name: 'Filament' }], items: [] },
  catalog: { savedAt: new Date().toISOString(), products: [], filaments: [] },
  jobs: [{ id: 'job-fm', url: FM + '/filament', site: 'filamentmarketim.com', status: 'done', events: [...singles, ...group] }]
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
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('dialog', (d) => d.accept());
    await page.goto(base + '/#runs', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#review-board .review-card', { timeout: 15000 });
    const cards = () => page.locator('#review-board .review-card').count();
    const info = () => page.locator('#review-board .pager').first().locator('span.muted').first().innerText();
    // A numbered button of the first pager of a list (the Next button also points at a page number).
    const goPage = (scope, n) => page.locator(scope + ' .pager').first().locator('.pager-pages button', { hasText: new RegExp('^' + n + '$') }).click();

    // Lazy tabs: the tab on screen is drawn, the others when opened.
    assert.equal((await page.locator('#tab-overview').innerHTML()).trim(), '', 'a hidden tab is not drawn up front');

    // 24 + 24 + 3.
    assert.equal(await cards(), 24, 'the first page has 24 cards');
    assert.match(await info(), /Showing 1–24 of 51 cards/);
    const first = await page.locator('#review-board .review-card').first().getAttribute('data-uncertain-url');
    await goPage('#review-board', 2);
    assert.equal(await cards(), 24);
    assert.match(await info(), /Showing 25–48 of 51 cards/);
    assert.notEqual(await page.locator('#review-board .review-card').first().getAttribute('data-uncertain-url'), first, 'page 2 has other cards');

    // The group sits whole on page 3 and its dots still flip the photo.
    await goPage('#review-board', 3);
    assert.match(await info(), /Showing 49–51 of 51 cards/);
    assert.equal(await page.locator('#review-board .option-group').count(), 1, 'the group is drawn');
    assert.equal(await page.locator('#review-board .option-group > .opt-member').count(), 3, 'with all 3 colours');
    const shown = '#review-board .option-group > .opt-member:not(.opt-hidden)';
    const firstShown = await page.locator(shown).first().getAttribute('data-opt-index');
    await page.locator('#review-board [data-opt-dot="2"]').click();
    assert.notEqual(await page.locator(shown).first().getAttribute('data-opt-index'), firstShown, 'a dot shows another colour');

    // Per page: 12, 48, all; kept after a reload.
    await page.locator('#review-board .pager').first().locator('[data-pager-size]').selectOption('12');
    assert.equal(await cards(), 12);
    assert.match(await info(), /Showing 1–12 of 51 cards/);
    await page.locator('#review-board .pager').first().locator('[data-pager-size]').selectOption('48');
    assert.equal(await cards(), 48);
    await page.locator('#review-board .pager').first().locator('[data-pager-size]').selectOption('0');
    assert.equal(await cards(), 53, 'all 53 listings (50 singles + 3 colours)');
    assert.match(await info(), /Showing all 51 cards/);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#review-board .review-card', { timeout: 15000 });
    assert.equal(await cards(), 53, 'All is remembered');
    await page.locator('#review-board .pager').first().locator('[data-pager-size]').selectOption('24');
    assert.equal(await cards(), 24);

    // Select all takes the whole run, not the page.
    await page.locator('#select-all').click();
    assert.match(await page.locator('#publish-selected').innerText(), /\(53\)/, 'every card of the run is selected');
    assert.equal(await page.locator('#review-board .review-card.is-selected').count(), 24, 'and the cards on screen show it');
    await goPage('#review-board', 2);
    assert.equal(await page.locator('#review-board .review-card.is-selected').count(), 24, 'page 2 draws its cards selected too');
    // Save & publish selected sends every selected card, the ones on other pages too.
    await page.locator('#publish-selected').click();
    await page.waitForFunction(() => /\(0\)/.test(document.getElementById('publish-selected').textContent), null, { timeout: 15000 });
    const sent = posts.filter((b) => b.action === 'publishSelected').pop();
    const sentUrls = [...sent.placements, ...sent.deferred].map((x) => x.url);
    assert.equal(sentUrls.length, 53, 'all 53 selected listings are sent, not only the 24 on screen');
    assert.equal(new Set(sentUrls).size, 53);
    assert.ok(sentUrls.some((u) => /single-49$/.test(u)) && sentUrls.some((u) => /variant=lacivert/.test(u)), 'including cards from the last page');
    assert.ok(sent.deferred.every((x) => x.card && x.card.polymer === 'pla' && x.card.brand), 'cards off screen carry the fields a drawn card works out');

    // Search looks through every card; clearing it brings the pages back.
    await page.fill('#review-search', 'lacivert');
    await page.waitForFunction(() => /1 of 53 cards|1 of 51 cards/.test(document.getElementById('review-search-info').textContent), null, { timeout: 5000 });
    assert.equal(await page.locator('#review-board .review-card:not([hidden])').count(), 1, 'the one colour that matches is found on a page that was not on screen');
    await page.fill('#review-search', '');
    await page.waitForFunction(() => document.querySelectorAll('#review-board .review-card').length === 24, null, { timeout: 5000 });

    // The Uncertain tab pages too, and a hidden tab is drawn when opened.
    await page.evaluate(() => { location.hash = '#uncertain'; });
    await page.waitForSelector('#tab-uncertain .pager', { timeout: 5000 });
    assert.equal(await page.locator('#tab-uncertain .uncertain-card').count(), 24, 'Uncertain: first page of 24');
    await goPage('#tab-uncertain', 3);
    assert.equal(await page.locator('#tab-uncertain .option-group').count(), 1);
    // Force publish all takes every waiting card, not the page on screen.
    const before = posts.filter((b) => b.action === 'publishSelected').length;
    await page.locator('#uncertain-publish-all').click();
    await page.waitForFunction((n) => true, before, { timeout: 1000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const forced = posts.filter((b) => b.action === 'publishSelected').slice(before).pop();
    assert.ok(forced, 'Force publish all posted');
    assert.equal(forced.placements.length, 53, 'all 53 waiting cards, not the 24 of one page');

    assert.deepEqual(errors, [], 'no page errors: ' + errors.join(' | '));
    console.log('PASS: Shop runs and Uncertain draw 12 / 24 / 36 / 48 or all cards per page (kept after reload), groups stay whole, Select all spans every page, search finds cards on any page, and only the open tab is drawn.');
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
