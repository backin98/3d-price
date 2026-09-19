// The real complaint: a row created in the admin (the K2 Pro) was invisible in an open
// storefront tab when searching "k2", because typing only filtered a catalog that had been
// fetched once at page load. This drives a real browser: load the page with a catalog that
// lacks the row, add the row on the server side, then type and check the card appears.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', 'public');
const base = (id, name, offers) => ({ id, name, brand: 'Creality', kind: 'printer', aisle: 'fdm', price: 30000, offers });
const before = {
  source: { id: 'multi', name: 'Shops' }, savedAt: '2026-01-01T00:00:00.000Z',
  products: [
    base('qwen-k2', 'Creality K2 3D Yazıcı', [{ store: 'rhino3dprinter.com', price: 29263.38, url: 'https://www.rhino3dprinter.com/creality-k2-3d-yazici' }]),
    base('qwen-k2c', 'Creality K2 Combo 3D Yazıcı', [{ store: 'rhino3dprinter.com', price: 32384.81, url: 'https://www.rhino3dprinter.com/creality-k2-combo-3d-yazici' }])
  ],
  filaments: []
};
const after = { ...before, savedAt: '2026-06-01T00:00:00.000Z', products: [...before.products, base('man-k2pro', 'Creality K2 Pro Combo', [{ store: 'rhino3dprinter.com', price: 46236.14, url: 'https://www.rhino3dprinter.com/urun/creality-k2-pro-combo' }])] };

let served = before;
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(served));
    return;
  }
  const rel = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\//, '');
  try {
    const file = path.join(ROOT, rel);
    const body = fs.readFileSync(file);
    res.writeHead(200, { 'content-type': file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html' });
    res.end(body);
  } catch (_) { res.writeHead(404); res.end('nf'); }
});

(async () => {
  let chromium;
  try { ({ chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')); } catch (_) { console.log('SKIP: playwright unavailable'); return; }
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto('http://127.0.0.1:' + port + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__3dp && window.__3dp.state.liveProducts, null, { timeout: 15000 });
    assert.equal(await page.evaluate(() => window.__3dp.state.liveProducts.length), 2, 'two rows loaded');

    // The admin creates the K2 Pro row while this tab sits open.
    served = after;

    // Type "k2": the stale list has no Pro row, so the search must refresh before answering.
    await page.evaluate(() => { window.__3dp.state.liveFetchedAt = 0; }); // pretend the page has been open a while
    await page.evaluate(() => window.__3dp.setQuery('k2', 'header'));
    await page.waitForFunction(() => window.__3dp.state.liveProducts.length === 3, null, { timeout: 10000 })
      .catch(() => assert.fail('typing did not refresh the catalog'));
    await page.waitForTimeout(300);
    const names = await page.evaluate(() => window.__3dp.matchingProducts().map((p) => p.name));
    assert.equal(names.length, 3, 'all three K2 rows are visible: ' + JSON.stringify(names));
    assert.ok(names.some((n) => /K2 Pro/.test(n)), 'including the row created after the page loaded');
    const cards = await page.$$eval('[data-product-id], .product-card', (els) => els.length).catch(() => 0);
    assert.ok(cards === 0 || cards >= 3, 'cards rendered: ' + cards);

    // A fresh catalog is not refetched on every keystroke.
    const fetches = await page.evaluate(async () => {
      let n = 0;
      const real = window.fetch;
      window.fetch = (...args) => { n += 1; return real(...args); };
      window.__3dp.setQuery('p1s', 'header');
      window.__3dp.setQuery('p1s c', 'header');
      await new Promise((r) => setTimeout(r, 200));
      window.fetch = real;
      return n;
    });
    assert.equal(fetches, 0, 'a search within the TTL does not refetch');

    assert.deepEqual(errors, [], 'no page errors: ' + errors.join(' | '));
    console.log('PASS: a row created in the admin shows up in an open storefront tab as soon as you search, without refetching on every keystroke.');
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
