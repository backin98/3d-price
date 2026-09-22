const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const data = {
  desk: { shops: [], banners: [], promoted: [] },
  catalog: {
    products: [{
      id: 'p1', name: 'Bambu Lab A1 Combo', brand: 'Bambu Lab', kind: 'printer',
      offers: [
        { store: 'Rhino 3D Printer', price: 18000, url: 'https://www.rhino3dprinter.com/a1' },
        { store: 'Metatech', price: 17500, url: 'https://store.metatechtr.com/a1' }
      ]
    }],
    filaments: []
  },
  candidate: {
    products: [{
      id: 'p1', name: 'Bambu Lab A1 Combo', brand: 'Bambu Lab', kind: 'printer',
      offers: [
        { store: 'Rhino 3D Printer', price: 18000, url: 'https://www.rhino3dprinter.com/a1' },
        { store: 'Metatech', price: 17500, url: 'https://store.metatechtr.com/a1' },
        { store: 'New Shop', price: 17000, url: 'https://shop.example.com/a1' }
      ]
    }, {
      id: 'qwen-new', name: 'Creality K2', brand: 'Creality', kind: 'printer',
      offers: [{ store: 'New Shop', price: 22000, url: 'https://shop.example.com/k2' }]
    }],
    filaments: []
  },
  jobs: [{
    id: 'job-1', status: 'complete', events: [
      { card: { name: 'Bambu A1 Combo', brand: 'Bambu Lab', kind: 'printer', price: 17000, url: 'https://shop.example.com/a1', image: '' }, decision: { action: 'merge', candidateId: 'p1', candidateName: 'Bambu Lab A1 Combo' } },
      { card: { name: 'Creality K2', brand: 'Creality', kind: 'printer', price: 22000, url: 'https://shop.example.com/k2', image: '' }, decision: { action: 'create', candidateId: 'qwen-new' } }
    ]
  }]
};

const nodes = new Map();
function node(sel) { if (!nodes.has(sel)) nodes.set(sel, { hidden: true, innerHTML: '', textContent: '', value: '', contains: () => false }); return nodes.get(sel); }
const context = {
  URL, Response,
  document: { querySelector: node, querySelectorAll: () => [] },
  location: { hash: '#runs' }, window: {}, setInterval() { return 1; }, clearInterval() {}, setTimeout() {}, clearTimeout() {},
  fetch: async () => ({ ok: true, status: 200, json: async () => data })
};
let source = fs.readFileSync('public/admin/admin.js', 'utf8').replace('  init();', '  globalThis.test = { state, reviewBoardHtml, collectCards };');
vm.runInNewContext(source, context);
context.test.state.data = data;
const html = context.test.reviewBoardHtml(data.jobs[0]);
assert.match(html, /id="select-all"/);
assert.match(html, /id="flag-all"/);
assert.match(html, /id="delete-flagged"/);
assert.match(html, /id="delete-all-review"/);
assert.match(html, /Goes to/);
assert.match(html, /data-review-place-q/);
assert.match(html, /place-hits/);
assert.match(html, /data-restore-place/);
assert.match(html, /Restore default/);
assert.match(html, /Compared with Rhino/);
assert.match(html, /New product — not compared yet/);
assert.match(html, /data-review-place/);
assert.doesNotMatch(html, /select-all-create/);
const gathered = context.test.reviewBoardHtml({
  url: 'https://shop.example.com/filament',
  events: [
    { type: 'gather', urls: ['https://shop.example.com/pla-black-1kg'] },
    { type: 'extract', url: 'https://shop.example.com/pla-red-1kg', error: 'Qwen audit rejected: out of stock' }
  ]
});
assert.match(gathered, /pla black 1kg/);
assert.match(gathered, /pla red 1kg/);
assert.match(gathered, /Held:/);
const withImg = context.test.reviewBoardHtml({
  events: [{ type: 'gather', items: [{ url: 'https://shop.example.com/x', name: 'PLA Black', image: 'https://cdn.example.com/x.jpg' }] }]
});
assert.match(withImg, /cdn\.example\.com\/x\.jpg/);
const mismatchHtml = context.test.reviewBoardHtml({
  events: [{
    type: "mismatch",
    items: [{
      url: "https://www.rhino3dprinter.com/muhendislik-filamentleri",
      name: "Mühendislik Filamentleri",
      mismatch: { detectedType: "filament", declaredType: "printer" }
    }]
  }]
});
assert.match(mismatchHtml, /category mismatch/);
assert.match(mismatchHtml, /detected: filament/);
assert.match(mismatchHtml, /declared: printer/);
assert.match(mismatchHtml, /Create new category: Filament/);

