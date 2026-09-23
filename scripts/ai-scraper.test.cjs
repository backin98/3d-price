const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { stripDom, priceOnPage, listingFromExtract, detectCurrency, handleInfiniteScroll, listingPageUrls, inferPagePattern, nextPageUrl, needsDeeperScroll } = require('../lib/ai-scraper.cjs');
const { paginationMisses, oosPagingStop } = require('../lib/qwen-website-job.cjs');
const { compare_products, rankByPrice, toTry } = require('../lib/compare-products.cjs');
const { record, history } = require('../lib/price-history.cjs');

const html = `
  <script>void 0</script>
  <nav>menu</nav>
  <h1>Bambu Lab A1 Combo 3D Yazıcı</h1>
  <div class="sale-price">19.999,00 TL</div>
  <p>KDV Dahil. Taksit 12 x 1.666 TL değil.</p>
`;

assert.equal(stripDom(html).includes('menu'), false);
assert.equal(stripDom(html).includes('void'), false);
assert.equal(priceOnPage(html, 19999), true);
assert.equal(priceOnPage(html, 12), false);
assert.equal(detectCurrency(html), 'TRY');

const listing = listingFromExtract('https://shop.example/a1-combo', html, {
  product_title: 'Bambu Lab A1 Combo 3D Yazıcı',
  raw_price: '19.999,00',
  currency: 'TRY',
  full_price: 19999,
  detected_language: 'tr',
  translated_title_en: 'Bambu Lab A1 Combo 3D Printer',
  availability: true
}, 'printer');
assert.equal(listing.price, 19999);
assert.equal(listing.translated_title_en.includes('Combo'), true);
assert.equal(listing.extractor, 'gemma');

const fromStock = listingFromExtract('https://shop.example/a1', `
  <h1>Bambu Lab A1 3D Yazıcı</h1>
  <div class="sale-price">10.000,00 TL</div>
  <p>Stoktan Teslim</p><button>Sepete Ekle</button>
`, {
  product_title: 'Bambu Lab A1 3D Yazıcı',
  raw_price: '10.000,00',
  currency: 'TRY',
  full_price: 10000,
  detected_language: 'tr',
  translated_title_en: 'Bambu Lab A1',
  availability: false
}, 'printer');
assert.equal(fromStock.stockStatus, 'in_stock');
assert.equal(fromStock.availability, true);

assert.equal(compare_products(
  { name: 'Bambu Lab A1 3D Yazıcı', translated_title_en: 'Bambu Lab A1 3D Printer', brand: 'Bambu Lab', kind: 'printer', price: 18000, currency: 'TRY' },
  { name: 'Bambu Lab A1 Combo 3D Yazıcı', translated_title_en: 'Bambu Lab A1 Combo 3D Printer', brand: 'Bambu Lab', kind: 'printer', price: 19999, currency: 'TRY' }
).sameSku, false);

assert.equal(compare_products(
  { name: 'Elegoo PLA Siyah 1kg', translated_title_en: 'Elegoo PLA Black 1kg', brand: 'Elegoo', kind: 'filament', polymer: 'pla', color: 'Siyah', weight: '1 kg' },
  { name: 'Elegoo PLA Black 1 kg', translated_title_en: 'Elegoo PLA Black 1kg', brand: 'Elegoo', kind: 'filament', polymer: 'pla', color: 'Black', weight: '1kg' }
).sameSku, true);

const ranked = rankByPrice([
  { name: 'A', price: 20, currency: 'USD' },
  { name: 'B', price: 500, currency: 'TRY' }
]);
assert.equal(ranked[0].currency, 'TRY');
assert.ok(toTry(20, 'USD') > 20);

const db = path.join(os.tmpdir(), 'hist-' + Date.now() + '.sqlite');
record({ url: listing.url, name: listing.name, price: listing.price, currency: 'TRY', price_try: listing.price, status: 'ok' }, db);
assert.equal(history(listing.url, db).length, 1);
fs.rmSync(db, { force: true });

