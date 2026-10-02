// Shops that list one card per filament model and sell the colours as options on the product page
// (Filament Marketim does): a run read one colourless listing per family. The colours are now read from
// the product page, whatever the shop runs on, and each becomes its own listing with its own URL, price,
// stock and picture. Pages: scripts/fixtures/pages/variants (one per platform shape).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const DIR = path.join(__dirname, 'fixtures', 'pages', 'variants');
const SHOP = 'https://www.filamentshop.example';
const page = (f) => fs.readFileSync(path.join(DIR, f), 'utf8');
const PAGES = {
  'shopify-esun-pla-plus.html': { url: SHOP + '/products/esun-pla-plus', title: 'eSUN PLA+ Filament 1.75mm 1kg', price: 699.9 },
  'woocommerce-elegoo-pla.html': { url: SHOP + '/urun/elegoo-pla-filament/', title: 'Elegoo PLA Filament 1.75mm 1kg', price: 549 },
  'ikas-polymaker-polyterra.html': { url: SHOP + '/polymaker-polyterra-pla', title: 'Polymaker PolyTerra PLA 1.75mm 1kg', price: 629 },
  'jsonld-group-sunlu-petg.html': { url: SHOP + '/sunlu-petg-filament', title: 'SUNLU PETG Filament 1.75mm 1kg', price: 489.9 },
  'ticimax-filamix-pla.html': { url: SHOP + '/filamix-pla-plus', title: 'Filamix PLA+ Filament 1.75mm 1kg', price: 589.49 },
  'select-only-beta-pla.html': { url: SHOP + '/beta-pla', title: 'Beta PLA Filament 1.75mm 1kg', price: 455 }
};
// What each page sells: label, price, stock ('' = the page's).
const EXPECT = {
  'shopify-esun-pla-plus.html': [['Siyah', 699.9, 'in_stock'], ['Beyaz', 699.9, 'in_stock'], ['Silk Gold', 729.9, 'out_of_stock']],
  'woocommerce-elegoo-pla.html': [['Siyah', 549, 'in_stock'], ['Kırmızı', 549, 'in_stock'], ['Koyu Mavi', 579, 'in_stock'], ['Gri', 549, 'out_of_stock']],
  'ikas-polymaker-polyterra.html': [['Charcoal Black', 629, 'in_stock'], ['Fossil Grey', 599, 'out_of_stock'], ['Army Khaki Green', 629, 'in_stock']],
  'jsonld-group-sunlu-petg.html': [['Şeffaf', 489.9, 'in_stock'], ['Turuncu', 489.9, 'out_of_stock']],
  'ticimax-filamix-pla.html': [['Mint Yeşili', 589.49, 'in_stock'], ['Lacivert', 589.49, 'out_of_stock'], ['Turuncu', 599.49, 'in_stock']],
  'select-only-beta-pla.html': [['Kırmızı', 455, ''], ['Mor', 455, ''], ['Sarı', 455, 'out_of_stock']]
};

