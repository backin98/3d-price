// The triangle bug, verified in a real browser: open a disclosure, let the 5s poll run twice,
// and check the DOM still has it open. A unit test called rememberDetails with the wrong
// argument shape and passed while the browser was still broken, so this one drives the page.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const ADMIN = path.join(__dirname, '..', 'public'); // the site root, as Netlify serves it
const payload = {
  configured: true,
  desk: { shops: [
    { id: 'alpha.example', name: 'Alpha', url: 'https://alpha.example', enabled: true, categories: [{ id: 'a-printers', name: '3D Printers', url: 'https://alpha.example/printers' }] },
    { id: 'beta.example', name: 'Beta', url: 'https://beta.example', enabled: true, categories: [{ id: 'b-printers', name: '3D Printers', url: 'https://beta.example/printers' }] }
  ], banners: [], promoted: [] },
  candidate: { products: [], filaments: [] },
  jobs: [],
  heartbeat: null,
  counts: { products: 1, filaments: 0 },
  catalog: {
    savedAt: new Date().toISOString(),
    products: [{
      id: 'qwen-k2', name: 'Creality K2 Combo 3D Yazıcı', brand: 'Creality', kind: 'printer', aisle: 'fdm', price: 32384.81,
      axes: { combo: true, ams: '', variant: '', mini: false, laser: '', label: 'Combo' },
      offers: [{ store: 'rhino3dprinter.com', price: 32384.81, url: 'https://www.rhino3dprinter.com/creality-k2-combo-3d-yazici', sourceTitle: 'Creality K2 Combo 3D Yazıcı', stockStatus: 'in_stock' }]
    }],
    filaments: []
  }
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(payload));
    return;
  }
  const rel = url.pathname === '/' ? 'admin/index.html' : url.pathname.replace(/^\//, '');
  const file = path.join(ADMIN, rel);
  try {
    const body = fs.readFileSync(file);
    res.writeHead(200, { 'content-type': file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html' });
    res.end(body);
  } catch (_) {
    res.writeHead(404);
    res.end('not found');
  }
});

(async () => {
  let chromium;
  try {
    ({ chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright'));
  } catch (_) {
    console.log('SKIP: playwright is not available in this environment');
    return;
  }
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto('http://127.0.0.1:' + port + '/#runs', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#add-shop-row', { timeout: 15000 });

    await page.selectOption('#run-shop', 'alpha.example');
    await page.selectOption('#run-cat', { label: '3D Printers' });
    await page.click('#add-shop-row');
    assert.equal(await page.locator('#run-rows .run-row').count(), 2, 'plus adds a second run menu');
    assert.equal(await page.locator('#run-rows .run-shop').nth(1).inputValue(), '', 'the new menu asks the user to choose a shop');
    await page.locator('#run-rows .run-shop').nth(1).selectOption('beta.example');
    await page.locator('#run-rows .run-cat').nth(1).selectOption({ label: '3D Printers' });
    await page.locator('#run-rows .run-row').nth(1).locator('[data-move-run="up"]').click();
    assert.equal(await page.locator('#run-rows .run-shop').nth(0).inputValue(), 'beta.example', 'up arrow changes the execution order');
    let review = '';
    page.once('dialog', async (dialog) => { review = dialog.message(); await dialog.dismiss(); });
    await page.click('#run-all');
    assert.match(review, /1\. Beta[\s\S]*2\. Alpha/, 'Run all reviews the chosen order before starting');

    await page.evaluate(() => { location.hash = '#catalog'; });
    await page.waitForSelector('[data-detail-key="offers:qwen-k2"]', { timeout: 15000 });

    const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=', 'base64');
    await page.setInputFiles('[data-product-image="qwen-k2"]', { name: 'thumbnail.png', mimeType: 'image/png', buffer: pixel });
    await page.waitForFunction(() => window.test.state.pendingImages.has('qwen-k2'));
    assert.match(await page.$eval('[data-product-id="qwen-k2"] .catalog-thumb img', (el) => el.src), /^data:image\/webp/, 'the upload is resized and previewed before Save');

    // Open the offer panel the way a person does.
    assert.equal(await page.evaluate(() => typeof window.__keepOpen), 'function', 'the inline handler is wired');
    await page.click('[data-detail-key="offers:qwen-k2"] > summary');
    assert.equal(await page.$eval('[data-detail-key="offers:qwen-k2"]', (el) => el.open), true, 'it opens');
    // "toggle" is fired as a task, so wait for the state rather than asserting in the same tick.
    await page.waitForFunction(() => window.test && window.test.state.openDetails.has('offers:qwen-k2'), null, { timeout: 5000 })
      .catch(() => assert.fail('opening was never remembered in state — the inline ontoggle did not record it'));

    // Idle polls must not touch the DOM. The load-time render does replace the panel once (a
    // changed payload), so let that settle first, then mark the element and watch it survive.
    await page.waitForTimeout(6000); // the first poll
    await page.evaluate(() => { document.querySelector('[data-detail-key="offers:qwen-k2"]').dataset.marked = 'mine'; });
    await page.waitForTimeout(12000); // two more poll cycles
    assert.equal(await page.$eval('[data-detail-key="offers:qwen-k2"]', (el) => el.dataset.marked), 'mine', 'idle polls left the panel alone');
    assert.equal(await page.$eval('[data-detail-key="offers:qwen-k2"]', (el) => el.open), true, 'still open after two polls');

    // And it still closes when asked, surviving another poll.
    await page.click('[data-detail-key="offers:qwen-k2"] > summary');
    await page.waitForFunction(() => window.test && !window.test.state.openDetails.has('offers:qwen-k2'), null, { timeout: 5000 })
      .catch(() => assert.fail('closing was never remembered in state'));
    assert.equal(await page.$eval('[data-detail-key="offers:qwen-k2"]', (el) => el.open), false, 'closes on click');
    await page.waitForTimeout(7000);
    assert.equal(await page.$eval('[data-detail-key="offers:qwen-k2"]', (el) => el.open), false, 'and stays closed across a poll');

    assert.deepEqual(errors, [], 'no page errors: ' + errors.join(' | '));
    console.log('PASS: in a real browser the offers disclosure stays open across polls, and stays closed when closed.');
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
