// The real Filament Marketim pages (saved from the shop): Porima PETG Transparan (6 colours, one sold out) and
// the filament category page. Bugs seen on them:
//  1. The shop's buy button is <button class="btn btn-cart" onclick="addCart(…)">Ekle</button>: no "Sepete ekle"
//     anywhere, so a product page (and every category card) read "no add to cart" = out of stock.
//  2. "Transparan" in the name made the listing a one-colour product (colour: clear), so its colour dropdown
//     was never opened and the card stayed out of stock; once opened, "Transparan" also beat every option's
//     own colour (Neon Sarı came out clear).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readStockFromHtml, extractCards } = require('../lib/harvest.js');
const { normalizeFilamentListing, needsVariantPage, offersColourChoice, variantListings } = require('../lib/qwen-website-job.cjs');

const dir = path.join(__dirname, 'fixtures', 'pages', 'variants', 'live');
const page = fs.readFileSync(path.join(dir, 'filamentmarketim-porima-petg-transparan.html'), 'utf8');
const category = fs.readFileSync(path.join(dir, 'filamentmarketim-category.html'), 'utf8');
const url = 'https://www.filamentmarketim.com/porima-petg-transparan-filament';

// 1. The buy button counts.
const stock = readStockFromHtml(page);
assert.equal(stock.status, 'in_stock', 'the product page sells: "Ekle" (addCart) is its buy button');
assert.equal(stock.evidence, 'add-to-cart');
const cards = extractCards(category);
assert.equal(cards.length, 24);
assert.equal(cards.filter((c) => readStockFromHtml(c.html).status !== 'in_stock').length, 0, 'no category card reads out of stock for lack of a "Sepete ekle"');

// A product that is really sold out still reads so: the button is gone or the page says so.
assert.equal(readStockFromHtml('<html><body><h1>Spool</h1><div class="price">500 TL</div><p>Stokta yok</p></body></html>').status, 'out_of_stock');

// 2. The family opens although the name carries a colour word.
const base = normalizeFilamentListing({ name: 'Porima PETG Transparan Filament', brand: 'Porima', kind: 'filament', url, price: 845.07, stockStatus: 'unknown' });
assert.equal(base.color, 'clear', 'the title alone says clear');
assert.equal(needsVariantPage(base), false);
assert.equal(offersColourChoice(base, page, 845.07), true, 'but the page offers 6 colours');
assert.equal(offersColourChoice(base, '<html><h1>Porima PETG Transparan Filament</h1></html>', 845.07), false, 'a page with no colour options stays one product');
assert.equal(offersColourChoice({ ...base, variantOf: url }, page, 845.07), false, 'a colour page is not a family');

const made = variantListings(base, page);
assert.equal(made.listings.length, 5, 'the 5 colours in stock');
assert.equal(made.outOfStock.length, 1, 'only Şarap Kırmızı is sold out');
assert.deepEqual(made.listings.map((l) => l.colorName), ['Neon Sarı', 'Neon Turuncu', 'Neon Yeşil', 'Buz Mavi', 'Gece Mavi']);
assert.deepEqual(made.listings.map((l) => l.color), ['yellow', 'orange', 'neon-green', 'ice-blue', 'blue'], 'each its own colour, not "clear"');
assert.equal(new Set(made.listings.map((l) => l.image)).size, 5, 'each colour its own photo');
assert.ok(made.listings.every((l) => l.variantOf === url && l.price === 845.07));

console.log('PASS: on the real Porima PETG Transparan page the "Ekle" buy button counts, the 6 colours open as a family (5 in stock, 1 sold out) and each keeps its own colour and photo.');
