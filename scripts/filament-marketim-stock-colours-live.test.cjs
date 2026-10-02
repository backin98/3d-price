// The real Filament Marketim product page (saved from the shop: elas-pla-pro-filament), 34 colours, 11 of them
// sold out. Two bugs seen on it:
//  1. One sold-out colour ("Siyah — Tükendi") read as the whole product being out of stock: the page-level
//     stock reading took the swatch's "Tükendi" for the product's. A sold-out colour is that colour's stock.
//  2. Colours the colour table did not know ("Vişne Çürüğü", "Kiremit", "İnci Beyaz", "Gümüş Gri" …) got no
//     swatch colour picked automatically (Mermer, a marble finish, has no single colour).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readStockFromHtml, soldOutSwatchLabels } = require('../lib/harvest.js');
const { variantsFromPage } = require('../lib/product-variants.cjs');
const { listingsFromOptions, normalizeFilamentListing } = require('../lib/qwen-website-job.cjs');
const { checkOfferStock, readStockPage } = require('../lib/stock-refresh.cjs');
const colours = require('../lib/filament-colours.cjs');

const url = 'https://www.filamentmarketim.com/elas-pla-pro-filament';
const html = fs.readFileSync(path.join(__dirname, 'fixtures', 'pages', 'variants', 'live', 'filamentmarketim-elas-pla-pro.html'), 'utf8');

// 1. Stock: sold-out colours are the colours', never the page's.
assert.notEqual(readStockFromHtml(html).evidence, 'page', 'a sold-out colour swatch is not page-level out-of-stock evidence');
assert.equal(soldOutSwatchLabels(html).size, 11, 'the 11 sold-out swatches are read by colour');
assert.ok(soldOutSwatchLabels(html).has('siyah'));
assert.ok(!soldOutSwatchLabels(html).has('beyaz'));
assert.notEqual(readStockPage(html).method, 'buy-box-sold-out');

const found = variantsFromPage(html, url, { pagePrice: 499 });
assert.equal(found.variants.filter((v) => v.stock === 'out_of_stock').length, 11);
const base = normalizeFilamentListing({ name: 'Elas PLA Pro Filament', brand: 'Elas', kind: 'filament', url, price: 499, image: 'https://cdn.qukasoft.com/x/elas-pla-pro-filament-7918129-sw1080sh1080.webp', stockStatus: 'in_stock', stockVerified: true });
const made = listingsFromOptions(base, found);
assert.equal(made.listings.length, 23, 'the 23 colours in stock become listings');
assert.equal(made.outOfStock.length, 11, 'only the 11 sold-out colours are left out');

const live = (async () => {
// The later live check, per colour page: Siyah sold out, Beyaz in stock (neither says anything about the other).
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => html });
  const siyah = await checkOfferStock(url + '?variant=Siyah', { fetchImpl, retries: 0 });
  const beyaz = await checkOfferStock(url + '?variant=Beyaz', { fetchImpl, retries: 0 });
  assert.equal(siyah.status, 'out_of_stock');
  assert.equal(beyaz.status, 'in_stock', 'Beyaz is in stock although Siyah is sold out');
})();

// 2. Colour table: every colour of the page resolves to a colour (the admin picks its swatch from it), and
// "Mermer" is a marble finish, not one shade: nothing to pick.
const fold = (v) => String(v == null ? '' : v).toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/ı/g, 'i').replace(/\s+/g, ' ').trim();
const words = (s) => ' ' + fold(s).replace(/[^\p{L}\p{N}+]+/gu, ' ').trim() + ' ';
const names = Object.entries(colours).flatMap(([id, c]) => [id, c.name, ...(c.aliases || [])].map((a) => ({ id, w: words(a) }))).filter((x) => x.w.trim()).sort((a, b) => b.w.length - a.w.length);
const coloursIn = (value) => { let rest = words(value); const out = []; for (const { id, w } of names) if (rest.includes(w)) { out.push(id); rest = rest.replace(w, ' '); } return [...new Set(out)]; };
// ("Gümüş Gri" stays silver + gray and the pastel / pistachio / aqua names stay on their base colour: the
// gathered baseline files them that way, and filament-baseline-gathered.test.cjs guards it.)
const unresolved = found.variants.map((v) => v.label).filter((l) => !coloursIn(l).length);
assert.deepEqual(unresolved, ['Mermer'], 'only the marble finish has no single colour');
assert.deepEqual(coloursIn('İnci Beyaz'), ['pearl-white']);
assert.deepEqual(coloursIn('Vişne Çürüğü'), ['burgundy']);
assert.deepEqual(coloursIn('Kiremit'), ['terracotta']);
assert.deepEqual(coloursIn('Siyah'), ['black'], 'the colours that already worked still do');

live.then(() => console.log('PASS: on the real Filament Marketim page a sold-out colour is only that colour\'s stock, and every colour but the marble finish gets its swatch colour.'));
