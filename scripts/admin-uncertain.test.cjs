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
  boardLib: require('../lib/baseline-board.cjs'),
  filamentColours: require('../lib/filament-colours.cjs')
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
  assert.equal(files['jobs.json'][0].cards['https://shop.example/mystery'].handEdited, true, 'Save marks the card so harvest events do not overwrite it');
  files['baseline.json'] = { categories: [{ id: 'printers', name: '3D Printers' }], items: [] };
  files['jobs.json'][0].cards['https://shop.example/mystery'].price = 18000;
  const added = await sandbox.handler(req({ action: 'addUncertainToBaseline', jobId: 'job-1', url: 'https://shop.example/mystery', name: 'Hand titled', brand: 'Bambu Lab', subBrand: 'Series example' }));
  const addedBody = await added.json();
  assert.equal(added.status, 200, JSON.stringify(addedBody));
  const made = files['baseline.json'].items.find((i) => i.name === 'Hand titled' && i.brand === 'Bambu Lab');
  assert.ok(made, 'the Uncertain button adds that card to the baseline');
  assert.equal(made.subBrand, 'Series example');
  assert.equal(files['jobs.json'][0].cards['https://shop.example/mystery'].subBrand, 'Series example');
  assert.equal(files['catalog.json'].products.find(p => p.baselineId === made.id).subBrand, 'Series example');
  const row = files['catalog.json'].products.find((p) => p.id === made.id);
  assert.ok(row, 'it is published as its own catalog row');
  assert.equal(row.baselineId, made.id, 'the catalog row is that baseline model');
  // A spool-type difference never splits a baseline model: the second card joins the same row.
  const before = files['baseline.json'].items.length;
  files['jobs.json'][0].cards['https://shop.example/mystery-2'] = { url: 'https://shop.example/mystery-2', name: 'Hand titled', price: 18000, kind: 'printer' };
  const again = await sandbox.handler(req({ action: 'addUncertainToBaseline', jobId: 'job-1', url: 'https://shop.example/mystery-2', name: 'Hand titled', brand: 'Bambu Lab', spoolMaterial: 'plastic' }));
  assert.equal(again.status, 200, await again.text());
  assert.equal(files['baseline.json'].items.length, before, 'same model, other spool type: no second baseline row');
  // A filament whose sub-brand was changed (Creality TPU → CR) is a different model: Add to baseline makes a new row.
  files['baseline.json'].items.push({ id: 'crea-tpu', category: 'filaments', entityType: 'family', name: 'Creality TPU Filament', brand: 'Creality', polymer: 'tpu', variant: '' });
  files['jobs.json'][0].cards['https://shop.example/cr-tpu'] = { url: 'https://shop.example/cr-tpu', name: 'Creality TPU Filament', price: 540, kind: 'filament' };
  const crTpu = await sandbox.handler(req({ action: 'addUncertainToBaseline', jobId: 'job-1', url: 'https://shop.example/cr-tpu', name: 'Creality TPU Filament', brand: 'Creality', subBrand: 'CR', polymer: 'tpu', variant: '', kind: 'filament' }));
  const crBody = await crTpu.json();
  assert.equal(crTpu.status, 200, JSON.stringify(crBody));
  assert.notEqual(crBody.item.id, 'crea-tpu', 'a new sub-brand is a new baseline model, not the plain one with the same name');
  assert.equal(crBody.item.subBrand, 'CR');
  // Diameter: saved on the card, and a 2.85 mm spool is its own baseline model next to the 1.75 mm one.
  const dia = await sandbox.handler(req({ action: 'updateUncertainCard', jobId: 'job-1', url: 'https://shop.example/cr-tpu', patch: { diameter: '2,85' } }));
  assert.equal(dia.status, 200);
  assert.equal(files['jobs.json'][0].cards['https://shop.example/cr-tpu'].diameter, '2.85 mm', 'diameter saves as 1.75 mm / 2.85 mm');
  files['jobs.json'][0].cards['https://shop.example/thick'] = { url: 'https://shop.example/thick', name: 'Creality TPU Filament', price: 540, kind: 'filament' };
  const thick = await sandbox.handler(req({ action: 'addUncertainToBaseline', jobId: 'job-1', url: 'https://shop.example/thick', name: 'Creality TPU Filament', brand: 'Creality', subBrand: 'CR', polymer: 'tpu', variant: '', kind: 'filament', diameter: '2.85 mm' }));
  const thickBody = await thick.json();
  assert.equal(thick.status, 200, JSON.stringify(thickBody));
  assert.equal(thickBody.item.diameter, '2.85 mm', 'the new model carries its diameter');
  assert.notEqual(thickBody.item.id, crBody.item.id, 'same model at 2.85 mm is a separate baseline model, not the 1.75 mm one');
  // Spool link per model group, kept on the desk.
  const linked = await sandbox.handler(req({ action: 'setFilamentGroup', key: 'rhinolab||pla|silk', spoolLinked: false, spoolMaterial: 'plastic' }));
  assert.equal(linked.status, 200);
  assert.deepEqual(files['desk.json'].filamentGroups['rhinolab||pla|silk'], { spoolLinked: false, spoolMaterial: 'plastic' });
  await sandbox.handler(req({ action: 'setFilamentGroup', key: 'rhinolab||pla|silk', spoolMaterial: 'metal' }));
  assert.equal(files['desk.json'].filamentGroups['rhinolab||pla|silk'].spoolMaterial, '', 'only cardboard or plastic');
  assert.ok(row.offers.some((o) => o.url === 'https://shop.example/mystery'), 'the scraped listing is on that row');
  assert.equal(files['jobs.json'][0].cards['https://shop.example/mystery'].decision.candidateId, 'baseline:' + made.id);
  files['baseline.json'].items.push({ id: 'bl-x1', category: 'printers', name: 'Bambu Lab X1 Carbon', brand: 'Bambu Lab' });
  files['jobs.json'][0].cards['https://shop.example/x1-ams'] = { url: 'https://shop.example/x1-ams', name: 'Bambu Lab X1 Carbon AMS 2 Pro', brand: 'Bambu Lab', kind: 'printer', price: 42000 };
  const sibling = await sandbox.handler(req({ action: 'addUncertainToBaseline', jobId: 'job-1', url: 'https://shop.example/x1-ams', name: 'Bambu Lab X1 Carbon AMS 2 Pro', brand: 'Bambu Lab', price: 42000 }));
  const siblingBody = await sibling.json();
  assert.equal(sibling.status, 200, JSON.stringify(siblingBody));
  assert.notEqual(siblingBody.item.id, 'bl-x1', 'a different configuration is its own baseline model');
  assert.ok(files['catalog.json'].products.some((p) => p.id === siblingBody.item.id && p.offers.some((o) => o.url === 'https://shop.example/x1-ams')));
  const dropped = await sandbox.handler(req({ action: 'deleteFlagged', urls: ['https://shop.example/mystery'] }));
  assert.equal(dropped.status, 200, await dropped.text());
  assert.equal(files['jobs.json'][0].cards['https://shop.example/mystery'], undefined, 'the trash control removes the card');
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
  assert.deepEqual(forcedBody.appliedUrls, ['https://shop.example/force-me']);
  files['catalog.json'].products.find(p => p.offers.some(o => o.url === 'https://shop.example/force-me')).offers[0].stockStatus = 'preorder';
  const editedPublish = await sandbox.handler(req({ action: 'publishSelected', placements: [{
    url: 'https://shop.example/force-me', action: 'create', card: { name: 'Edited name', brand: 'Edited brand', price: 21999 }
  }] }));
  assert.equal(editedPublish.status, 200);
  const editedRow = files['catalog.json'].products.find(p => p.offers.some(o => o.url === 'https://shop.example/force-me'));
  assert.equal(editedRow.name, 'Edited name');
  assert.equal(editedRow.offers[0].stockStatus, 'preorder', 'editing preserves existing offer evidence');
  assert.equal(editedRow.offers[0].sourceTitle, 'Edited name');
  await sandbox.handler(req({ action: 'publishSelected', placements: [{ url: 'https://shop.example/force-me', action: 'create', card: { name: 'Edited name', brand: 'Edited brand', price: 21999, colorTone: 'beige', colorName: 'Desert Tan' } }] }));
  assert.equal(files['catalog.json'].products.find(p => p.offers.some(o => o.url === 'https://shop.example/force-me')).offers.find(o => o.url === 'https://shop.example/force-me').colorTone, 'beige', 'an eyedropper tone reaches the catalog offer for search');
  assert.equal(files['catalog.json'].products.find(p => p.offers.some(o => o.url === 'https://shop.example/force-me')).offers.find(o => o.url === 'https://shop.example/force-me').sourceTitle, 'Edited name - Desert Tan', 'the listing colour stays searchable on the offer');
  await sandbox.handler(req({ action: 'publishSelected', placements: [{ url: 'https://shop.example/force-me', action: 'create', card: { name: 'Edited name', brand: 'Edited brand', price: 21999, colorTone: 'not-a-colour' } }] }));
  assert.equal(files['catalog.json'].products.find(p => p.offers.some(o => o.url === 'https://shop.example/force-me')).offers.find(o => o.url === 'https://shop.example/force-me').colorTone, 'beige', 'an unknown tone is ignored');
  const partial = await sandbox.handler(req({ action: 'publishSelected', placements: [
    { url: 'https://shop.example/force-me', card: { name: 'Edited name', price: 21999 } },
    { url: 'https://shop.example/no-price', card: { name: 'No price' } }
  ] }));
  assert.deepEqual((await partial.json()).appliedUrls, ['https://shop.example/force-me']);
  const noPrice = await sandbox.handler(req({ action: 'publishSelected', placements: [{ url: 'https://shop.example/no-price' }] }));
  assert.notEqual(noPrice.status, 200);
  // Get price: a card that only exists in the run's events (no job.cards entry yet) gets its page price stored.
  sandbox.AbortSignal = AbortSignal;
  sandbox.fetch = async () => ({ ok: true, status: 200, text: async () => '<div class="product-price">668,28 TL</div>' });
  files['jobs.json'].push({ id: 'job-2', url: 'https://www.rhino3dprinter.com/', status: 'complete', events: [{ type: 'extract', card: { url: 'https://www.rhino3dprinter.com/filamix-pla-matte-red', name: 'Filamix PLA Matte - Red' } }] });
  const refetched = await sandbox.handler(req({ action: 'refetchUncertainPrices', items: [{ jobId: 'job-2', url: 'https://www.rhino3dprinter.com/filamix-pla-matte-red' }] }));
  const refetchBody = await refetched.json();
  assert.equal(refetched.status, 200, JSON.stringify(refetchBody));
  assert.equal(refetchBody.results[0].price, 668.28, JSON.stringify(refetchBody));
  assert.equal(files['jobs.json'].find((j) => j.id === 'job-2').cards['https://www.rhino3dprinter.com/filamix-pla-matte-red'].price, 668.28, 'the price is stored on the card');
  console.log('PASS: uncertain Laya opinions persist, cards edit, catalog republish, force publish hits live catalog.');
})().catch((e) => { console.error(e); process.exitCode = 1; });
