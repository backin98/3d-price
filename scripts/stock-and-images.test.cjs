// Stock: a vendor that ran out has to leave the comparison, and a vendor's dead thumbnail
// has to be replaced by the same product's photo from another compared site.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const { planStockChecks, checkOfferStock, refreshStock, rollupProductStock } = require('../lib/stock-refresh.cjs');

const catalog = () => ({
  products: [
    {
      id: 'p1', name: 'Bambu Lab P1S Combo', kind: 'printer', stockStatus: 'in_stock',
      offers: [
        { store: 'stale.example', url: 'https://stale.example/p1s', price: 100, stockStatus: 'in_stock', stockCheckedAt: '2020-01-01T00:00:00.000Z' },
        { store: 'fresh.example', url: 'https://fresh.example/p1s', price: 110, stockStatus: 'in_stock', stockCheckedAt: new Date().toISOString() }
      ]
    },
    {
      id: 'p2', name: 'Bambu Lab A1 Mini', kind: 'printer',
      offers: [
        { store: 'gone.example', url: 'https://gone.example/a1', price: 90, stockStatus: 'in_stock', stockCheckedAt: '2020-01-01T00:00:00.000Z' },
        { store: 'nolog.example', url: 'https://nolog.example/a1', price: 95 }
      ]
    }
  ],
  filaments: []
});

// Real product pages are six figures of markup; the reader refuses anything much smaller
// because a truncated response is not a verdict about stock.
const html = (body) => '<html><head><title>t</title></head><body>' + body + '<div>' + ' '.repeat(2200) + '</div></body></html>';

