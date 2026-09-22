const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const files = {
  'catalog.json': { products: [
    { id: 'shop-a1', name: 'Bambu Lab A1 Combo 3D Yazıcı', brand: 'Bambu Lab', kind: 'printer', image: '/shop.webp', price: 1, offers: [] },
    { id: 'new-z9', name: 'Acme Z9 3D Yazıcı', brand: 'Acme', kind: 'printer', image: '/new.webp', price: 1, offers: [] }
  ], filaments: [] },
  'baseline.json': { items: [{ id: 'base-a1', name: 'Bambu Lab A1 Combo', brand: 'Bambu Lab', category: 'printers', image: '/baseline.webp' }] }
};
const source = fs.readFileSync(path.join(__dirname, '..', 'netlify', 'functions', 'hunt.mjs'), 'utf8')
  .replace(/^import .*;$/gm, '')
  .replace('export default async', 'globalThis.handler = async');
const sandbox = {
  Response, URL,
  store: { readJSON: async (key, fallback) => JSON.parse(JSON.stringify(files[key] || fallback)) },
  catalogUnion: require('../lib/catalog-union.cjs'),
  search: require('../lib/search-match.cjs'),
  boardLib: require('../lib/baseline-board.cjs')
};
vm.runInNewContext(source, sandbox);

(async () => {
  const response = await sandbox.handler({ url: 'https://example.com/api/hunt' });
  const body = await response.json();
  assert.equal(body.products.find((p) => /A1 Combo/i.test(p.name)).image, '/baseline.webp');
  assert.equal(body.products.find((p) => /Acme Z9/i.test(p.name)).image, '/new.webp');
  console.log('PASS: storefront prefers the baseline thumbnail and preserves a unique model catalog image.');
})().catch((err) => { console.error(err); process.exitCode = 1; });
