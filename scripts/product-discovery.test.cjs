// Discovery: a storefront nobody has seen must still yield its products. The gate must
// come from the page's own link shapes, not from a list of known platforms.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { harvestCategory, extractCards, discoverProductLinks, discoverCards, shapeKey } = require('../lib/harvest.js');

// --- shape detection -------------------------------------------------------------
assert.equal(shapeKey('bambu-lab-x1e-combo-3d-yazici-u126396'), '1|', 'relative -u###### slug');
assert.equal(shapeKey('https://shop.example/urun/ender-3-v3-ke'), '', 'a /urun/ slug is not an id cluster');
assert.equal(shapeKey('urun-detay-p-12345'), '1|', '-p##### slug');
assert.equal(shapeKey('UrunDetay.aspx?urunID=12'), 'q|/urundetay.aspx?urunid', 'query id shape');
assert.equal(shapeKey('urunler'), '', 'plain nav');
assert.equal(shapeKey('fdm-3d-yazicilar-ka434'), '', 'category tail -ka434 is not a product');
assert.equal(shapeKey('liste-k1234'), '', 'category tail -k1234 is not a product');
assert.equal(shapeKey('javascript:__doPostBack(1)'), '', 'postback links are not products');

// --- a real OdyoBilişim/ASP.NET category page (4 cards sliced from urhanshop.com) ---
const real = fs.readFileSync(path.join(__dirname, 'fixtures', 'aspnet-product-grid.html'), 'utf8');
const realUrl = 'https://www.urhanshop.com/fdm-3d-yazicilar-ka434';
(async () => {
  const r = await harvestCategory({ categoryUrl: realUrl, kind: 'printer', html: real, maxProducts: 20 });
  assert.equal(r.inScope.length, 4, 'the real fixture yields its 4 printers, got ' + r.inScope.length);
  assert.equal(r.discovery.cards, 4);
  for (const p of r.inScope) {
    assert.match(p.url, /^https:\/\/www\.urhanshop\.com\/[a-z0-9-]+-u\d{6}$/, 'relative slug absolutized: ' + p.url);
    assert.ok(p.price > 1000 && p.price < 1000000, 'price parsed: ' + p.price);
    assert.ok(p.name && p.name.length > 8, 'title from the card, not the url: ' + p.name);
  }
  const p1s = r.inScope.find((p) => /x1e/i.test(p.name));
  assert.equal(p1s.price, 158550.96, 'the price that the product page itself shows');
  assert.equal(p1s.url, 'https://www.urhanshop.com/bambu-lab-x1e-combo-3d-yazici-u126396');

  // --- a platform we have never seen, no known class names anywhere ------------------
  const card = (href, title, price) => `<div class="herhangi"><a href="${href}"><h3 class="blok">${title}</h3></a><span class="tutar">${price}</span><button>Add to cart</button></div>`;
  const unknown = `<html><body>
    <a href="anasayfa">Anasayfa</a>
    <a href="iletisim">İletişim</a>
    <a href="kategoriler-1-ka1234">Kategoriler</a>
    <a href="AltKategoriler.aspx?markaAdi=bambu">Filtre</a>
    <div class="liste">
      ${card('widget-pro-100', 'Widget Pro 100 3D Yazıcı', '1.234,00 TL')}
      ${card('widget-mini-200', 'Widget Mini 200 3D Yazıcı', '2.345,50 TL')}
      ${card('widget-max-300', 'Widget Max 300 3D Yazıcı', '3.456,75 TL')}
    </div></body></html>`;
  const u = await harvestCategory({ categoryUrl: 'https://unknown.example/kategori-9', kind: 'printer', html: unknown, maxProducts: 20 });
  assert.equal(u.inScope.length, 3, 'unknown platform discovered, got ' + u.inScope.length);
  assert.deepEqual(u.inScope.map((p) => p.price).sort((a, b) => a - b), [1234, 2345.5, 3456.75]);
  assert.deepEqual(u.inScope.map((p) => p.url).sort(), [
    'https://unknown.example/widget-max-300',
    'https://unknown.example/widget-mini-200',
    'https://unknown.example/widget-pro-100'
  ]);
  const urls = u.inScope.map((p) => p.url).join(" ");
  for (const junk of ['anasayfa', 'iletisim', 'AltKategoriler', 'kategoriler-1-ka1234']) {
    assert.ok(!urls.includes(junk), junk + ' is navigation, not a product');
  }

  // --- a page with no product grid stays empty, and says so --------------------------
  const navOnly = '<html><body><a href="hakkimizda">Hakkımızda</a><a href="iletisim">İletişim</a><a href="blog">Blog</a><a href="sss">SSS</a></body></html>';
  const none = await harvestCategory({ categoryUrl: 'https://unknown.example/', kind: 'printer', html: navOnly });
  assert.equal(none.inScope.length, 0);
  assert.equal(discoverProductLinks(navOnly).length, 0, 'nav links must not cluster into a grid');
  assert.match(none.warning, /no product grid/, 'the empty page still explains itself');

  // --- known platforms keep their own path (selectors, no discovery needed) ----------
  const shopify = `<html><body><div class="product-item"><a href="/products/widget-abc">Widget</a><div class="price">999,00 TL</div><button>Add to cart</button></div></body></html>`;
  assert.equal(extractCards(shopify).length, 1, 'the selector path still matches known markup');
  const s = await harvestCategory({ categoryUrl: 'https://shop.example/collections/all', kind: 'printer', html: shopify });
  assert.equal(s.inScope.length, 1);
  assert.equal(s.discovery, null, 'discovery must not run when the selectors already worked');
  assert.equal(discoverCards(shopify).length, 0, 'no id cluster on a /products/ grid: discovery stays out');

  console.log('PASS: product links are discovered from link shapes alone — relative id slugs, query ids, unknown markup — while known platforms are unaffected.');
})().catch((e) => { console.error(e); process.exitCode = 1; });
