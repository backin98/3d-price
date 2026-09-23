const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { emptyBoard, fromProduct, fromRunCard, upsertItems, loadBackupPrinters, sanitizeItem, addCategory, renameCategory, patchItem, addItem, itemForProduct, applyBaselineImages, renameLinkedItem, addRecommendations, absorbWorkerCreates, catalogProductForItem } = require('../lib/baseline-board.cjs');

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
const imageBoard = { items: [{ id: 'base-a1', name: 'Bambu Lab A1 Combo', brand: 'Bambu Lab', category: 'printers', image: '/baseline-a1.webp' }] };
const imageCatalog = { products: [
  { id: 'shop-a1', name: 'Bambu Lab A1 Combo 3D Yazıcı', brand: 'Bambu Lab', kind: 'printer', image: '/shop-a1.webp' },
  { id: 'new-model', name: 'Acme Z900 3D Yazıcı', brand: 'Acme', kind: 'printer', image: '/new.webp' }
], filaments: [] };
assert.equal(itemForProduct(imageBoard, imageCatalog.products[0]).id, 'base-a1');
applyBaselineImages(imageCatalog, imageBoard);
assert.equal(imageCatalog.products[0].image, '/baseline-a1.webp', 'known models always use the baseline thumbnail');
assert.equal(imageCatalog.products[1].image, '/new.webp', 'a model absent from baseline keeps its catalog thumbnail');
const k2Catalog = { products: [
  { id: 'qwen-k2pro', name: 'Creality K2 Pro Combo 3D Yazıcı', brand: 'Creality', kind: 'printer', offers: [{ store: 'rhino', url: 'https://rhino/k2pro' }] },
  { id: 'qwen-k2', name: 'Creality K2 Combo 3D Yazıcı', brand: 'Creality', kind: 'printer', offers: [{ store: 'rhino', url: 'https://rhino/k2' }] }
], filaments: [] };
const k2Pro = catalogProductForItem(k2Catalog, { id: 'bl-k2pro', name: 'Creality K2 Pro Combo', brand: 'Creality', category: 'printers' });
assert.equal(k2Pro && k2Pro.id, 'qwen-k2pro', 'a baseline K2 Pro points at the catalog row the other K2 Pros already joined');
assert.equal(catalogProductForItem(k2Catalog, { id: 'bl-k2', name: 'Creality K2 Combo', brand: 'Creality', category: 'printers' }).id, 'qwen-k2');
const linked = { items: [{ id: 'k2', name: 'Creality K2 Combo', brand: 'Creality', category: 'printers' }, { id: 'other', name: 'Creality K2 Combo', brand: 'Creality', category: 'printers' }] };
assert.equal(renameLinkedItem(linked, { id: 'shop-k2', brand: 'Creality', kind: 'printer' }, { name: 'Creality K2 Combo', brand: 'Creality' }, 'Creality K2 Plus'), null, 'two rows with the same name are not guessed');
assert.equal(linked.items[0].name, 'Creality K2 Combo');
const one = { items: [{ id: 'k2', name: 'Creality K2 Combo', brand: 'Creality', category: 'printers' }] };
assert.equal(renameLinkedItem(one, { id: 'shop-k2', brand: 'Creality', kind: 'printer' }, { name: 'Creality K2 Combo', brand: 'Creality' }, 'Creality K2 Plus').name, 'Creality K2 Plus');
const recFile = addRecommendations({ items: [] }, [{ name: 'Elegoo Neptune 4 Pro', brand: 'Elegoo', url: 'https://shop.example/n4p', kind: 'printer' }], one, { id: 'job-1', site: 'shop.example' });
assert.equal(recFile.added, 1);
assert.equal(addRecommendations(recFile, [{ name: 'Elegoo Neptune 4 Pro', brand: 'Elegoo', url: 'https://shop.example/n4p' }], one, { id: 'job-1' }).added, 0, 'the same recommendation is not duplicated');
assert.equal(addRecommendations({ items: [] }, [{ name: 'Creality K2 Plus', brand: 'Creality' }], one, {}).added, 0, 'a name already on the baseline is not recommended');
const absorbed = absorbWorkerCreates(one, { items: [] }, { id: 'job-9', site: 'rhino', cards: { u: { name: 'New Printer', brand: 'Acme', url: 'https://shop.example/new', decision: { action: 'create' } }, m: { name: 'Creality K2 Plus', url: 'https://shop.example/k2', decision: { action: 'merge' } } } });
assert.equal(absorbed.added, 1, 'only a worker create becomes a recommendation');
assert.equal(absorbed.items[0].name, 'New Printer');

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
  assert.ok(files['baseline.json'].items[0].offers, 'an automatic admin refresh never writes the baseline');
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
  const beforeImport = files['baseline.json'].items.length;
  const imported = await sandbox.handler(req({ action: 'importBaselineFromCatalog' }));
  const imp = await imported.json();
  assert.equal(imported.status, 400, JSON.stringify(imp));
  assert.equal(files['baseline.json'].items.length, beforeImport, 'importing the catalog does not touch the baseline');
  const fromRun = await sandbox.handler(req({ action: 'importBaselineFromRun', jobId: 'job-1' }));
  const runBody = await fromRun.json();
  assert.equal(fromRun.status, 400, JSON.stringify(runBody));
  assert.equal(files['baseline.json'].items.length, beforeImport, 'importing a shop run does not touch the baseline');
  files['catalog.json'].products.push({ id: 'p-named', name: 'Bambu Lab P1S Combo', brand: 'Bambu Lab', kind: 'printer', offers: [] });
  const catalogRename = await sandbox.handler(req({ action: 'updateProduct', id: 'p-named', patch: { name: 'Bambu Lab P1S AMS' } }));
  const catalogRenameBody = await catalogRename.json();
  assert.equal(catalogRename.status, 200, JSON.stringify(catalogRenameBody));
  assert.equal(files['baseline.json'].items.find((i) => i.id === 'keep-me').name, 'Bambu Lab P1S Combo', 'renaming a catalog product does not rename the baseline');
  const stranger = await sandbox.handler(req({ action: 'updateProduct', id: 'p1', patch: { name: 'Creality K2 Combo renamed by the matcher' } }));
  assert.equal(stranger.status, 200);
  assert.equal(files['baseline.json'].items.some((i) => /matcher/.test(i.name)), false, 'renaming a product that is not on the baseline does not create one');
  files['baseline-recommendations.json'] = { items: [{ id: 'rec-1', name: 'Elegoo Centauri Carbon', brand: 'Elegoo', category: 'printers', image: '', url: 'https://shop.example/centauri' }] };
  const confirmed = await sandbox.handler(req({ action: 'confirmBaselineRecommendation', id: 'rec-1' }));
  const confirmedBody = await confirmed.json();
  assert.equal(confirmed.status, 200, JSON.stringify(confirmedBody));
  assert.ok(files['baseline.json'].items.some((i) => i.name === 'Elegoo Centauri Carbon'), 'confirming a recommendation adds it');
  assert.equal(files['baseline-recommendations.json'].items.length, 0);
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
  const permanent = JSON.stringify(files['baseline.json']);
  await sandbox.handler(req({ action: 'createJob', url: 'https://shop.example/printers', kind: 'printer' }));
  await sandbox.handler(req({ action: 'deleteAllReview' }));
  await sandbox.handler(req({ action: 'deleteAllCatalog' }));
  await sandbox.handler(req({ action: 'deleteJob', id: 'job-1' }));
  assert.equal(JSON.stringify(files['baseline.json']), permanent, 'runs, uncertainty cleanup, catalog wipes and job deletion cannot change the baseline');
  console.log('PASS: baseline is editable human models under categories, no offers.');
})().catch((e) => { console.error(e); process.exitCode = 1; });