(async () => {
  const { variantsFromPage } = require('../lib/product-variants.cjs');

  // 1. Every platform shape: the options, their prices (Shopify's kuruş read as lira) and stock.
  for (const [file, meta] of Object.entries(PAGES)) {
    const got = variantsFromPage(page(file), meta.url, { pagePrice: meta.price });
    assert.deepEqual(got.variants.map((v) => [v.label, v.price, v.stock]), EXPECT[file], file + ' (' + got.source + ')');
    assert.equal(new Set(got.variants.map((v) => v.url)).size, got.variants.length, file + ': every option has its own URL');
    assert.ok(got.variants.every((v) => v.url.startsWith(meta.url.replace(/\/$/, ''))), file + ': option URLs stay on the product');
  }
  const shopify = variantsFromPage(page('shopify-esun-pla-plus.html'), PAGES['shopify-esun-pla-plus.html'].url, { pagePrice: 699.9 });
  assert.equal(shopify.variants[0].url, SHOP + '/products/esun-pla-plus?variant=44001', 'Shopify options open as ?variant=<id>');
  assert.match(shopify.variants[0].image, /esun-pla-plus-black\.jpg$/, 'the option picture, not the page picture');
  assert.equal(shopify.variants[0].was, 799.9, 'the compare-at price is the old price');
  const woo = variantsFromPage(page('woocommerce-elegoo-pla.html'), PAGES['woocommerce-elegoo-pla.html'].url, { pagePrice: 549 });
  assert.equal(woo.variants[1].url, SHOP + '/urun/elegoo-pla-filament/?attribute_pa_renk=kirmizi', 'WooCommerce options open with their attribute');
  // Colours as their own pages, linked from the colour picker: links to read, never the related products.
  const links = variantsFromPage(page('colour-links-r3d-pla.html'), SHOP + '/r3d-pla-plus-filament-siyah', { pagePrice: 399 });
  assert.deepEqual(links.variants, []);
  assert.deepEqual(links.links.map((l) => [l.label, l.url]), [['Beyaz', SHOP + '/r3d-pla-plus-filament-beyaz'], ['Pumpkin', SHOP + '/r3d-pla-plus-filament-pumpkin']]);

  // Pages that offer no choice stay one listing.
  const single = '<html><head><script type="application/json" data-product-json>{"title":"Bambu Lab PLA Basic Black","variants":[{"id":1,"title":"Default Title","option1":"Default Title","price":94469,"available":true}]}</script></head><body><h1>Bambu Lab PLA Basic Black</h1></body></html>';
  assert.deepEqual(variantsFromPage(single, SHOP + '/products/pla-basic-black', { pagePrice: 944.69 }).variants, [], 'one Default Title variant is no choice');
  const related = '<html><body><script>var page = {"relatedProducts":[{"name":"eSUN PLA+ Siyah","price":"699,90"},{"name":"Elegoo PLA Beyaz","price":"549,00"}]};</script><div class="related"><a href="/esun-pla-plus-siyah">eSUN PLA+ Siyah</a></div></body></html>';
  const rel = variantsFromPage(related, SHOP + '/sunlu-pla', { pagePrice: 500 });
  assert.deepEqual([rel.variants, rel.links], [[], []], 'a related-products list is not a set of colours');

  // 2. A whole filament run on a shop with one card per family, replayed through the real run code.
  const archiveDir = fs.mkdtempSync(path.join(os.tmpdir(), 'variants-archive-'));
  process.env.SCRAPE_REPLAY_DIR = archiveDir;
  const archive = require('../lib/page-archive.cjs');
  const card = (meta, inStock) => `<div class="product-item"><div class="product-image"><a href="${meta.url}"><img src="https://img.example${new URL(meta.url).pathname.replace(/\/$/, '')}.jpg" alt=""></a></div>
    <div class="product-name"><a href="${meta.url}">${meta.title}</a></div><div class="product-price">${meta.price.toFixed(2).replace('.', ',')} TL</div>
    ${inStock ? '<button class="add-to-cart">Sepete Ekle</button>' : ''}</div>`;
  const families = Object.values(PAGES);
  const category = `<!doctype html><html><head><title>Filamentler</title></head><body><h1>Filamentler</h1><div class="product-list">
    ${families.map((m) => card(m, true)).join('\n')}
    ${card({ url: SHOP + '/r3d-pla-plus-filament', title: 'R3D PLA+ Filament 1.75mm 1kg', price: 399 }, true)}
    ${card({ url: SHOP + '/elas-pla-pro-filament', title: 'Elas PLA Pro Filament', price: 449.9 }, true)}
    </div></body></html>`;
  const pages = { [SHOP + '/filament']: category };
  for (const [file, meta] of Object.entries(PAGES)) pages[meta.url] = page(file);
  // R3D: every colour its own page, and the family page links them.
  pages[SHOP + '/r3d-pla-plus-filament'] = page('colour-links-r3d-pla.html').replace(/R3D PLA\+ Filament Siyah/g, 'R3D PLA+ Filament');
  for (const [slug, colour] of [['beyaz', 'Beyaz'], ['pumpkin', 'Pumpkin'], ['siyah', 'Siyah']]) {
    pages[SHOP + '/r3d-pla-plus-filament-' + slug] = page('colour-links-r3d-pla.html').replace(/R3D PLA\+ Filament Siyah/g, 'R3D PLA+ Filament ' + colour);
  }
  // Elas (Filament Marketim's shape, on Qukasoft): the family page has no price and a disabled cart until a
  // colour is picked ("Lütfen renk seçiniz"), and each colour is its own page named after the product's.
  pages[SHOP + '/elas-pla-pro-filament'] = page('qukasoft-family-elas.html');
  for (const [slug, colour, price] of [['siyah-5101', 'Siyah', '449.90'], ['beyaz-5102', 'Beyaz', '449.90'], ['lacivert-5103', 'Lacivert', '469.90']]) {
    pages[SHOP + '/elas-pla-pro-filament-' + slug] = page('qukasoft-colour-page.html').replace(/__COLOUR__/g, colour).replace(/__SLUG__/g, slug).replace(/__PRICE__/g, price).replace(/__PRICE_TR__/g, price.replace('.', ','));
  }
  archive.writeArchive(archiveDir, pages);

  const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'variants-store-'));
  fs.writeFileSync(path.join(storeDir, 'catalog.json'), JSON.stringify({ products: [], filaments: [] }));
  fs.writeFileSync(path.join(storeDir, 'online-baseline.json'), JSON.stringify({ items: [] }));
  const { runWebsiteJob } = require('../lib/qwen-website-job.cjs');
  const events = [];
  await runWebsiteJob({ url: SHOP + '/filament', kind: 'filament', vat: 'included', catalog: path.join(storeDir, 'catalog.json'), visualMatch: false }, (ev) => events.push(ev));
  const listings = events.filter((e) => e.type === 'extract' && e.listing).map((e) => e.listing);
  const byFamily = (title) => listings.filter((l) => l.sourceTitle.startsWith(title) || l.sourceTitle.startsWith(title.replace(' 1.75mm 1kg', '')));

  const familyUrls = new Set([...families.map((m) => m.url), SHOP + '/elas-pla-pro-filament']);
  assert.deepEqual(listings.filter((l) => familyUrls.has(l.url)).map((l) => l.sourceTitle), [], 'no colourless family listing is left');
  assert.equal(new Set(listings.map((l) => l.url)).size, listings.length, 'every listing has its own URL');
  assert.deepEqual(listings.filter((l) => !l.color).map((l) => l.sourceTitle), [], 'every listing has a colour');
  const want = {
    'eSUN PLA+ Filament 1.75mm 1kg': ['black', 'white'],
    'Elegoo PLA Filament 1.75mm 1kg': ['black', 'red', 'dark-blue'],
    'Polymaker PolyTerra PLA 1.75mm 1kg': ['black', 'khaki-green'],
    'SUNLU PETG Filament 1.75mm 1kg': ['clear'],
    'Filamix PLA+ Filament 1.75mm 1kg': ['mint-green', 'orange'],
    'Beta PLA Filament 1.75mm 1kg': ['red', 'purple'],
    'R3D PLA+ Filament': ['black', 'white', 'pumpkin-orange'],
    'Elas PLA Pro Filament': ['black', 'white', 'navy-blue']
  };
  for (const [title, colours] of Object.entries(want)) {
    const got = byFamily(title);
    assert.deepEqual(got.map((l) => l.color).sort(), colours.slice().sort(), title + ': the in-stock colours, one listing each');
  }
  const blue = listings.find((l) => l.color === 'dark-blue');
  assert.deepEqual([blue.name, blue.brand.toLowerCase(), blue.polymer, blue.weight, blue.diameter, blue.price, blue.stockStatus], ['Elegoo PLA Filament 1.75mm 1kg', 'elegoo', 'pla', '1000 g', '1.75 mm', 579, 'in_stock'], 'an option keeps the family details and its own price');
  assert.equal(listings.find((l) => l.color === 'mint-green').price, 589.49);
  assert.equal(listings.find((l) => l.color === 'orange' && /Filamix/.test(l.sourceTitle)).price, 599.49);
  const variantEvents = events.filter((e) => e.type === 'variants');
  assert.equal(variantEvents.length, 8, 'the run says which families it split (six with options, R3D and Elas with colour pages)');
  assert.equal(listings.find((l) => l.color === 'navy-blue').price, 469.9, 'each colour page keeps its own price');
  assert.ok(!listings.some((l) => /makarasiz/.test(l.url)), 'a single link to the refill version is not a colour');

  // 3. The board: a split family's own card goes, its colours stay.
  const source = fs.readFileSync(path.join(__dirname, '..', 'netlify', 'functions', 'worker.mjs'), 'utf8')
    .replace(/^import .*;$/gm, '').replace('export default async', 'globalThis.handler = async');
  const files = { 'jobs.json': [{ id: 'job', url: SHOP + '/filament', kind: 'filament', status: 'running', createdAt: '2026-10-01T10:00:00.000Z', cards: {}, events: [] }], 'catalog.json': { products: [], filaments: [] } };
  const sandbox = { console, Response, URL, store: { readJSON: async (k, f) => JSON.parse(JSON.stringify(k in files ? files[k] : f)), writeJSON: async (k, v) => { files[k] = JSON.parse(JSON.stringify(v)); } }, auth: { workerAuth: () => true }, stock: { rollupProductStock: () => {} }, boardLib: require('../lib/baseline-board.cjs') };
  vm.runInNewContext(source, sandbox);
  const { compactEvent } = require('../worker/online-worker.cjs');
  const sent = events.filter((e) => ['gather', 'variants', 'extract'].includes(e.type)).map(compactEvent);
  assert.ok(!sent.some((e) => e.type === 'variants' && e.card), 'the split event is not a card');
  const res = await sandbox.handler({ method: 'POST', url: 'http://127.0.0.1:8890/.netlify/functions/worker?action=progress', headers: { get: () => null, entries: () => [][Symbol.iterator]() }, json: async () => ({ jobId: 'job', events: sent }) });
  assert.equal(res.status, 200);
  const job = files['jobs.json'][0];
  const cards = Object.keys(job.cards);
  assert.deepEqual(cards.filter((u) => familyUrls.has(u)), [], 'no family card on the board');
  assert.deepEqual(cards.sort(), listings.map((l) => l.url).sort(), 'one card per colour');
  const adminSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin', 'admin.js'), 'utf8').replace('  init();', 'globalThis.test = { state, collectCards };');
  const ctx = { URL, console, window: {}, document: { addEventListener() {}, getElementById: () => null } };
  vm.runInNewContext(adminSource, ctx);
  ctx.test.state.data = { jobs: [job], catalog: { products: [], filaments: [] }, baseline: { items: [] } };
  const shown = Array.from(ctx.test.collectCards(job, ctx.test.state.data), (e) => e.card.url);
  assert.deepEqual(shown.filter((u) => familyUrls.has(u)), [], 'the admin board, replaying the events, shows no family card either');

  fs.rmSync(archiveDir, { recursive: true, force: true });
  fs.rmSync(storeDir, { recursive: true, force: true });
  console.log('PASS: colours sold as options (Shopify, WooCommerce, ikas, Ticimax-style data, schema.org groups, plain selects, colour links) become one listing each, with their own URL, price, stock and picture; the family card goes.');
})().catch((err) => { console.error(err); process.exitCode = 1; });
