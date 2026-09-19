// Prices, once and for all shops. The repro: rhino3dprinter.com listed the Creality K2 Pro Combo
// at 2.146.236,14 TL because the card's discount badge ("%21") was glued onto the sale price
// ("46.236,14") and read as one number. Real listing price: 46.236,14 TL.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const money = require('../lib/parse-money.cjs');
const { cardPrice, cardPriceDetail } = require('../lib/harvest.js');

const { parseMoney, pickMoney, pickPrice, toAmount, isSuspectAmount, flagPriceOutliers } = money;
const fixture = fs.readFileSync(path.join(__dirname, 'fixtures', 'rhino-k2pro-price-block.html'), 'utf8');

// --- the prompt's table --------------------------------------------------------------
assert.equal(parseMoney('2.146,24 TL'), 2146.24, 'TR format');
assert.equal(parseMoney('$1,234.56'), 1234.56, 'EN format');
assert.equal(parseMoney('1,234.56 USD'), 1234.56, 'EN format with the mark after');
assert.equal(parseMoney('2146 TL'), 2146, 'integer with a currency');
assert.equal(parseMoney('1.234,56'), 1234.56, 'TR grouping');
assert.equal(parseMoney('46.236,14 TL'), 46236.14, 'the real Rhino price');
assert.equal(parseMoney('2.146.236,14 TL'), 2146236.14, 'a number is still a number...');

// --- ...but never invented out of several numbers ------------------------------------
assert.equal(parseMoney('%21 46.236,14 TL'), null, 'a discount badge is not glued onto a price');
assert.equal(parseMoney('21 46.236,14'), null, 'two numbers are not one price');
assert.equal(parseMoney('58.526,76 TL 46.236,14 TL'), null, 'sale and list are not concatenated');
assert.equal(parseMoney('K2 Plus Combo 100'), null, 'a model number is not a price');
assert.equal(parseMoney('stok kodu RHN-52392'), null, 'a product code is not a price');
assert.equal(parseMoney('2146236'), 2146236, 'a single integer is a price when it is alone');
assert.equal(parseMoney('0 TL'), null, 'zero is not a price');
assert.equal(parseMoney(undefined), null);
assert.equal(parseMoney(NaN), null);

// --- locale tables --------------------------------------------------------------------
assert.equal(toAmount('2.146,24'), 2146.24, 'last separator wins: dot grouping, comma decimal');
assert.equal(toAmount('2,146.24'), 2146.24, 'last separator wins: comma grouping, dot decimal');
assert.equal(toAmount('1.234.567'), 1234567, 'all grouping');

// --- picking the right amount out of page text ---------------------------------------
const badgeAndSale = "Creality K2 Pro Combo 3D Yazıcı %21 58.526,76 TL 46.236,14 TL 4.858,65 TL 'den başlayan taksitlerle";
const picked = pickMoney(badgeAndSale, { currency: 'TRY' });
assert.equal(picked.amount, 46236.14, 'the sale price, not the list price and not the badge');
assert.equal(picked.was, 58526.76, 'the list price is reported as "was"');
assert.equal(picked.currency, 'TRY', 'the currency is read from the page, not assumed');
assert.equal(pickMoney('2500 TL ÜZERİ ALIŞVERİŞTE KARGO ÜCRETSİZ'), null, 'shipping threshold rejected');
assert.equal(pickMoney("4.858,65 TL 'den başlayan taksitlerle"), null, 'installment rejected');
assert.equal(pickMoney('Bambu Lab H2C Laser Full Combo 10W 163.289,66 TL Sepete Ekle').amount, 163289.66, 'THREE D and the wattage do not become the price');
assert.equal(pickMoney('$1,234.56').amount, 1234.56, 'USD stays USD');
assert.equal(pickMoney('$1,234.56').currency, 'USD', 'and is never relabelled as TRY');
assert.equal(pickMoney('K2 Plus Combo 100'), null, 'nothing believable in a model name');

// --- the real page ---------------------------------------------------------------------
assert.equal(cardPrice(fixture), 46236.14, 'the harvested card gives the true listing price');
const detail = cardPriceDetail(fixture);
assert.equal(detail.currency, 'TRY');
assert.equal(detail.suspect, false, 'and it is not flagged');
const page = pickPrice(fixture, null, { currency: 'TRY' });
assert.equal(page.price, 46236.14, 'the product page path agrees');
assert.equal(page.was, 58526.76, 'list price as was');
assert.equal(page.suspect, false);