// A first-time offer on an existing printer is a merge, not a new printer: the board must
// agree with the placement. Cards here come from the candidate (no job events at all).
const derived = context.test.collectCards({ url: 'https://shop.example.com/x', cards: {} }, data);
const byUrl = new Map(derived.map((e) => [e.card.url, e.decision]));
assert.equal(byUrl.get('https://shop.example.com/a1').action, 'merge', 'new offer on an existing row is a merge');
assert.equal(byUrl.get('https://shop.example.com/a1').candidateName, 'Bambu Lab A1 Combo');
assert.equal(byUrl.get('https://shop.example.com/k2').action, 'create', 'a row that is not live yet is new');

// A card the worker held after comparing must say so, not "waiting for match".
const heldHtml = context.test.reviewBoardHtml({
  url: 'https://shop.example.com/fdm',
  cards: { 'https://shop.example.com/held': { url: 'https://shop.example.com/held', name: 'Ambiguous P1S', kind: 'printer', decision: { action: 'held', reason: 'near duplicate — thumbnails disagree', candidateName: 'Bambu Lab P1S Combo 3D Yazıcı' } } },
  events: []
});
assert.match(heldHtml, /Worker match: held — near duplicate/);
assert.doesNotMatch(heldHtml, /Ambiguous P1S[\s\S]{0,400}waiting for match/, 'a compared card never reads as unmatched');
assert.match(mismatchHtml, /Discard/);
assert.doesNotMatch(mismatchHtml, /Dropshipping/);

let saved;
const apiContext = {
  URL, Response, crypto: require('node:crypto'),
  store: {
    readJSON: async (key, fallback) => key === 'catalog.json' ? data.catalog : key === 'candidate.json' ? data.candidate : key === 'desk.json' ? data.desk : key === 'jobs.json' ? data.jobs : fallback,
    writeJSON: async (key, value) => {
      if (key === 'catalog.json') saved = value;
      if (key === 'candidate.json') data.candidate = value;
      if (key === 'jobs.json') data.jobs = value;
    },
    deleteKey: async () => {}
  },
  auth: { ownerFromHeaders: () => ({ role: 'owner' }), authReady: () => true }
};
const adminSrc = fs.readFileSync('netlify/functions/admin.mjs', 'utf8').replace(/^import .*;$/gm, '').replace('export default async', 'globalThis.handler = async');
apiContext.money = require('../lib/parse-money.cjs'); // the function imports this module
apiContext.matcher = require('../lib/product-match.cjs');
apiContext.baselineLib = require('../lib/baseline-catalog.js');
apiContext.boardLib = require('../lib/baseline-board.cjs');
vm.runInNewContext(adminSrc, apiContext);
const post = (body) => new Request('https://example.com/api/admin', { method: 'POST', headers: { origin: 'https://example.com', 'content-type': 'application/json' }, body: JSON.stringify(body) });