(async () => {
  // --- planning: only what is stale or never checked -------------------------------
  const plan = planStockChecks(catalog(), { staleHours: 12, now: Date.now(), limit: 10 });
  assert.equal(plan.total, 3, 'stale + never-checked offers, the fresh one untouched');
  // Never-checked first (age unknown is the worst case), then the oldest check.
  assert.deepEqual(plan.targets.map((t) => t.offer.store), ['nolog.example', 'stale.example', 'gone.example']);
  assert.equal(plan.targets[0].ageHours, Infinity);

  // --- reading one page -------------------------------------------------------------
  const stub = (map) => async (url) => {
    const r = map[String(url)];
    if (!r) throw new Error('no stub for ' + url);
    if (r.throw) throw new Error('socket hang up');
    const status = r.status || 200;
    return { ok: status === 200, status, text: async () => html(r.body || '') };
  };
  assert.equal((await checkOfferStock('https://x/1', { fetchImpl: stub({ 'https://x/1': { body: 'Bu ürün tükendi' } }) })).status, 'out_of_stock');
  assert.equal((await checkOfferStock('https://x/2', { fetchImpl: stub({ 'https://x/2': { body: 'Sepete Ekle', status: 200 } }) })).status, 'in_stock');
  assert.equal((await checkOfferStock('https://x/3', { fetchImpl: stub({ 'https://x/3': { status: 404 } }) })).status, 'out_of_stock', 'a delisted page is out of stock');
  const blocked = await checkOfferStock('https://x/4', { fetchImpl: stub({ 'https://x/4': { status: 403 } }) });
  assert.equal(blocked.status, 'unknown', 'a block is not evidence of stock either way');
  assert.equal(blocked.verified, false);
  const dead = await checkOfferStock('https://x/5', { fetchImpl: stub({ 'https://x/5': { throw: true } }) });
  assert.equal(dead.status, 'unknown');
  assert.match(dead.method, /^error:/);

  // --- the sweep --------------------------------------------------------------------
  const cat = catalog();
  const fetchImpl = stub({
    'https://stale.example/p1s': { body: 'Bu ürün tükendi' },     // was in stock, now gone
    'https://gone.example/a1': { status: 404 },
    'https://nolog.example/a1': { body: 'Sepete Ekle' }
  });
  const out = await refreshStock({ catalog: cat, staleHours: 12, limit: 10, fetchImpl });
  assert.equal(out.summary.checked, 3);
  assert.equal(out.summary.changed, 3);
  assert.equal(out.summary.outOfStock, 2, 'two vendors newly out of stock');
  const p1 = cat.products[0];
  assert.equal(p1.offers[0].stockStatus, 'out_of_stock');
  assert.equal(p1.offers[0].stockCheckMethod, 'page-no-cart');
  assert.ok(Date.parse(p1.offers[0].stockCheckedAt) > Date.parse('2026-01-01T00:00:00.000Z'), 'timestamp refreshed');
  assert.equal(p1.offers[1].stockStatus, 'in_stock', 'the fresh offer was not touched');
  assert.equal(p1.stockStatus, 'in_stock', 'one live vendor keeps the product alive');
  assert.equal(cat.products[1].stockStatus, 'in_stock', 'A1: nolog.example sells it');

  // --- a product whose every vendor is dead ----------------------------------------
  const allDead = refreshStock({
    catalog: { products: [{ id: 'p3', name: 'Dead', offers: [{ store: 'a', url: 'https://d/1', stockStatus: 'in_stock' }, { store: 'b', url: 'https://d/2', stockStatus: 'in_stock' }] }], filaments: [] },
    staleHours: 0, limit: 5, fetchImpl: stub({ 'https://d/1': { status: 404 }, 'https://d/2': { body: 'stokta yok' } })
  });
  const deadCat = (await allDead).catalog;
  assert.equal(deadCat.products[0].stockStatus, 'out_of_stock', 'every vendor dead -> product dead');

  // --- product rollup does not invent stock from nothing ---------------------------
  const unknown = { id: 'p4', name: 'K', offers: [{ store: 'a', url: 'https://u/1', stockStatus: 'unknown' }] };
  rollupProductStock(unknown, Date.now());
  assert.equal(unknown.stockStatus, 'unknown', 'unknown stays unknown: it is not in stock');

  // --- the reader must not be fooled by a page's own noise -------------------------
  const { readStockPage } = require('../lib/stock-refresh.cjs');
  const noisy = readStockPage('<div class=buy>Sepete Ekle <span>21.999,00 TL</span></div>' + '<div>x</div>'.repeat(120) + '<div class=rec>Benzer urun TUKENDI</div>');
  assert.equal(noisy.status, 'in_stock', 'a sold-out recommendation card is not this product');
  assert.equal(readStockPage('<script type="application/ld+json">{"availability":"https://schema.org/OutOfStock"}</script><div>Sepete Ekle</div>').status, 'out_of_stock', 'structured data wins over a cart button');
  assert.equal(readStockPage('<script type="application/ld+json">{"availability":"https://schema.org/OutOfStock"}</script><div class="buy"><span>Ön Sipariş Ürünü</span><button>Sepete Ekle</button></div>').status, 'preorder', 'an explicit preorder buy box overrides stale out-of-stock schema');
  assert.equal(readStockPage('<script type="application/ld+json">{"availability":"https://schema.org/InStock"}</script>').status, 'in_stock');
  assert.equal(readStockPage('<nav>On Siparis</nav><div>Sepete Ekle 1.234,00 TL</div>').status, 'in_stock', 'a menu mentioning pre-order proves nothing');

  // --- a whole shop going dead in one pass is a parsing failure, not reality --------
  const guardCat = {
    products: [{ id: 'g1', name: 'Shop wide', offers: [
      { store: 'redesigned.example', url: 'https://r/1', stockStatus: 'in_stock' },
      { store: 'redesigned.example', url: 'https://r/2', stockStatus: 'in_stock' },
      { store: 'redesigned.example', url: 'https://r/3', stockStatus: 'in_stock' }
    ] }], filaments: []
  };
  const guarded = await refreshStock({
    catalog: guardCat, staleHours: 0, limit: 10,
    fetchImpl: stub({ 'https://r/1': { body: 'tukendi' }, 'https://r/2': { body: 'tukendi' }, 'https://r/3': { body: 'tukendi' } })
  });
  assert.equal(guarded.summary.guarded, 3, 'all three offers pulled back');
  assert.ok(guardCat.products[0].offers.every((o) => o.stockStatus === 'unknown'), 'a shop that is suddenly 100% dead stays unknown');
  assert.equal(guardCat.products[0].offers[0].stockCheckMethod, 'guard:whole-shop');

  // --- limit is honoured ------------------------------------------------------------
  const many = { products: [{ id: 'm', name: 'Many', offers: Array.from({ length: 10 }, (_, i) => ({ store: 's', url: 'https://m/' + i, stockStatus: 'in_stock' })) }], filaments: [] };
  const limited = await refreshStock({ catalog: many, staleHours: 0, limit: 4, fetchImpl: async () => stub({}).call() });
  assert.equal(limited.summary.checked, 4, 'only the requested number of pages is fetched');
  assert.equal(limited.summary.stale, 10);

  // --- the storefront side: dead vendors out of the comparison ---------------------
  // Only the keys the module reads before its first render touch.
  const store = {
    desk: {}, locations: [], aisles: [], banners: [], ads: [], units: [], products: [],
    live: { compared: 'Compared', on: 'Online', preorder: 'Preorder', noImage: 'No image' },
    cart: { empty: '', remove: 'Remove' }, sheet: {}, bestOffer: 'Best', wasPrice: 'was {price}',
    brand: {}, dir: {}, documentTitle: {}, emptyAisle: {}, emptySearchBody: {}, emptySearchTitle: {},
    filament: {}, header: {}, hunter: {}, lang: {}, offerCount: {}, productExact: {}, productPhrases: [],
    profile: {}, resultsCount: {}, savedDeal: {}, saveDeal: {}
  };
  const nodes = new Map();
  const node = (sel) => { if (!nodes.has(sel)) nodes.set(sel, { hidden: true, innerHTML: '', textContent: '', value: '', contains: () => false, dataset: {} }); return nodes.get(sel); };
  const context = {
    URL, Response, console,
    window: { SITE_CONTENT: store },
    document: {
      querySelector: node, querySelectorAll: () => [], addEventListener() {}, body: {},
      documentElement: { lang: '', dataset: {}, classList: { add() {}, remove() {}, toggle() {} } },
      createElement: () => ({ set className(v) {}, set textContent(v) {}, dataset: {}, style: {}, appendChild() {}, setAttribute() {} })
    },
    location: { hash: '', search: '' }, localStorage: { getItem: () => null, setItem() {} },
    setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, clearTimeout() {}, requestAnimationFrame: () => 1,
    addEventListener() {}, fetch: async () => ({ ok: false, status: 404, json: async () => ({}) }),
    ResizeObserver: function () { this.observe = () => {}; }
  };
  // Load the module without its bootstrap: we exercise the helpers, not the first render.
  // Load the storefront module without running its bootstrap. Matching whole lines is
  // deliberate: a regex over the file mangled nested calls on me once already.
  const boot = /^\s*(?:initStatic|bind)\(\);\s*$|^\s*huntRhino\(state\.query \|\| \""\);\s*$/;
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8')
    .split('\r\n').join('\n')
    .split('\n')
    .filter((line) => !boot.test(line))
    .join('\n');
  vm.runInNewContext(src, context);
  const api = context.window.__3dp;
  assert.ok(api, 'storefront helpers are exposed for testability');

  const product = {
    id: 'p1', name: 'Bambu Lab P1S Combo', image: 'https://dead.example/p1s.webp',
    offers: [
      { store: 'dead.example', price: 50, image: 'https://dead.example/p1s.webp', stockStatus: 'out_of_stock' },
      { store: 'live.example', price: 60, image: 'https://live.example/p1s.webp', stockStatus: 'in_stock' },
      { store: 'other.example', price: 55, image: 'https://other.example/p1s.webp', stockStatus: 'unknown' }
    ]
  };
  assert.equal(api.liveOffers(product).length, 2, 'the out-of-stock vendor is not in the comparison');
  assert.equal(api.bestOffer(product).store, 'live.example', 'verified in-stock beats a cheaper unknown or dead offer');
  assert.equal(api.isSellable({ id: 'x', offers: [{ stockStatus: 'out_of_stock' }] }), false, 'a product with no live vendor leaves the site');
  assert.equal(api.isSellable({ id: 'x2', offers: [{ stock: 'out_of_stock' }] }), false, 'legacy stock fields cannot leak a dead offer');
  assert.equal(api.isSellable({ id: 'y', offers: [{ stockStatus: 'unknown' }] }), true, 'unknown stays on the site');
  assert.equal(api.bestOffer({ offers: [{ store: 'dead', price: 1, stockStatus: 'out_of_stock' }] }).store, '', 'an all-dead row has no best offer');

  // --- the thumbnail walker ---------------------------------------------------------
  const chain = api.productImages(product).map((i) => i.url);
  assert.equal(chain[0], 'https://dead.example/p1s.webp', 'the product image is tried first');
  assert.ok(chain.includes('https://live.example/p1s.webp'), 'other vendors images are in the chain');
  const makeImg = (src) => ({ dataset: {}, getAttribute: function (k) { return k === 'src' ? this._src : (k === 'data-imgs' ? JSON.stringify(chain) : null); }, setAttribute: function (k, v) { if (k === 'src') this._src = v; }, _src: src, replaced: null, replaceWith(o) { this.replaced = o; } });

  const webp = makeImg('https://dead.example/p1s.webp');
  const seen = [];
  for (let i = 0; i < 6; i++) {
    api.imgFail(webp);
    if (webp.replaced) break;
    seen.push(webp.getAttribute('src'));
  }
  // Each vendor's image gets its jpg twin retried before moving on to the next vendor.
  assert.deepEqual(seen, [
    'https://dead.example/p1s.jpg',
    'https://live.example/p1s.webp',
    'https://live.example/p1s.jpg',
    'https://other.example/p1s.webp',
    'https://other.example/p1s.jpg'
  ], 'the walker fell through from a dead vendor to the next, then gave up: ' + JSON.stringify(seen));
  assert.ok(webp.replaced, 'only when every vendor image failed does the placeholder appear');

  console.log('PASS: out-of-stock vendors leave the comparison, stale stock is re-checked from the page, and a dead thumbnail falls through to another vendor.');
})().catch((e) => { console.error(e); process.exitCode = 1; });