// --- sanity gates ----------------------------------------------------------------------
assert.equal(isSuspectAmount(2146236.14, 'TRY'), true, '2.1M TL is not an FDM printer');
assert.equal(isSuspectAmount(9133172.77, 'TRY'), true, '9.1M TL either');
assert.equal(isSuspectAmount(600000, 'TRY'), false, 'the industrial AT1000 at 600.000 TL is real');
assert.equal(isSuspectAmount(46236.14, 'TRY'), false);
assert.equal(isSuspectAmount(25000, 'USD'), true, 'USD has its own ceiling');
assert.equal(isSuspectAmount(2146.24, 'USD'), false);

// A row where one shop is ten times its own comparison group is a parse failure, not a bargain.
const rows = [{
  id: 'p', name: 'Creality K2 Combo',
  offers: [
    { store: 'rhino', price: 46236.14 },
    { store: 'urhan', price: 46848.14 },
    { store: 'robolink', price: 34267.5 },
    { store: 'broken', price: 2146236.14 }
  ]
}];
assert.equal(flagPriceOutliers(rows), 1, 'exactly the outlier is flagged');
assert.equal(rows[0].offers[3].priceSuspect, 'over-cap');
assert.equal(rows[0].offers[0].priceSuspect, undefined, 'normal prices are untouched');
const trustedOnly = rows[0].offers.filter((o) => !o.priceSuspect && !o.outOfStock);
assert.equal(Math.min(...trustedOnly.map((o) => o.price)), 34267.5, 'best price comes from a believable offer');

// --- the storefront never lets a suspect win -------------------------------------------
const vm = require('node:vm');
const nodes = new Map();
const node = (sel) => { if (!nodes.has(sel)) nodes.set(sel, { hidden: true, innerHTML: '', textContent: '', dataset: {}, contains: () => false }); return nodes.get(sel); };
const context = {
  URL, Response, console,
  window: {
    SITE_CONTENT: {
      desk: {}, locations: [], aisles: [], banners: [], ads: [], units: [], products: [],
      live: { compared: 'Compared' }, cart: {}, sheet: {}, bestOffer: 'Best', brand: {}, dir: {},
      documentTitle: {}, emptyAisle: {}, emptySearchBody: {}, emptySearchTitle: {}, filament: {}, header: {},
      hunter: {}, lang: {}, offerCount: {}, productExact: {}, productPhrases: {}, profile: {}, resultsCount: {},
      savedDeal: {}, saveDeal: {}, wasPrice: 'was'
    }
  },
  document: {
    querySelector: node, querySelectorAll: () => [], addEventListener() {}, body: {},
    documentElement: { lang: '', dataset: {}, classList: { add() {}, remove() {}, toggle() {} } },
    createElement: () => ({ dataset: {}, style: {}, appendChild() {}, setAttribute() {} })
  },
  location: { hash: '', search: '' }, localStorage: { getItem: () => null, setItem() {} },
  setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, clearTimeout() {}, requestAnimationFrame: () => 1,
  addEventListener() {}, fetch: async () => ({ ok: false, status: 404, json: async () => ({}) }),
  ResizeObserver: function () { this.observe = () => {}; }
};
const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8')
  .split('\r\n').join('\n')
  .replace(/\n\s*initStatic\(\);/, '').replace(/\n\s*bind\(\);/, '').replace(/\n\s*huntRhino\([^)]*\);/, '');
vm.runInNewContext(src, context);
const api = context.window.__3dp;
const product = {
  id: 'p1', name: 'Creality K2 Combo', image: 'https://a/1.webp',
  offers: [
    { store: 'broken.example', price: 2146236.14, url: 'https://broken/1', priceSuspect: 'over-cap', stockStatus: 'in_stock' },
    { store: 'rhino.example', price: 46236.14, url: 'https://rhino/1', stockStatus: 'in_stock' }
  ]
};
assert.equal(api.bestOffer(product).store, 'rhino.example', 'the 2.1M offer never becomes the headline price');
assert.equal(api.liveOffers(product).length, 2, 'it stays visible for comparison, just not as best');

console.log('PASS: prices parse by locale, badges and neighbours are never glued, the Rhino card reads 46.236,14 and nonsense is flagged instead of believed.');
