const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'netlify', 'functions', 'admin.mjs'), 'utf8')
  .replace(/^import .*;$/gm, '')
  .replace('export default async', 'globalThis.handler = async');
const files = {
  'catalog.json': { products: [{ id: 'p1', name: 'Bambu Lab P1S', offers: [] }], filaments: [], savedAt: '2026-01-01T00:00:00.000Z' },
  'desk.json': { shops: [] },
  'jobs.json': [{ id: 'job-1', url: 'https://shop.example/3d', status: 'complete', cards: { 'https://shop.example/mystery': { url: 'https://shop.example/mystery', name: 'Mystery', decision: { action: 'held' } } } }]
};
const store = {
  readJSON: async (key, fallback) => (key in files ? JSON.parse(JSON.stringify(files[key])) : fallback),
  writeJSON: async (key, value) => { files[key] = JSON.parse(JSON.stringify(value)); },
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
(async () => {
  const saved = await sandbox.handler(req({
    action: 'saveLayaOpinions',
    results: [{ url: 'https://shop.example/mystery', action: 'hold', reason: 'still unsure', matchId: 'p1' }]
  }));
  const body = await saved.json();
  assert.equal(saved.status, 200, JSON.stringify(body));
  const card = files['jobs.json'][0].cards['https://shop.example/mystery'];
  assert.equal(card.laya.action, 'hold');
  assert.equal(card.laya.matchName, 'Bambu Lab P1S');
  const edited = await sandbox.handler(req({ action: 'updateUncertainCard', jobId: 'job-1', url: 'https://shop.example/mystery', patch: { name: 'Hand titled', brand: 'Bambu Lab' } }));
  assert.equal(edited.status, 200, await edited.text());
  assert.equal(files['jobs.json'][0].cards['https://shop.example/mystery'].name, 'Hand titled');
  const pub = await sandbox.handler(req({ action: 'republishCatalog' }));
  const pubBody = await pub.json();
  assert.equal(pub.status, 200, JSON.stringify(pubBody));
  assert.ok(files['catalog.json'].savedAt > '2026-01-01T00:00:00.000Z');
  assert.ok(files['last-publish.json'].republished);
  files['jobs.json'] = [{
    id: 'job-force',
    url: 'https://shop.example/3d',
    status: 'complete',
    cards: { 'https://shop.example/force-me': { url: 'https://shop.example/force-me', name: 'Forced P1S', brand: 'Bambu Lab', kind: 'printer', price: 21999 } }
  }];
  files['candidate.json'] = { products: [], filaments: [] };
  const forced = await sandbox.handler(req({
    action: 'publishSelected',
    placements: [{ url: 'https://shop.example/force-me', action: 'create', card: { url: 'https://shop.example/force-me', name: 'Forced P1S', brand: 'Bambu Lab', kind: 'printer', price: 21999 } }]
  }));
  const forcedBody = await forced.json();
  assert.equal(forced.status, 200, JSON.stringify(forcedBody));
  assert.equal(forcedBody.published, 1);
  assert.ok(files['catalog.json'].products.some((p) => (p.offers || []).some((o) => o.url === 'https://shop.example/force-me' && o.price === 21999)), 'force publish writes the listing into the live catalog');
  assert.ok(files['last-publish.json'].savedAt, 'site hunt reads this catalog after last-publish');
  console.log('PASS: uncertain Laya opinions persist, cards edit, catalog republish, force publish hits live catalog.');
})().catch((e) => { console.error(e); process.exitCode = 1; });
