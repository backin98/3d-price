// KDV is money: flipping a shop's policy must re-price exactly that shop's offers, and
// flipping back must land on the original number, not compound the 20%.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const offer = (host, price, extra = {}) => ({ store: host, price, url: 'https://' + host + '/p', vatIncluded: true, ...extra });
const store = {
  'desk.json': {
    id: 'desk',
    shops: [
      { id: 'robotzade.com', name: 'Robotzade', url: 'https://www.robotzade.com', enabled: true, vat: 'included', categories: [] },
      { id: 'rhino', name: 'Rhino 3D Printer', url: 'https://www.rhino3dprinter.com', enabled: true, vat: 'included', categories: [] }
    ],
    categories: [],
    banners: [],
    promoted: []
  },
  'jobs.json': [],
  'catalog.json': {
    products: [
      { id: 'qwen-p1s', name: 'Bambu Lab P1S Combo 3D Yazıcı', kind: 'printer', brand: 'Bambu Lab', offers: [offer('robotzade.com', 29155, { was: 30000 }), offer('rhino3dprinter.com', 20000)] },
      { id: 'qwen-forced', name: 'Filament Plus KDV', kind: 'filament', brand: 'X', offers: [offer('robotzade.com', 100, { vatForced: true })] }
    ],
    filaments: []
  },
  'candidate.json': { products: [{ id: 'qwen-cand', name: 'New Shipment', kind: 'printer', brand: 'Bambu Lab', offers: [offer('robotzade.com', 1000)] }], filaments: [] }
};

const context = {
  URL,
  Response,
  crypto: require('node:crypto'),
  store: {
    readJSON: async (key, fallback) => (key in store ? store[key] : fallback),
    writeJSON: async (key, value) => { store[key] = value; },
    deleteKey: async (key) => { delete store[key]; }
  },
  auth: { ownerFromHeaders: () => ({ role: 'owner' }), authReady: () => true }
};
// The handler imports lib/parse-money.cjs; the vm has no module loader, so hand it over.
const source = fs.readFileSync('netlify/functions/admin.mjs', 'utf8')
  .replace(/^import .*;$/gm, '')
  .replace('export default async', 'globalThis.handler = async');
const sandbox = { ...context, money: require('../lib/parse-money.cjs'), matcher: require('../lib/product-match.cjs'), baselineLib: require('../lib/baseline-catalog.js'), boardLib: require('../lib/baseline-board.cjs') };
vm.runInNewContext(source, sandbox);

const post = (body) => new Request('https://example.com/api/admin', {
  method: 'POST',
  headers: { origin: 'https://example.com', 'content-type': 'application/json' },
  body: JSON.stringify(body)
});
const prices = () => store['catalog.json'].products.map((p) => p.offers.map((o) => o.price));
const robot = () => store['catalog.json'].products.find((p) => p.id === 'qwen-p1s').offers[0];
const rhino = () => store['catalog.json'].products.find((p) => p.id === 'qwen-p1s').offers[1];

(async () => {
  // The exact numbers the user saw: Robotzade's 29155 is net, so gross is 34986.
  let res = await sandbox.handler(post({ action: 'saveShopVat', shop: 'robotzade.com', vat: 'excluded' }));
  let body = await res.json();
  assert.equal(res.status, 200);
  // Counted from the live catalog only: the candidate usually mirrors it, and the user
  // is being told how many storefront prices moved.
  assert.equal(body.offers, 1, 'the live printer offer was re-priced: ' + JSON.stringify(body));
  assert.equal(body.skipped, 1, 'the page-forced +KDV offer is left alone');
  assert.equal(body.checked, 2, "both of this shop's catalog offers were inspected");
  assert.equal(robot().price, 34986, '29155 * 1.2');
  assert.equal(robot().was, 36000, 'the old price is re-priced too (30000 * 1.2)');
  assert.equal(robot().vatAdded, true);
  assert.equal(rhino().price, 20000, 'another shop is untouched');
  assert.equal(store['catalog.json'].products[1].offers[0].price, 100, 'a forced-VAT offer keeps its price');
  assert.equal(store['candidate.json'].products[0].offers[0].price, 1200, 'the candidate is re-priced, so publishing cannot undo it');
  assert.equal(store['desk.json'].shops[0].vat, 'excluded');
  assert.equal(store['desk.json'].shops[1].vat, 'included');

  // Applying the same policy again must not compound.
  res = await sandbox.handler(post({ action: 'saveShopVat', shop: 'robotzade.com', vat: 'excluded' }));
  assert.equal(robot().price, 34986, 'no compounding on a repeated save');

  // Back to included: exactly the original numbers.
  res = await sandbox.handler(post({ action: 'saveShopVat', shop: 'robotzade.com', vat: 'included' }));
  body = await res.json();
  assert.equal(robot().price, 29155, 'round trip returns the shop\'s own price');
  assert.equal(robot().was, 30000);
  assert.equal(robot().vatAdded, false);
  assert.equal(store['candidate.json'].products[0].offers[0].price, 1000);

  // Round-tripping again through the decimal path stays exact.
  await sandbox.handler(post({ action: 'saveShopVat', shop: 'robotzade.com', vat: 'excluded' }));
  assert.equal(robot().price, 34986);
  await sandbox.handler(post({ action: 'saveShopVat', shop: 'robotzade.com', vat: 'included' }));
  assert.equal(robot().price, 29155);

  // Filaments are re-priced too, and an unknown shop is rejected.
  store['catalog.json'].filaments = [{ id: 'f1', name: 'PLA', kind: 'filament', offers: [offer('robotzade.com', 120)] }];
  await sandbox.handler(post({ action: 'saveShopVat', shop: 'robotzade.com', vat: 'excluded' }));
  assert.equal(store['catalog.json'].filaments[0].offers[0].price, 144);
  const bad = await sandbox.handler(post({ action: 'saveShopVat', shop: 'nope', vat: 'excluded' }));
  assert.equal(bad.status, 400);

  // Pressing the button twice is a no-op, so it is safe as a manual refresh.
  const again = await (await sandbox.handler(post({ action: 'saveShopVat', shop: 'robotzade.com', vat: 'excluded' }))).json();
  assert.equal(again.checked, 3, 'the filament offer is inspected too');
  assert.equal(store['catalog.json'].filaments[0].offers[0].price, 144, 'and stays put on a second press');

  console.log('PASS: KDV flip re-prices one shop exactly, round-trips without compounding, and spares page-forced +KDV.');
})().catch((e) => { console.error(e); process.exitCode = 1; });
