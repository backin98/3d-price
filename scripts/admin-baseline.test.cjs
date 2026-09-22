const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { emptyBoard, fromProduct, fromRunCard, upsertItems, loadBackupPrinters, sanitizeItem, addCategory, renameCategory, patchItem, addItem } = require('../lib/baseline-board.cjs');

const board = emptyBoard();
assert.ok(board.categories.some((c) => c.id === 'printers'));
assert.ok(board.categories.some((c) => c.id === 'filaments'));
const printers = loadBackupPrinters();
assert.ok(printers.length > 50, 'backup snapshot should hold the v0.0.1 printers, got ' + printers.length);
const stats = upsertItems(board, printers.slice(0, 2).map((p) => fromProduct(p, 'backup')));
assert.equal(stats.added, 2);
assert.equal(board.items[0].offers, undefined, 'baseline models do not carry offers');
assert.equal(board.items[0].shops, undefined);
const runCard = fromRunCard({ name: 'Elegoo Neptune 4 Pro', url: 'https://shop.example/n4p', brand: 'Elegoo' }, { id: 'job-1', kind: 'printer' });
assert.equal(runCard.category, 'printers');
assert.equal(runCard.offers, undefined);
assert.equal(sanitizeItem({ id: 'x', name: 'K2', brand: 'Creality', offers: [{ url: 'https://x' }], shops: ['a'] }).offers, undefined);
addCategory(board, 'Resin');
assert.ok(board.categories.some((c) => c.name === 'Resin'));
renameCategory(board, 'resin', 'Resin printers');
assert.equal(board.categories.find((c) => c.id === 'resin').name, 'Resin printers');
patchItem(board, board.items[0].id, { category: 'filaments', name: board.items[0].name });
assert.equal(board.items[0].category, 'filaments');
addItem(board, { name: 'Hand approved P1S', brand: 'Bambu Lab', category: 'printers' });
assert.ok(board.items.some((i) => i.name === 'Hand approved P1S'));

const source = fs.readFileSync(path.join(__dirname, '..', 'netlify', 'functions', 'admin.mjs'), 'utf8')
  .replace(/^import .*;$/gm, '')
  .replace('export default async', 'globalThis.handler = async');
const files = {
  'catalog.json': { products: [{ id: 'p1', name: 'Creality K2 Combo', brand: 'Creality', kind: 'printer', offers: [{ store: 'a.com', url: 'https://a/k2' }] }], filaments: [] },
  'desk.json': { shops: [] },
  'jobs.json': [
    { id: 'job-1', status: 'complete', url: 'https://shop.example/3d', kind: 'printer', cards: { u: { name: 'Elegoo Neptune 4 Pro', url: 'https://shop.example/n4p', brand: 'Elegoo', kind: 'printer' } } },
    { id: 'job-run', status: 'running', url: 'https://shop.example/x' },
    { id: 'job-q', status: 'queued', url: 'https://shop.example/y' }
  ]
};
const bytes = {};
const store = {
  readJSON: async (key, fallback) => (key in files ? JSON.parse(JSON.stringify(files[key])) : fallback),
  writeJSON: async (key, value) => { files[key] = JSON.parse(JSON.stringify(value)); },
  writeBytes: async (key, value) => { bytes[key] = Buffer.from(value); },
  deleteKey: async (key) => { delete files[key]; }
};
const sandbox = {
  console, Response, URL, Buffer,
  money: require('../lib/parse-money.cjs'),
  store,
  auth: { ownerFromHeaders: () => ({ role: 'owner' }), authReady: () => true },
  matcher: require('../lib/product-match.cjs'),
  boardLib: require('../lib/baseline-board.cjs')
};
vm.runInNewContext(source, sandbox);
const req = (body) => ({ method: 'POST', url: 'https://3d-price.netlify.app/api/admin', headers: { get: () => 'https://3d-price.netlify.app', entries: () => [][Symbol.iterator]() }, json: async () => body });
const get = () => sandbox.handler({ method: 'GET', url: 'https://3d-price.netlify.app/api/admin', headers: { get: () => null, entries: () => [][Symbol.iterator]() } });
(async () => {
  files['baseline.json'] = { items: [{ id: 'keep-me', name: 'Bambu Lab P1S', brand: 'Bambu Lab', category: 'printers', offers: [{ url: 'https://shop/p1s' }], shops: ['shop.com'] }] };
  const first = await (await get()).json();
  assert.equal(first.baseline.items.length, 1, 'offer-style board is cleaned, not re-seeded');
  assert.equal(first.baseline.items[0].offers, undefined);
  assert.equal(first.baseline.items[0].name, 'Bambu Lab P1S');
  const moved = await sandbox.handler(req({ action: 'updateBaselineItem', id: 'keep-me', patch: { category: 'filaments', name: 'Bambu Lab P1S Combo' } }));
  const movedBody = await moved.json();
  assert.equal(moved.status, 200, JSON.stringify(movedBody));
  assert.equal(movedBody.baseline.items[0].category, 'filaments');
  assert.equal(movedBody.baseline.items[0].name, 'Bambu Lab P1S Combo');
  const cat = await sandbox.handler(req({ action: 'addBaselineCategory', name: 'Resin' }));
  assert.equal(cat.status, 200, await cat.text());
  const added = await sandbox.handler(req({ action: 'addBaselineItem', name: 'Saturn 4 Ultra', brand: 'Elegoo', category: 'resin' }));
  const addedBody = await added.json();
  assert.equal(added.status, 200, JSON.stringify(addedBody));
  assert.ok(addedBody.baseline.items.some((i) => i.name === 'Saturn 4 Ultra' && i.category === 'resin'));
  const imported = await sandbox.handler(req({ action: 'importBaselineFromCatalog' }));
  const imp = await imported.json();
  assert.equal(imported.status, 200, JSON.stringify(imp));
  assert.ok((imp.baseline.items[0].offers) === undefined);
  const fromRun = await sandbox.handler(req({ action: 'importBaselineFromRun', jobId: 'job-1' }));
  const runBody = await fromRun.json();
  assert.equal(fromRun.status, 200, JSON.stringify(runBody));
  assert.ok(runBody.added >= 1 || runBody.updated >= 1, 'shop run should add or update a model');
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const thumb = await sandbox.handler(req({ action: 'updateBaselineItem', id: 'keep-me', imageUpload: { type: 'image/png', data: png.toString('base64') } }));
  const thumbBody = await thumb.json();
  assert.equal(thumb.status, 200, JSON.stringify(thumbBody));
  assert.match(thumbBody.baseline.items.find((i) => i.id === 'keep-me').image, /^\/api\/product-image\?key=/);
  const renamed = await sandbox.handler(req({ action: 'renameBaselineCategory', id: 'printers', name: 'FDM Printers' }));
  const renamedBody = await renamed.json();
  assert.equal(renamed.status, 200, JSON.stringify(renamedBody));
  assert.equal(renamedBody.baseline.categories.find((c) => c.id === 'printers').name, 'FDM Printers');
  const aborted = await sandbox.handler(req({ action: 'abortAllJobs' }));
  const abortBody = await aborted.json();
  assert.equal(aborted.status, 200, JSON.stringify(abortBody));
  assert.equal(abortBody.aborted, 2);
  console.log('PASS: baseline is editable human models under categories, no offers.');
})().catch((e) => { console.error(e); process.exitCode = 1; });
