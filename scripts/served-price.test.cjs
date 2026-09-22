// The storefront serves exactly what the catalog stores. VAT is applied once, in the
// desk-driven admin re-price — never invented at page-serve time for a named shop.
const assert = require('node:assert/strict');
const union = require('../lib/catalog-union.cjs');

assert.equal(union.ensureIncludedVat, undefined, 'no per-shop VAT may run on the serve path');

const catalog = {
  products: [{
    id: 'p1',
    name: 'Bambu Lab H2S 3D Yazıcı',
    offers: [
      { store: 'store.metatechtr.com', price: 71315.41, url: 'https://store.metatechtr.com/h2s', vatIncluded: true, vatAdded: true },
      { store: 'rhino3dprinter.com', price: 70000, url: 'https://www.rhino3dprinter.com/h2s', vatIncluded: true, vatAdded: false },
      { store: 'legacy.example', url: 'https://legacy.example/no-price' }
    ]
  }, { id: 'empty', name: 'Legacy row', offers: [{ store: 'legacy.example', url: 'https://legacy.example/empty' }] }],
  filaments: []
};
const served = union.pricesToTry(union.collapseByMagellan(catalog));
const prices = served.products[0].offers.map((o) => o.price).sort((a, b) => a - b);
assert.deepEqual(prices, [70000, 71315.41], 'served prices are the stored prices, untouched: ' + prices);
assert.equal(served.products.some((p) => p.id === 'empty'), false, 'a row with no purchasable numeric price is not served');
// A gross price stays gross however many shops and passes it goes through.
const again = union.pricesToTry(union.collapseByMagellan(served));
assert.deepEqual(again.products[0].offers.map((o) => o.price).sort((a, b) => a - b), prices, 'serving twice changes nothing');

console.log('PASS: no VAT is invented on the serve path; the storefront shows the stored prices.');