// ---------------------------------------------------------------------------------------------
// Real shops are slow, rate-limited and sometimes answer with half a page. None of that is
// evidence about stock: a fetch that failed must leave the offer alone, never mark it dead.
const stock = require('../lib/stock-refresh.cjs');
const pageWith = (inner) => '<!doctype html><html><body>' + inner + '</body></html>';

(async () => {
  const ok = (html) => async () => new Response(html, { status: 200 });

  // A timeout on the first two attempts, then a clean answer: a laggy shop must be retried.
  let calls = 0;
  const flaky = async () => {
    calls += 1;
    if (calls < 3) { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }
    return new Response(pageWith('<div class="buy">Sepete Ekle</div><div>46.236,14 TL</div>' + ' '.repeat(2400)), { status: 200 });
  };
  const retried = await stock.checkOfferStock('https://laggy.example/p', { fetchImpl: flaky, timeoutMs: 50 });
  assert.equal(calls, 3, 'it tried three times: ' + calls);
  assert.equal(retried.status, 'in_stock', 'and used the answer once the shop woke up: ' + JSON.stringify(retried));
  let once = 0;
  await stock.checkOfferStock('https://once.example/p', { fetchImpl: async () => { once += 1; throw new Error('down'); }, timeoutMs: 50, retries: 0 });
  assert.equal(once, 1, 'website previews use one bounded attempt');

  // Every attempt failing is "unknown", which keeps the offer on the site.
  const dead = await stock.checkOfferStock('https://down.example/p', { fetchImpl: async () => { throw new Error('ECONNRESET'); }, timeoutMs: 50 });
  assert.equal(dead.status, 'unknown', 'a network failure is not out-of-stock: ' + JSON.stringify(dead));
  assert.equal(dead.verified, false, 'and it is not claimed as verified');

  // A 500 from their side is their problem: retry, then unknown.
  let five = 0;
  const broken = await stock.checkOfferStock('https://broken.example/p', { fetchImpl: async () => { five += 1; return new Response('boom', { status: 503 }); }, timeoutMs: 50 });
  assert.equal(broken.status, 'unknown', 'a 503 is not out-of-stock');
  assert.equal(five, 3, 'and it was retried: ' + five);

  // A truncated page (slow server, partial flush) says nothing.
  const partial = await stock.checkOfferStock('https://slow.example/p', { fetchImpl: ok('<html><body>Tükendi'), timeoutMs: 50 });
  assert.equal(partial.status, 'unknown', 'half a page is not a verdict: ' + JSON.stringify(partial));
  assert.equal(partial.method, 'short-page');

  // A real "tükendi" in the buy box still counts, once the page is whole.
  const out = await stock.checkOfferStock('https://gone.example/p', {
    fetchImpl: ok(pageWith('<div class="buy">Sepete Ekle</div><div class="stock">Bu ürün tükendi</div>' + 'x'.repeat(2500))),
    timeoutMs: 50
  });
  assert.equal(out.status, 'out_of_stock', 'a complete page saying tükendi is believed: ' + JSON.stringify(out));

  // A delisted page is still the strongest signal there is, and is not retried.
  let gone = 0;
  const delisted = await stock.checkOfferStock('https://404.example/p', { fetchImpl: async () => { gone += 1; return new Response('nope', { status: 404 }); }, timeoutMs: 50 });
  assert.equal(delisted.status, 'out_of_stock', '404 means gone');
  assert.equal(gone, 1, 'no pointless retries on a delisted page');

  console.log('PASS: a laggy or half-answering shop never marks an offer dead — only a complete page (or a 404) does.');
})().catch((e) => { console.error(e); process.exitCode = 1; });
