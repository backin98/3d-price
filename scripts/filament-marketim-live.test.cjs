// The real Filament Marketim product page (saved from the shop: elas-pla-pro-filament). Its 34 colours are
// a dropdown, so the run reads them without clicking, and the dropdown has no pictures: every colour came
// out with the product's one photo. The page marks each colour's own gallery slide and swatch with
// data-variant-value="<colour>"; each colour must get that picture.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { variantsFromPage } = require('../lib/product-variants.cjs');
const { listingsFromOptions, normalizeFilamentListing } = require('../lib/qwen-website-job.cjs');

const url = 'https://www.filamentmarketim.com/elas-pla-pro-filament';
const html = fs.readFileSync(path.join(__dirname, 'fixtures', 'pages', 'variants', 'live', 'filamentmarketim-elas-pla-pro.html'), 'utf8');
const found = variantsFromPage(html, url, { pagePrice: 499 });
assert.equal(found.variants.length, 34, 'every colour of the dropdown');
assert.equal(found.variants.filter((v) => !v.image).length, 0, 'every colour has a picture');
assert.equal(new Set(found.variants.map((v) => v.image)).size, 34, 'and no two colours share one');
const pic = (label) => found.variants.find((v) => v.label === label).image.split('/').pop();
assert.equal(pic('Beyaz'), '68cd07ab0118c-94438466-sw1080sh1080.webp', 'Beyaz: its own slide');
assert.equal(pic('Kırmızı'), '68cd07c33660e-3905919-sw1080sh1080.webp');
assert.equal(pic('Kahverengi'), '68cd08276b818-29340828-sw550sh550.webp');
assert.ok(!found.variants.some((v) => /elas-pla-pro-filament-7918129/.test(v.image)), 'the product photo is no colour\'s picture');

// The run's colour listings keep those pictures (one card per colour, each its own photo).
const base = normalizeFilamentListing({ name: 'Elas PLA Pro Filament', brand: 'Elas', kind: 'filament', url, price: 499, image: 'https://cdn.qukasoft.com/f/443764/b3NXVUoyVTArYkI4Tmk4Z0djOXJKYjRQSVl5OA/p/elas-pla-pro-filament-7918129-sw1080sh1080.webp', stockStatus: 'in_stock', stockVerified: true });
const made = listingsFromOptions(base, found);
assert.ok(made.listings.length >= 2);
assert.equal(new Set(made.listings.map((l) => l.image)).size, made.listings.length, 'each colour listing its own photo');
assert.ok(made.listings.every((l) => l.image !== base.image));

console.log('PASS: the real Filament Marketim page gives each of its 34 colours its own photo (gallery slide / swatch marked with the colour), not the product photo.');
