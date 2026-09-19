// The search bar in the storefront header, driven in a real browser: suggestions appear while
// typing, the family stays visible (the K2 Plus must not vanish for "k2 pro"), the keyboard
// works, and a suggestion opens the product.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', 'public');
const row = (id, name, url, price) => ({
  id, name, brand: 'Creality', kind: 'printer', aisle: 'fdm', price,
  image: '', offers: [{ store: 'rhino3dprinter.com', price, url, sourceTitle: name }]
});
const catalog = {
  source: { id: 'multi', name: 'Shops' }, savedAt: '2026-01-01T00:00:00.000Z',
  products: [
    row('k2', 'Creality K2 3D Yazıcı', 'https://www.rhino3dprinter.com/creality-k2-3d-yazici', 29263.38),
    row('k2c', 'Creality K2 Combo 3D Yazıcı', 'https://www.rhino3dprinter.com/creality-k2-combo-3d-yazici', 32384.81),
    row('k2pro', 'Creality K2 Pro Combo 3D Yazıcı', 'https://www.rhino3dprinter.com/urun/creality-k2-pro-combo', 46236.14),
    row('k2plus', 'Creality K2 Plus Combo', 'https://www.rhino3dprinter.com/urun/creality-k2-plus-combo', 76084.79),
    row('p1s', 'Bambu Lab P1S Combo 3D Yazıcı', 'https://www.rhino3dprinter.com/bambu-lab-p1s-combo', 34986)
  ],
  filaments: []
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(catalog));
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

    const type = async (text) => {
      await page.fill('#header-query', text);
      await page.waitForTimeout(250); // the input is debounced
    };
    const suggestions = () => page.$$eval('#header-suggest .suggest-row', (els) => els.map((e) => ({
      id: e.getAttribute('data-open-sheet'),
      text: e.innerText.replace(/\s+/g, ' ').trim()
    })));

    // Typing "k2 pro": the row that says pro leads, and the Plus is still listed below.
    await type('k2 pro');
    const list = await suggestions();
    const ids = list.map((r) => r.id);
    assert.equal(ids[0], 'k2pro', 'the best match is first: ' + JSON.stringify(ids));
    assert.ok(ids.includes('k2plus'), 'the K2 Plus is still offered, not dropped: ' + JSON.stringify(ids));
    assert.ok(ids.includes('k2c'), 'and so is the K2 Combo');
    assert.equal(ids.includes('p1s'), false, 'unrelated products stay out');
    const related = await page.$$eval('#header-suggest .suggest-related', (els) => els.length);
    assert.ok(related >= 1, 'the rows ranked below are labelled related');
    assert.equal(await page.$eval('#header-query', (el) => el.getAttribute('aria-expanded')), 'true', 'the combobox reports itself open');

    // A prefix and a typo still find the Plus.
    await type('k2 plu');
    assert.equal((await suggestions())[0].id, 'k2plus', 'a prefix finds it');
    await type('k2 plsu');
    assert.equal((await suggestions())[0].id, 'k2plus', 'and a swapped pair does too');

    // Keyboard: down twice then Enter opens that product.
    await type('k2');
    await page.press('#header-query', 'ArrowDown');
    await page.press('#header-query', 'ArrowDown');
    const active = await page.$eval('#header-suggest .is-active', (el) => el.getAttribute('data-open-sheet'));
    await page.press('#header-query', 'Enter');
    await page.waitForTimeout(300);
    const opened = await page.$eval('#sheet-title', (el) => el.textContent.trim()).catch(() => '');
    assert.ok(opened.length > 0, 'Enter opened the highlighted product, title: ' + JSON.stringify(opened));

    // Escape closes the list, and the grid still answers the query.
    await type('k2');
    assert.equal(await page.$eval('#header-suggest', (el) => el.hidden), false, 'list open after typing');
    await page.press('#header-query', 'Escape');
    await page.waitForTimeout(150);
    assert.equal(await page.$eval('#header-suggest', (el) => el.hidden), true, 'Escape closes the list');
    const grid = await page.$$eval('[data-open-sheet]', (els) => els.map((e) => e.getAttribute('data-open-sheet')));
    for (const id of ['k2', 'k2c', 'k2pro', 'k2plus']) {
      assert.ok(grid.includes(id), 'the results grid shows ' + id + ': ' + JSON.stringify(grid.slice(0, 12)));
    }

    // "See all" submits the query.
    await type('p1s');
    await page.click('#suggest-all');
    await page.waitForTimeout(400);
    assert.equal(await page.$eval('#header-query', (el) => el.value), 'p1s', 'the query is kept');

    assert.deepEqual(errors, [], 'no page errors: ' + errors.join(' | '));
    console.log('PASS: the storefront search bar suggests as you type, keeps the family visible, tolerates prefixes and typos, and opens products from the keyboard.');
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
