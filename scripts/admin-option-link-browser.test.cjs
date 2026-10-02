// The colours of one card are one product, checked in a real browser on the Uncertain tab:
//   - a click on a colour dot shows that colour's own picture on the card;
//   - linked colours (the default) take what is set on one of them (polymer here), and Save & publish on
//     one saves and publishes all linked colours;
//   - a colour with its link broken (a cardboard spool among plastic ones) keeps its own settings and is
//     left out of the others' Save & publish.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', 'public');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const FM = 'https://www.filamentmarketim.com';
const colours = ['Siyah', 'Beyaz', 'Lacivert'];
let base = '';
const posts = [];
const payload = () => ({
  configured: true,
  desk: { shops: [{ id: 'filamentmarketim.com', name: 'Filament Marketim', url: FM, enabled: true, categories: [{ id: 'fil', name: 'Filament', url: FM + '/filament' }] }], banners: [], promoted: [] },
  candidate: { products: [], filaments: [] },
  heartbeat: null,
  counts: { products: 0, filaments: 0 },
  baseline: { categories: [{ id: 'filaments', name: 'Filament' }], items: [] },
  catalog: { savedAt: new Date().toISOString(), products: [], filaments: [] },
  jobs: [{
    id: 'job-fm', url: FM + '/filament', site: 'filamentmarketim.com', status: 'done',
    events: colours.map((colour, i) => ({
      type: 'card', decision: { action: 'held', reason: 'no baseline model' },
      card: {
        url: FM + '/elas-pla-pro-filament?variant=' + colour.toLowerCase(), name: 'Elas PLA Pro Filament', sourceTitle: 'Elas PLA Pro Filament - ' + colour,
        colorName: colour, kind: 'filament', brand: 'Elas', polymer: 'pla', weight: '1000 g', diameter: '1.75 mm', price: 449.9 + i * 10,
        image: base + '/img/elas-main.png', optionThumb: base + '/img/opt-' + colour.toLowerCase() + '.png', variantOf: FM + '/elas-pla-pro-filament'
      }
    }))
  }]
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
      if (body && body.action === 'publishSelected') return res.end(JSON.stringify({ published: body.placements.length, appliedUrls: body.placements.map((p) => p.url) }));
      if (body && body.action) return res.end(JSON.stringify({ ok: true }));
      res.end(JSON.stringify(payload()));
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
    await page.goto(base + '/#uncertain', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#tab-uncertain .option-group', { timeout: 15000 });
    const shown = '#tab-uncertain .option-group > .opt-member:not(.opt-hidden)';
    const thumb = () => page.locator(shown + ' .catalog-thumb img').getAttribute('src');
    assert.equal((await thumb()).replace(base, ''), '/img/opt-siyah.png', 'the first colour shows its own picture');

    // A dot shows its colour's picture on the card, not the product photo.
    await page.click('#tab-uncertain [data-opt-dot="1"]');
    assert.equal((await thumb()).replace(base, ''), '/img/opt-beyaz.png', 'the picture follows the dot');
    assert.match(await page.locator(shown + ' .thumb-colour').innerText(), /Beyaz/);

    // Linked: polymer set on Beyaz is set on Siyah and Lacivert.
    await page.fill(shown + ' [data-uncertain-field="polymer"]', 'PETG');
    const polymers = await page.$$eval('#tab-uncertain .opt-member [data-uncertain-field="polymer"]', (els) => els.map((el) => el.value));
    assert.deepEqual(polymers, ['PETG', 'PETG', 'PETG'], 'a linked edit reaches every colour');

    // Lacivert comes on a cardboard spool: break its link, then the others' edits pass it by.
    await page.click('#tab-uncertain [data-opt-dot="2"]');
    await page.click(shown + ' [data-group-link]');
    assert.equal(await page.locator(shown).getAttribute('data-group-linked'), 'false');
    await page.selectOption(shown + ' [data-uncertain-field="spoolMaterial"]', 'cardboard');
    await page.click('#tab-uncertain [data-opt-dot="0"]');
    await page.fill(shown + ' [data-uncertain-field="brand"]', 'Elas Pro');
    const brands = await page.$$eval('#tab-uncertain .opt-member [data-uncertain-field="brand"]', (els) => els.map((el) => el.value));
    assert.deepEqual(brands, ['Elas Pro', 'Elas Pro', 'Elas'], 'the unlinked colour keeps its own brand');

    // Save & publish on Siyah: Siyah and Beyaz are saved and published, Lacivert is not.
    const from = posts.length;
    await page.click(shown + ' [data-uncertain-publish]');
    await page.waitForFunction(() => document.querySelectorAll('.uncertain-card').length > 0 && !document.querySelector('[data-uncertain-publish][disabled]'));
    await page.waitForTimeout(300);
    const after = posts.slice(from);
    const pub = after.find((b) => b.action === 'publishSelected');
    assert.ok(pub, 'published');
    const short = (u) => u.replace(FM + '/elas-pla-pro-filament?variant=', '');
    assert.deepEqual(pub.placements.map((p) => short(p.url)), ['siyah', 'beyaz'], 'both linked colours published, the unlinked one not');
    assert.deepEqual(pub.placements.map((p) => [p.card.brand, p.card.polymer]), [['Elas Pro', 'PETG'], ['Elas Pro', 'PETG']]);
    const saved = after.filter((b) => b.action === 'updateUncertainCard').map((b) => short(b.url));
    assert.ok(saved.includes('siyah') && saved.includes('beyaz'), 'both linked colours saved: ' + saved.join(','));
    // The broken link was saved with Lacivert (autosave), so it stays broken after a reload.
    await page.waitForTimeout(1500);
    const lac = posts.filter((b) => b.action === 'updateUncertainCard' && short(b.url) === 'lacivert').pop();
    assert.ok(lac && lac.patch.groupLinked === false && lac.patch.spoolMaterial === 'cardboard', 'the unlinked colour saves its own state');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    server.close();
  }
  console.log('PASS: a colour dot shows that colour\'s picture; linked colours share edits and are saved and published together; an unlinked colour keeps its own settings.');
})().catch((err) => { console.error(err); server.close(); process.exitCode = 1; });