(async () => {
  let result = await apiContext.handler(post({
    action: 'publishSelected',
    placements: [{ url: 'https://shop.example.com/a1', action: 'merge', candidateId: 'p1' }]
  }));
  assert.equal(result.status, 200);
  const merged = saved.products.find((p) => p.id === 'p1');
  assert.equal(merged.offers.length, 3);
  assert.ok(merged.offers.some((o) => o.store === 'New Shop'));
  assert.equal(saved.products.some((p) => p.id === 'qwen-new'), false);

  result = await apiContext.handler(post({
    action: 'publishSelected',
    placements: [{ url: 'https://shop.example.com/k2', action: 'create', card: { name: 'Creality K2', brand: 'Creality', kind: 'printer' } }]
  }));
  assert.equal(result.status, 200);
  assert.ok(saved.products.some((p) => p.id === 'qwen-new'));
  assert.equal(saved.products.find((p) => p.id === 'p1').offers.length, 2);

  result = await apiContext.handler(post({
    action: 'publishSelected',
    placements: [{ url: 'https://shop.example.com/a1', action: 'create', card: { name: 'Bambu A1 Combo', brand: 'Bambu Lab', kind: 'printer' } }]
  }));
  assert.equal(result.status, 200);
  assert.equal(saved.products.find((p) => p.id === 'p1').offers.length, 2);
  assert.ok(saved.products.some((p) => p.id !== 'p1' && p.id !== 'qwen-new' && (p.offers || []).some((o) => o.url === 'https://shop.example.com/a1')));

  result = await apiContext.handler(post({
    action: 'deleteFlagged',
    urls: ['https://shop.example.com/k2']
  }));
  assert.equal(result.status, 200);
  assert.equal(data.candidate.products.some((p) => (p.offers || []).some((o) => o.url === 'https://shop.example.com/k2')), false);
  assert.ok(data.jobs[0].dropped.includes('https://shop.example.com/k2'));
  data.jobs.push({
    id: 'job-2', status: 'complete', url: 'https://other.example/3d',
    cards: { 'https://other.example/p1s': { url: 'https://other.example/p1s', name: 'P1S' } },
    events: [{ card: { url: 'https://other.example/p1s', name: 'P1S' } }]
  });
  result = await apiContext.handler(post({ action: 'deleteAllReview' }));
  assert.equal(result.status, 200);
  const wiped = await result.json();
  assert.ok(wiped.deleted >= 2, 'delete all clears every shop in a multi-shop collect, got ' + wiped.deleted);
  assert.equal(Object.keys(data.jobs[0].cards || {}).length, 0);
  assert.equal(Object.keys(data.jobs[1].cards || {}).length, 0);
  assert.ok(data.jobs[1].dropped.includes('https://other.example/p1s'));
  const droppedHtml = context.test.reviewBoardHtml({
    ...data.jobs[0],
    dropped: ['https://shop.example.com/pla-black-1kg'],
    events: [{ type: 'gather', urls: ['https://shop.example.com/pla-black-1kg', 'https://shop.example.com/pla-white-1kg'] }]
  });
  assert.doesNotMatch(droppedHtml, /pla black 1kg/);
  assert.match(droppedHtml, /pla white 1kg/);

  data.candidate = { products: [], filaments: [] };
  result = await apiContext.handler(post({
    action: 'publishSelected',
    placements: [{ url: 'https://shop.example.com/pla-black', action: 'create', card: { name: 'PLA Black', brand: 'Acme', kind: 'filament', price: 399, image: 'https://cdn.example.com/p.jpg' } }]
  }));
  assert.equal(result.status, 200);
  const fromCard = (saved.filaments || []).find((p) => (p.offers || []).some((o) => o.url === 'https://shop.example.com/pla-black'));
  assert.ok(fromCard);
  assert.equal(fromCard.name, 'PLA Black');
  assert.equal(fromCard.brand, 'Acme');
  assert.equal(fromCard.offers[0].price, 399);
  assert.ok(data.jobs[0].published.includes('https://shop.example.com/pla-black'));
  const publishedHtml = context.test.reviewBoardHtml({
    published: ['https://shop.example.com/pla-black-1kg'],
    events: [{ type: 'gather', urls: ['https://shop.example.com/pla-black-1kg', 'https://shop.example.com/pla-white-1kg'] }]
  });
  assert.doesNotMatch(publishedHtml, /pla black 1kg/);
  assert.match(publishedHtml, /pla white 1kg/);

  data.candidate = null;
  result = await apiContext.handler(post({
    action: 'publishSelected',
    placements: [{ url: 'https://shop.example.com/k1c', action: 'create', card: { name: 'K1C', brand: 'Creality', kind: 'printer', price: 15000 } }]
  }));
  assert.equal(result.status, 200);
  assert.ok(saved.products.some((p) => (p.offers || []).some((o) => o.url === 'https://shop.example.com/k1c' && o.price === 15000)));

  console.log('PASS: review board controls, merge publishes onto existing shops, create stays a new SKU, changing merge to create does not attach to the compared product.');
})().catch((err) => { console.error(err); process.exitCode = 1; });
