// Filament Marketim rainbow / glow products (hand-checked in Chrome on the live pages; the saved pages used here
// are the real Elas and Porima PETG Transparan pages, which draw their options the same way):
//  1. A product with "Rainbow" in the title is multicolor, which kept it out of the colour-family path: the
//     colour <select> on Apex3D Rainbow / Sunlu Silk Rainbow / Sunlu Rainbow was never read and each came out
//     as one card. A page that offers 2+ colours is the family whatever the title says.
//  2. The "Tür" row (div.related-products: Makaralı / Makarasız / 3Kg) links to OTHER products. When the 3Kg
//     product is sold out its link carries <a class="tukendi-urun"><span class="tukendi-label">Tükendi</span>:
//     that read as this product being out of stock (porima-rainbow-pla, pastel, premium, sunlu-rainbow).
// The sold-out "Tür" link is injected into the real Porima page, in the markup read from the live DOM.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readStockFromHtml } = require('../lib/harvest.js');
const { normalizeFilamentListing, needsVariantPage, offersColourChoice, variantListings } = require('../lib/qwen-website-job.cjs');
const { checkOfferStock, readStockPage } = require('../lib/stock-refresh.cjs');

const dir = path.join(__dirname, 'fixtures', 'pages', 'variants', 'live');
const elas = fs.readFileSync(path.join(dir, 'filamentmarketim-elas-pla-pro.html'), 'utf8');
const porima = fs.readFileSync(path.join(dir, 'filamentmarketim-porima-petg-transparan.html'), 'utf8');

(async () => {
  // 1. A multicolor title does not hide the colour options.
  const url = 'https://www.filamentmarketim.com/elas-pla-pro-filament';
  const base = normalizeFilamentListing({ name: 'Elas Rainbow PLA+ Filament', brand: 'Elas', kind: 'filament', url, price: 499, stockStatus: 'unknown' });
  assert.equal(base.multicolor, true, 'a Rainbow title is multicolor');
  assert.equal(needsVariantPage(base), false);
  assert.equal(offersColourChoice(base, elas, 499), true, 'but the page offers 34 colour options');
  assert.equal(offersColourChoice(base, '<html><h1>Elas Rainbow PLA+ Filament</h1></html>', 499), false, 'no options: still one product');
  const made = variantListings(base, elas);
  assert.equal(made.listings.length, 23, '23 in stock');
  assert.equal(made.outOfStock.length, 11, '11 sold out');
  assert.equal(new Set(made.listings.map((l) => l.image)).size, 23, 'each its own photo');
  assert.ok(made.listings.every((l) => l.variantOf === url && l.variantLabel));
  assert.ok(made.listings.every((l) => l.colorName || l.color || l.multicolor), 'each option keeps a colour name');

  // 2. A sold-out "Tür" link is another product's stock.
  const turLink = /<a href="https:\/\/www\.filamentmarketim\.com\/porima-petg-filament-3kg" class=" " title="Porima PETG Filament - 3Kg">([\s\S]*?)<\/a>/;
  assert.ok(turLink.test(porima), 'the real page has the 3Kg link in its Tür row');
  const soldOutTur = porima.replace(turLink, (m, inner) => '<a href="https://www.filamentmarketim.com/porima-petg-filament-3kg" class="tukendi-urun " title="Porima PETG Filament - 3Kg">' + inner + '<span class="tukendi-label">Tükendi</span></a>');
  assert.notEqual(soldOutTur, porima);
  assert.equal(readStockFromHtml(soldOutTur).status, 'in_stock', 'a sold-out 3Kg link does not sell out the 1Kg page');
  assert.notEqual(readStockPage(soldOutTur).status, 'out_of_stock');
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => soldOutTur });
  const live = await checkOfferStock('https://www.filamentmarketim.com/porima-petg-transparan-filament?variant=Neon+Ye%C5%9Fil', { fetchImpl, retries: 0 });
  assert.equal(live.status, 'in_stock', 'the later live check agrees');

  // A product that really is sold out still reads so.
  // (sold-out buy buttons on this shop are disabled "STOKTA YOK" ones, as the similar-products cards show)
  const sold = porima.replace(/<button class="btn btn-cart[^"]*"([\s\S]*?)<\/button>/, '<button class="btn btn-cart disabled" disabled>STOKTA YOK</button>');
  assert.notEqual(sold, porima, 'the real buy button was found');
  assert.equal(readStockFromHtml(sold).status, 'out_of_stock', 'the main product sold out: still out of stock');

  console.log('PASS: a colour dropdown opens as a family even for a Rainbow title, and a sold-out "Tür" link (another product) no longer sells out this product.');
})().catch((e) => { console.error(e); process.exit(1); });
