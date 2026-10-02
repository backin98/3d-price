// Filament bundles and multi-packs ("4'lü set", "10 adet", "4x1kg", "4 renk set", "10 al 9 öde"):
// read from the title or set by hand on the admin card, never merged with a single spool (or with a
// pack of another size), published as its own product, and shown on the storefront as "4'lü paket"
// with a price per spool.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { packOf, classifyFilament } = require('../api/filament-classify.js');
const { decidePair } = require('../lib/product-match.cjs');
const { normalizeFilamentListing } = require('../lib/qwen-website-job.cjs');
const { classifyProductType } = require('../lib/product-type.cjs');

// 1. Reading a pack from the title.
for (const [title, count] of [["Bambu Lab PLA Basic 4'lü Set", 4], ['Bambu Lab PLA Basic 4lü set', 4], ['Elegoo PLA 10 Adet 1kg', 10], ['Esun PLA+ 4x1kg Filament Seti', 4],
  ['Sunlu PLA 4-Pack 1kg', 4], ['Sunlu PLA Pack of 4', 4], ['Elegoo PLA 4 Renk Set', 4], ['Filamix PLA 10 Al 9 Öde', 10], ['Eryone Silk PLA 6 Rulo', 6]]) {
  assert.deepEqual(packOf(title), { count, bundle: true }, title);
}
assert.deepEqual(packOf('R3D PLA+ Filament Bundle'), { count: 0, bundle: true }, 'a bundle that does not say how many');
for (const title of ['Esun PLA+ Filament 1.75mm 1kg Siyah', 'Elegoo PLA 2 Renk Dual Silk', 'Polymaker PolyTerra PLA 1.75 mm 3kg', 'Esun ePLA-Lite 1kg Silk Tri Color', 'Bambu Lab PLA Basic Refill 1kg']) {
  assert.equal(packOf(title).bundle, false, 'one spool: ' + title);
}
// No real spool title is a pack (docs/real-listings.jsonl): the rule only fires on pack words.
const rows = fs.readFileSync(path.join(__dirname, '..', 'docs', 'real-listings.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const seen = new Set();
const misread = [];
for (const r of rows) {
  if (!r.title || seen.has(r.title) || classifyProductType(r.title, '') !== 'filament') continue;
  seen.add(r.title);
  if (packOf(r.title).bundle) misread.push(r.title);
}
assert.deepEqual(misread, [], 'single spools read as packs');
assert.equal(classifyFilament({ name: 'Esun PLA+ 4x1kg Filament Seti' }).weight, '1000 g', 'the weight is per spool');
// Your setting on the card wins over the title.
assert.equal(classifyFilament({ name: 'Elegoo PLA Siyah', packCount: 3 }).packCount, 3);
assert.equal(classifyFilament({ name: 'Elegoo PLA Siyah 4lü set', bundle: false }).bundle, false, 'you can say it is not a pack');

// 2. Matching: a pack is never a single spool, nor a pack of another size.
const decide = (a, b) => decidePair({ id: 'a', name: a, brand: 'Elegoo', kind: 'filament' }, { id: 'b', name: b, brand: 'Elegoo', kind: 'filament' });
for (const [a, b] of [['Elegoo PLA Siyah 1kg', "Elegoo PLA Siyah 1kg 4'lü Set"], ['Elegoo PLA Siyah 4lü set', 'Elegoo PLA Siyah 10 adet'], ['Elegoo PLA Siyah 1kg', 'Elegoo PLA Siyah Bundle']]) {
  assert.notEqual(decide(a, b).action, 'merge', a + ' merged with ' + b);
}
assert.equal(decidePair({ id: 'a', name: 'Elegoo PLA Siyah', brand: 'Elegoo', kind: 'filament', packCount: 4, bundle: true }, { id: 'b', name: 'Elegoo PLA Siyah', brand: 'Elegoo', kind: 'filament' }).reason, 'different pack', 'a pack set by hand splits too');
assert.equal(decide('Elegoo PLA Siyah 1kg', 'Elegoo PLA Black 1 kg').action, 'merge', 'single spools still merge');

// 3. The run's listing and the card the worker sends carry the pack.
const listing = normalizeFilamentListing({ name: "Bambu Lab PLA Basic 4'lü Set - Siyah", brand: 'Bambu Lab', kind: 'filament', url: 'https://shop.example/pla-basic-4lu-siyah', price: 3299 });
assert.deepEqual([listing.packCount, listing.bundle, listing.color], [4, true, 'black']);
const { compactEvent } = require('../worker/online-worker.cjs');
const sent = compactEvent({ type: 'extract', listing });
assert.deepEqual([sent.card.packCount, sent.card.bundle], [4, true]);

(async () => {
  // 4. Admin: Save keeps your pack setting; publishing makes the pack its own product.
  const source = fs.readFileSync(path.join(__dirname, '..', 'netlify', 'functions', 'admin.mjs'), 'utf8')
    .replace(/^import .*;$/gm, '').replace('export default async', 'globalThis.handler = async');
  const single = 'https://shop.example/elegoo-pla-siyah';
  const four = 'https://shop.example/elegoo-pla-siyah-4lu';
  const files = {
    'catalog.json': { products: [], filaments: [{ id: 'f-elegoo', name: 'Elegoo PLA', brand: 'Elegoo', kind: 'filament', polymer: 'pla', offers: [{ store: 'shop.example', url: single, price: 549, sourceTitle: 'Elegoo PLA - Siyah', colorName: 'Siyah' }] }] },
    'desk.json': { shops: [] },
    'jobs.json': [{ id: 'job', url: 'https://shop.example/filament', status: 'complete', kind: 'filament', cards: { [four]: { url: four, name: 'Elegoo PLA', brand: 'Elegoo', kind: 'filament', polymer: 'pla', colorName: 'Siyah', price: 1999, decision: { action: 'held' } } } }]
  };
  const sandbox = {
    console, Response, URL, Buffer,
    money: require('../lib/parse-money.cjs'),
    store: { readJSON: async (k, f) => (k in files ? JSON.parse(JSON.stringify(files[k])) : f), writeJSON: async (k, v) => { files[k] = JSON.parse(JSON.stringify(v)); }, deleteKey: async (k) => { delete files[k]; } },
    auth: { ownerFromHeaders: () => ({ role: 'owner' }), authReady: () => true },
    matcher: require('../lib/product-match.cjs'), boardLib: require('../lib/baseline-board.cjs'),
    filamentColours: require('../lib/filament-colours.cjs'), merchLib: require('../lib/storefront-merch.cjs')
  };
  vm.runInNewContext(source, sandbox);
  const req = (body) => ({ method: 'POST', url: 'http://127.0.0.1:8890/api/admin', headers: { get: () => 'http://127.0.0.1:8890', entries: () => [][Symbol.iterator]() }, json: async () => body });
  // The shop title said nothing; you mark it a pack of 4 on the card.
  const saved = await sandbox.handler(req({ action: 'updateUncertainCard', jobId: 'job', url: four, patch: { bundle: 'yes', packCount: '4' } }));
  assert.equal(saved.status, 200, await saved.text());
  assert.deepEqual([files['jobs.json'][0].cards[four].packCount, files['jobs.json'][0].cards[four].bundle], [4, true], 'Save keeps the pack');
  const card = { ...files['jobs.json'][0].cards[four] };
  const pub = await sandbox.handler(req({ action: 'publishSelected', placements: [{ url: four, action: 'create', candidateId: '', card }] }));
  assert.equal(pub.status, 200, await pub.text());
  const filaments = files['catalog.json'].filaments;
  const home = filaments.find((p) => (p.offers || []).some((o) => o.url === four));
  assert.notEqual(home.id, 'f-elegoo', 'the pack did not join the single-spool row of the same name');
  assert.deepEqual([home.bundle, home.packCount, home.offers[0].packCount], [true, 4, 4], 'the pack row and its offer say so');
  assert.equal(filaments.find((p) => p.id === 'f-elegoo').offers.length, 1, 'the single spool row is untouched');

  // 5. Storefront: the pack is its own card, labelled, with a price per spool.
  const nodes = new Map();
  const node = (sel) => { if (!nodes.has(sel)) nodes.set(sel, { hidden: true, innerHTML: '', textContent: '', dataset: {}, contains: () => false }); return nodes.get(sel); };
  const context = {
    URL, Response, console,
    window: { SITE_CONTENT: { desk: {}, locations: [], aisles: [], banners: [], ads: [], units: [], products: [], live: {}, cart: {}, sheet: {}, brand: {}, dir: {}, documentTitle: {}, emptyAisle: {}, emptySearchBody: {}, emptySearchTitle: {}, filament: {}, header: {}, hunter: {}, lang: {}, offerCount: {}, productExact: {}, productPhrases: [], profile: {}, resultsCount: {}, savedDeal: {}, saveDeal: {} } },
    document: { querySelector: node, querySelectorAll: () => [], addEventListener() {}, body: {}, documentElement: { lang: '', dataset: {}, classList: { add() {}, remove() {}, toggle() {} } }, createElement: () => ({ dataset: {}, style: {}, appendChild() {}, setAttribute() {} }) },
    location: { hash: '', search: '' }, localStorage: { getItem: () => null, setItem() {} },
    setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, clearTimeout() {}, requestAnimationFrame: () => 1,
    addEventListener() {}, fetch: async () => ({ ok: false, status: 404, json: async () => ({}) }), ResizeObserver: function () { this.observe = () => {}; }
  };
  const boot = /^\s*(?:initStatic|bind)\(\);\s*$|^\s*huntRhino\(state\.query \|\| ""\);\s*$/;
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8').split('\n').filter((l) => !boot.test(l)).join('\n');
  vm.runInNewContext(src, context);
  const api = context.window.__3dp;
  // One family row that a shop sells both ways: the colour rows split single and pack apart.
  const mixed = { id: 'f-1', name: 'Elegoo PLA', brand: 'Elegoo', kind: 'filament', polymer: 'pla', offers: [
    { store: 'a.example', url: 'https://a.example/1', price: 549, colorName: 'Siyah' },
    { store: 'b.example', url: 'https://b.example/4', price: 1999, colorName: 'Siyah', packCount: 4, bundle: true }
  ] };
  const split = Array.from(api.colourRows([mixed]));
  assert.equal(split.length, 2, 'a pack and a single spool of the same colour are two storefront items');
  const [one, pack] = [split.find((p) => !p.bundle), split.find((p) => p.bundle)];
  assert.notEqual(api.filamentFamilyKey(one), api.filamentFamilyKey(pack), 'and two cards');
  api.state.lang = 'tr';
  assert.equal(api.packLabel(pack), "4'lü paket");
  assert.equal(api.packLabel({ packCount: 6, bundle: true }), "6'lı paket");
  assert.equal(api.packLabel({ packCount: 10, bundle: true }), "10'lu paket");
  assert.equal(api.packLabel(one), '');
  api.state.lang = 'en';
  assert.equal(api.packLabel(pack), '4-pack');
  assert.equal(api.packLabel({ bundle: true }), 'Bundle');

  console.log('PASS: filament packs are read from the title or set on the card, never merged with a single spool, published as their own product and shown as a pack with a per-spool price.');
})().catch((err) => { console.error(err); process.exitCode = 1; });