(async () => {
  let height = 1000;
  let count = 5;
  const page = {
    evaluate: async (src) => {
      const s = String(src);
      if (s.startsWith('(() => {')) {
        if (count < 20) { height += 800; count += 5; }
        return undefined;
      }
      if (s.includes('scrollHeight')) return height;
      if (s.includes('querySelectorAll')) return count;
      return undefined;
    },
    mouse: { wheel: async () => {} }
  };
  const scrolled = await handleInfiniteScroll(page, { maxScrolls: 15, pauseMs: 1 });
  assert.equal(scrolled.productCount, 20);
  assert.ok(scrolled.attempts >= 3);
  assert.ok(scrolled.attempts < 15);
  const stuck = await handleInfiniteScroll({
    evaluate: async (src) => String(src).includes('scrollHeight') ? 900 : 5,
    mouse: { wheel: async () => { throw new Error('no wheel'); } }
  }, { maxScrolls: 15, pauseMs: 1 });
  assert.equal(stuck.productCount, 5);
  assert.equal(stuck.attempts, 2);
  const pages = listingPageUrls('https://store.metatechtr.com/3d-yazicilar', 'Toplam 48 <a href="?pg=3">3</a>');
  assert.equal(pages[0], 'https://store.metatechtr.com/3d-yazicilar?pg=2');
  assert.equal(pages[pages.length - 1], 'https://store.metatechtr.com/3d-yazicilar?pg=3');
  const spanPages = listingPageUrls('https://store.metatechtr.com/3d-yazicilar', 'Toplam <span class="text-primary fw-bold">112</span> ürün ' + 'mb-2 product-item '.repeat(8));
  assert.ok(spanPages[0].includes('ps='));
  assert.doesNotMatch(spanPages[0], /pg=/);
  const relNext = listingPageUrls('https://shop.example/3d-yazicilar', '<link rel="next" href="/3d-yazicilar?page=2">');
  assert.equal(relNext[0], 'https://shop.example/3d-yazicilar?page=2');
  const sonraki = listingPageUrls('https://shop.example/kategori/yazici', '<a href="/kategori/yazici?sayfa=2">Sonraki</a>');
  assert.ok(sonraki.some((u) => u.includes('sayfa=2')));
  const legalFooter = listingPageUrls('https://shop.example/kategori/yazici', '<a href="/UyelikSozlesme.aspx?sozlemeTipi=5">Kişisel Verileri Koruma</a>');
  assert.deepEqual(legalFooter, [], 'verileri is not the İleri pagination control');
  const shopify = listingPageUrls('https://shop.example/collections/printers', '<a href="/collections/printers?page=2">2</a>');
  assert.ok(shopify.some((u) => u.includes('page=2')));
  const noPager = listingPageUrls('https://shop.example/about', '<p>No products here</p>');
  assert.equal(noPager.length, 0);
  const pat = inferPagePattern('https://shop.example/yazici', 'https://shop.example/yazici?page=2');
  assert.equal(pat.key, 'page');
  assert.equal(nextPageUrl(pat, 'https://shop.example/yazici', 'https://shop.example/yazici'), 'https://shop.example/yazici?page=2');
  assert.equal(nextPageUrl(pat, 'https://shop.example/yazici?page=2', 'https://shop.example/yazici'), 'https://shop.example/yazici?page=3');
  const pathPat = inferPagePattern('https://shop.example/kategori/yazici', 'https://shop.example/kategori/yazici/sayfa/2/');
  assert.equal(pathPat.type, 'path');
  assert.match(nextPageUrl(pathPat, 'https://shop.example/kategori/yazici/sayfa/2/', 'https://shop.example/kategori/yazici'), /sayfa\/3/);
  assert.equal(needsDeeperScroll('https://shop.example/3d-yazicilar', '<div class="product-item"></div>'), true);
  assert.equal(needsDeeperScroll('https://shop.example/3d-yazicilar', '<link rel="next" href="/3d-yazicilar?page=2">'), false);
  assert.equal(paginationMisses('https://shop.example/list?page=2', 0, 0), 1);
  assert.equal(paginationMisses('https://shop.example/list?page=3', 0, 1), 2);
  assert.equal(paginationMisses('https://shop.example/list?page=4', 3, 2), 0);
  assert.equal(oosPagingStop({ buyable: 10, oos: 1, consecutive: 0 }).stop, false);
  assert.equal(oosPagingStop({ buyable: 2, oos: 10, consecutive: 0 }).stop, true, 'one page of mostly Tükendi stops paging');
  assert.equal(oosPagingStop({ buyable: 4, oos: 6, consecutive: 0 }).stop, false);
  assert.equal(oosPagingStop({ buyable: 4, oos: 6, consecutive: 1 }).stop, true, 'two mixed-but-heavy OOS pages stop');
  console.log('PASS: Gemma extract evidence, multilingual compare, FX rank, sqlite history, infinite scroll.');
})().catch((err) => { console.error(err); process.exitCode = 1; });
