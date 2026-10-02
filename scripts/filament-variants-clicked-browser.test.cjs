// Colour options a person has to click (a Filament Marketim run came back colourless: its product pages
// draw the options with script and change price, stock and photo only on a click, so the page HTML has
// nothing to read). lib/variant-clicker.cjs opens the page in Chromium and clicks each option. Three
// pages in scripts/fixtures/pages/variants/clicked, served locally: buttons drawn after load that change
// price, photo, cart and URL; a dropdown filled by script; swatches that link to each colour's own page.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const DIR = path.join(__dirname, 'fixtures', 'pages', 'variants', 'clicked');
const linksPage = fs.readFileSync(path.join(DIR, 'links.html'), 'utf8');
const LINKS = { siyah: ['Siyah', '399,00', 'Sepete Ekle'], beyaz: ['Beyaz', '399,00', 'Sepete Ekle'], pumpkin: ['Pumpkin', '419,00', 'Tükendi'] };
const fill = (c, [t, p, b]) => linksPage.replace('__COLOUR__', c).replace('__TITLE__', t).replace('__PRICE__', p).replace('__BUTTON__', b);
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname.startsWith('/img/')) { res.writeHead(200, { 'content-type': 'image/png' }); return res.end(Buffer.alloc(0)); }
  const m = u.pathname.match(/^\/links-(\w+)\.html$/);
  let html = null;
  if (m && LINKS[m[1]]) html = fill(m[1], LINKS[m[1]]);
  else if (u.pathname === '/links.html') html = fill('siyah', ['', '399,00', 'Sepete Ekle']);
  else if (['/buttons.html', '/select.html'].includes(u.pathname)) html = fs.readFileSync(path.join(DIR, u.pathname.slice(1)), 'utf8');
  else if (u.pathname === '/plain.html') html = '<!doctype html><html><body><header><nav class="menu"><a href="/a">PLA</a><a href="/b">PETG</a></nav></header><main><h1>Bambu Lab PLA Basic Siyah 1kg</h1><span class="price">944,69 TL</span><button>Sepete Ekle</button><div class="related-products"><a href="/x">X</a><a href="/y">Y</a></div></main><footer><a href="/c">İletişim</a><a href="/d">Kargo</a></footer></body></html>';
  if (html == null) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
});

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const { clickThroughOptions } = require('../lib/variant-clicker.cjs');
  const { variantsFromPage } = require('../lib/product-variants.cjs');
  const { listingsFromOptions, normalizeFilamentListing } = require('../lib/qwen-website-job.cjs');
  try {
    // The page HTML alone offers nothing to read: this is why the clicks are needed.
    assert.deepEqual(variantsFromPage(fs.readFileSync(path.join(DIR, 'buttons.html'), 'utf8'), base + '/buttons.html', { pagePrice: 549 }).variants, []);

    const buttons = await clickThroughOptions(base + '/buttons.html');
    assert.deepEqual(buttons.variants.map((v) => [v.label, v.price, v.stock, v.image.replace(base, ''), v.url.replace(base, '')]), [
      ['Siyah', 549, 'in_stock', '/img/elegoo-pla-siyah.png', '/buttons.html?varyant=11'],
      ['Kırmızı', 559, 'in_stock', '/img/elegoo-pla-kirmizi.png', '/buttons.html?varyant=12'],
      ['Gri', 549, 'out_of_stock', '/img/elegoo-pla-gri.png', '/buttons.html?varyant=13'],
      ['Koyu Mavi', 579, 'in_stock', '/img/elegoo-pla-koyu-mavi.png', '/buttons.html?varyant=14']
    ], 'buttons drawn after load: each click\'s price, stock, photo and URL; the related products and menus are not options');

    const select = await clickThroughOptions(base + '/select.html');
    assert.deepEqual(select.variants.map((v) => [v.label, v.price, v.stock]), [['Mint Yeşili', 589.49, 'in_stock'], ['Lacivert', 589.49, 'out_of_stock'], ['Turuncu', 599.49, 'in_stock']],
      'a colour dropdown filled by script; the quantity dropdown is left alone');

    const links = await clickThroughOptions(base + '/links.html');
    assert.deepEqual(links.variants.map((v) => [v.label, v.price, v.stock, v.url.replace(base, '')]), [['Siyah', 399, 'in_stock', '/links-siyah.html'], ['Beyaz', 399, 'in_stock', '/links-beyaz.html'], ['Pumpkin', 419, 'out_of_stock', '/links-pumpkin.html']],
      'swatches that open each colour\'s own page');

    // What the run makes of the clicks: one listing per colour in stock, each its own URL.
    const family = normalizeFilamentListing({ name: 'Filamix PLA+ Filament 1.75mm 1kg', brand: 'Filamix', kind: 'filament', url: base + '/select.html', price: 589.49, stockStatus: 'in_stock', stockVerified: true });
    const made = listingsFromOptions(family, { source: 'clicked', variants: select.variants, links: [] });
    assert.deepEqual(made.listings.map((l) => [l.color, l.price, l.url.replace(base, '')]), [['mint-green', 589.49, '/select.html?variant=mint-yesili'], ['orange', 599.49, '/select.html?variant=turuncu']]);
    assert.equal(made.outOfStock.length, 1, 'the sold-out colour is left out like any sold-out listing');

    // A page without options says so, it does not invent any (menus, footer and related products are not options).
    const none = await clickThroughOptions(base + '/plain.html');
    assert.deepEqual([none.variants, none.note], [[], 'no option group on the page']);
  } finally {
    server.close();
  }
  console.log('PASS: colour options drawn by script are clicked one by one: name, price, stock, photo and URL of each colour become their own listing.');
})().catch((err) => { console.error(err); process.exitCode = 1; });
