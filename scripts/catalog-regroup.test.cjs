// Regroup / branch: the matcher put a K2 Plus offer on a "K2 Combo" row. The catalog has to
// show where each offer came from and let it be moved, or split into its own product.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'regroup-'));
const catalogFile = path.join(dir, 'catalog.json');

const catalog = {
  savedAt: '2026-01-01T00:00:00.000Z',
  products: [
    {
      id: 'qwen-k2', name: 'Creality K2 Combo 3D Yazıcı', brand: 'Creality', kind: 'printer', aisle: 'fdm', price: 32384.81,
      offers: [
        { store: 'rhino3dprinter.com', price: 32384.81, url: 'https://www.rhino3dprinter.com/creality-k2-combo-3d-yazici', sourceTitle: 'Creality K2 Combo 3D Yazıcı' },
        { store: 'rhino3dprinter.com', price: 76084.79, url: 'https://www.rhino3dprinter.com/urun/creality-k2-plus-combo', sourceTitle: 'Creality K2 Plus Combo 3D Yazıcı - 300x300x300 mm' }
      ]
    },
    { id: 'qwen-p1s', name: 'Bambu Lab P1S Combo 3D Yazıcı', brand: 'Bambu Lab', kind: 'printer', aisle: 'fdm', price: 34986, offers: [{ store: 'rhino3dprinter.com', price: 34986, url: 'https://www.rhino3dprinter.com/p1s-combo', sourceTitle: 'Bambu Lab P1S Combo' }] }
  ],
  filaments: []
};
fs.writeFileSync(catalogFile, JSON.stringify(catalog));

const storeState = { 'catalog.json': JSON.parse(JSON.stringify(catalog)), 'jobs.json': [], 'desk.json': { shops: [] } };
const sandbox = {
  URL, Response, crypto: require('node:crypto'), console,
  money: require('../lib/parse-money.cjs'),
  store: {
    // Real blobs are parsed fresh per request: a thrown action must not leave mutations behind.
    readJSON: async (k, f) => (k in storeState ? JSON.parse(JSON.stringify(storeState[k])) : f),
    writeJSON: async (k, v) => { storeState[k] = v; },
    deleteKey: async (k) => { delete storeState[k]; }
  },
  auth: { ownerFromHeaders: () => ({ role: 'owner' }), authReady: () => true }
};
const src = fs.readFileSync(path.join(__dirname, '..', 'netlify', 'functions', 'admin.mjs'), 'utf8')
  .replace(/^import .*;$/gm, '')
  .replace('export default async', 'globalThis.handler = async');
vm.runInNewContext(src, sandbox);
const post = (b) => new Request('https://example.com/api/admin', { method: 'POST', headers: { origin: 'https://example.com', 'content-type': 'application/json' }, body: JSON.stringify(b) });
const send = async (b) => (await sandbox.handler(post(b))).json();

(async () => {
  // 1. Branch the K2 Plus offer out of the K2 Combo row.
  const branched = await send({ action: 'retargetOffer', url: 'https://www.rhino3dprinter.com/urun/creality-k2-plus-combo', from: 'qwen-k2', to: 'new' });
  assert.equal(branched.ok, true);
  assert.equal(branched.action, 'branched');
  const rows = storeState['catalog.json'].products;
  const plus = rows.find((p) => /K2 Plus Combo/i.test(p.name));
  assert.ok(plus, 'the branched offer became its own product');
  assert.equal(plus.name, 'Creality K2 Plus Combo 3D Yazıcı - 300x300x300 mm', 'named from the scraped title, not the slug');
  assert.equal(plus.offers.length, 1);
  assert.equal(plus.price, 76084.79, 'the new row is priced from its own offer');
  assert.equal(plus.manual, true, 'marked as a manual grouping so it is not silently re-merged');
  const k2 = rows.find((p) => p.id === 'qwen-k2');
  assert.equal(k2.offers.length, 1, 'the K2 Combo row kept only its own offer');
  assert.equal(k2.price, 32384.81, 'and its price dropped back to its own offer');
  assert.equal(rows.length, 3, 'one row added, none lost');

  // 2. Move an offer onto another existing product instead of branching.
  const moved = await send({ action: 'retargetOffer', url: 'https://www.rhino3dprinter.com/urun/creality-k2-plus-combo', from: plus.id, to: 'qwen-p1s' });
  assert.equal(moved.action, 'moved');
  const after = storeState['catalog.json'].products;
  assert.equal(after.some((p) => /K2 Plus/i.test(p.name)), false, 'the emptied row is gone: no empty products');
  const p1s = after.find((p) => p.id === 'qwen-p1s');
  assert.equal(p1s.offers.length, 2, 'the offer landed on the target row');
  assert.equal(p1s.price, 34986, 'price is the cheapest of its offers');

  // 3. Refusals stay honest (the handler answers with an error body, not a throw).
  const bad = async (b) => String((await send(b)).error || "");
  assert.match(await bad({ action: 'retargetOffer', url: 'https://nope.example/x', from: 'qwen-p1s', to: 'new' }), /not on the source product/);
  assert.match(await bad({ action: 'retargetOffer', url: 'https://www.rhino3dprinter.com/p1s-combo', from: 'qwen-p1s', to: 'qwen-p1s' }), /Already on that product/);
  assert.match(await bad({ action: 'retargetOffer', url: 'https://www.rhino3dprinter.com/p1s-combo', from: 'qwen-p1s' }), /url, from and to/);
  // A legacy duplicate: both rows carry the same URL, so moving one onto the other is refused.
  storeState['catalog.json'].products.find((p) => p.id === 'qwen-k2').offers.push({ store: 'rhino3dprinter.com', price: 34000, url: 'https://www.rhino3dprinter.com/p1s-combo' });
  assert.match(await bad({ action: 'retargetOffer', url: 'https://www.rhino3dprinter.com/p1s-combo', from: 'qwen-p1s', to: 'qwen-k2' }), /Target already has that offer/);

  console.log('PASS: a wrongly grouped offer can be branched into its own product or moved onto another, with prices and empty rows handled.');
})().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => fs.rmSync(dir, { recursive: true, force: true }));
