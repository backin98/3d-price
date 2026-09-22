const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const files = {
  'catalog.json': { products: [{ id: 'p1', name: 'Printer', offers: [{ url: 'https://shop.example/p1' }] }, { id: 'p2', name: 'Printer 2', offers: [{ url: 'https://shop.example/p2' }] }], filaments: [] },
  'desk.json': { shops: [] }, 'jobs.json': []
};
const bytes = {};
const store = {
  readJSON: async (key, fallback) => key in files ? files[key] : fallback,
  writeJSON: async (key, value) => { files[key] = value; },
  writeBytes: async (key, value) => { bytes[key] = Buffer.from(value); },
  readBytes: async (key) => bytes[key] || null,
  deleteKey: async () => {}
};
const adminSource = fs.readFileSync('netlify/functions/admin.mjs', 'utf8')
  .replace(/^import .*;$/gm, '')
  .replace('export default async', 'globalThis.handler = async');
const sandbox = {
  Buffer, URL, Response, crypto: require('node:crypto'), store,
  auth: { ownerFromHeaders: () => ({ role: 'owner' }), authReady: () => true },
  money: require('../lib/parse-money.cjs'), matcher: require('../lib/product-match.cjs'),
  baselineLib: require('../lib/baseline-catalog.js'), boardLib: require('../lib/baseline-board.cjs')
};
vm.runInNewContext(adminSource, sandbox);

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const post = (body) => new Request('https://example.com/api/admin', {
  method: 'POST', headers: { origin: 'https://example.com', 'content-type': 'application/json' }, body: JSON.stringify(body)
});

(async () => {
  const saved = await sandbox.handler(post({
    action: 'updateProduct', id: 'p1', patch: { name: 'Printer edited' },
    imageUpload: { type: 'image/png', data: png.toString('base64') }
  }));
  assert.equal(saved.status, 200, await saved.text());
  const image = files['catalog.json'].products[0].image;
  assert.match(image, /^\/api\/product-image\?key=p1-\d+$/);
  const key = 'product-images/' + new URL(image, 'https://example.com').searchParams.get('key');
  assert.deepEqual(bytes[key], png, 'the image is stored separately from catalog JSON');

  const bad = await sandbox.handler(post({ action: 'updateProduct', id: 'p1', imageUpload: { type: 'image/svg+xml', data: 'PHN2Zz4=' } }));
  assert.equal(bad.status, 400, 'unsafe image formats are refused');

  const batch = await sandbox.handler(post({ action: 'updateProducts', items: [
    { id: 'p1', patch: { name: 'Printer one' } },
    { id: 'p2', patch: { name: 'Printer two' } }
  ] }));
  assert.equal(batch.status, 200, await batch.text());
  assert.deepEqual(files['catalog.json'].products.map((p) => p.name), ['Printer one', 'Printer two'], 'Update catalog saves every edited card in one write');
  assert.ok(files['catalog.json'].savedAt, 'the catalog save time reflects the update');

  const imageSource = fs.readFileSync('netlify/functions/product-image.mjs', 'utf8')
    .replace(/^import .*;$/gm, '')
    .replace('export default async', 'globalThis.imageHandler = async');
  vm.runInNewContext(imageSource, sandbox);
  const shown = await sandbox.imageHandler(new Request('https://example.com/api/product-image?key=' + key.split('/')[1]));
  assert.equal(shown.status, 200);
  assert.equal(shown.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await shown.arrayBuffer()), png);
  console.log('PASS: catalog edits save together; thumbnails are validated, stored separately, and served publicly.');
})().catch((err) => { console.error(err); process.exitCode = 1; });
