// Regression: "running a Robolink job pulls Rhino listings" (README, KNOWN BUG).
//
// The worker matches a run against the live catalog merged with the unpublished candidate
// (worker.mjs unionCatalog), so the candidate it uploads carries every other shop's pending offers
// too. On complete, every candidate offer that was not live became a card of the finishing run:
// after an unpublished Rhino run, the next Robolink run's review board was full of Rhino listings.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'netlify', 'functions', 'worker.mjs'), 'utf8')
  .replace(/^import .*;$/gm, '')
  .replace('export default async', 'globalThis.handler = async');

const RHINO = 'https://www.rhino3dprinter.com/rhinolab-pla-matte-filament-black';
const RHINO_2 = 'https://www.rhino3dprinter.com/filamix-rapid-pla-plus-dark-blue';
const ROBO = 'https://www.robolinkmarket.com/bambu-lab-a1-combo-3d-yazici';
const ROBO_LIVE = 'https://www.robolinkmarket.com/creality-k2-plus-combo';
const ROBO_NEW = 'https://www.robolinkmarket.com/bambu-lab-p2s-combo-3d-yazici';
// Robolink's filament run from yesterday, not published yet: same shop, another run.
const ROBO_SPOOL = 'https://www.robolinkmarket.com/esun-pla-plus-filament-siyah';

function freshFiles() {
  return {
    'jobs.json': [
      {
        id: 'job-robolink', url: 'https://www.robolinkmarket.com/3d-yazicilar', kind: 'printer', status: 'running',
        createdAt: '2026-09-30T10:00:00.000Z', startedAt: '2026-09-30T10:00:05.000Z',
        cards: { [ROBO]: { url: ROBO, name: 'Bambu Lab A1 Combo 3D Yazıcı', price: 23688, decision: { action: 'merge', candidateId: 'p-a1', candidateName: 'Bambu Lab A1 Combo' } } }, events: []
      },
      {
        id: 'job-rhino', url: 'https://www.rhino3dprinter.com/filament-cesitleri', kind: 'filament', status: 'complete',
        createdAt: '2026-09-29T10:00:00.000Z', cards: { [RHINO]: { url: RHINO, name: 'RhinoLab PLA Matte Black' } }, events: []
      }
    ],
    'catalog.json': {
      products: [{ id: 'p-k2', name: 'Creality K2 Plus Combo', kind: 'printer', offers: [{ store: 'robolinkmarket.com', url: ROBO_LIVE, price: 60000 }] }],
      filaments: []
    }
  };
}

function load(files) {
  const sandbox = {
    console, Response, URL,
    store: {
      readJSON: async (key, fallback) => JSON.parse(JSON.stringify(key in files ? files[key] : fallback)),
      writeJSON: async (key, value) => { files[key] = JSON.parse(JSON.stringify(value)); }
    },
    auth: { workerAuth: () => true },
    stock: { rollupProductStock: () => {} },
    boardLib: require('../lib/baseline-board.cjs')
  };
  vm.runInNewContext(source, sandbox);
  return sandbox;
}

const post = (sandbox, action, body) => sandbox.handler({
  method: 'POST',
  url: 'http://127.0.0.1:8890/.netlify/functions/worker?action=' + action,
  headers: { get: () => null, entries: () => [][Symbol.iterator]() },
  json: async () => body
});

(async () => {
  // The Robolink run's candidate: its own listings plus the unpublished Rhino filaments it was
  // matched against, and a Robolink offer that is already live.
  const candidate = {
    products: [
      { id: 'p-a1c', name: 'Bambu Lab A1 Combo', kind: 'printer', offers: [{ store: 'robolinkmarket.com', url: ROBO, price: 23688 }] },
      // Placed by this run (checked after it started) but never reported as a card: it still arrives.
      { id: 'p-p2s', name: 'Bambu Lab P2S Combo', kind: 'printer', offers: [{ store: 'robolinkmarket.com', url: ROBO_NEW, price: 41000, stockCheckedAt: '2026-09-30T10:03:00.000Z' }] },
      { id: 'p-k2', name: 'Creality K2 Plus Combo', kind: 'printer', offers: [{ store: 'robolinkmarket.com', url: ROBO_LIVE, price: 60000 }] }
    ],
    filaments: [
      { id: 'f-matte', name: 'RhinoLab PLA Matte', kind: 'filament', offers: [{ store: 'rhino3dprinter.com', url: RHINO, price: 450 }] },
      { id: 'f-rapid', name: 'Filamix Rapid PLA+', kind: 'filament', offers: [{ store: 'rhino3dprinter.com', url: RHINO_2, price: 520 }] },
      { id: 'f-esun', name: 'eSUN PLA+', kind: 'filament', offers: [{ store: 'robolinkmarket.com', url: ROBO_SPOOL, price: 610, stockCheckedAt: '2026-09-29T08:00:00.000Z' }] }
    ]
  };

  let files = freshFiles();
  let sandbox = load(files);
  const res = await post(sandbox, 'complete', { jobId: 'job-robolink', summary: { status: 'complete' }, candidate });
  assert.equal(res.status, 200, await res.text());
  const robolink = files['jobs.json'].find((j) => j.id === 'job-robolink');
  const cardUrls = Object.keys(robolink.cards).sort();
  assert.deepEqual(cardUrls, [ROBO, ROBO_NEW].sort(), 'the Robolink board holds Robolink listings only: ' + JSON.stringify(cardUrls));
  assert.equal(cardUrls.some((u) => u.includes('rhino3dprinter')), false, 'no Rhino listing on a Robolink run');
  assert.equal(robolink.cards[ROBO_NEW].decision.action, 'create', 'its own new listing still arrives with its decision');
  // Same shop, another run: an unpublished spool from Robolink's filament run is not a printer-run card
  // (an end-to-end run showed ten Rhino printers on Rhino's filament board this way).
  assert.equal(ROBO_SPOOL in robolink.cards, false, 'no listing from another run of the same shop');
  // The run's own card keeps the shop title and the worker's decision; the candidate row only fills blanks.
  assert.equal(robolink.cards[ROBO].name, 'Bambu Lab A1 Combo 3D Yazıcı', 'the shop title is not replaced by the catalog row name');
  assert.equal(robolink.cards[ROBO].decision.action, 'merge', 'the worker decision is not replaced');
  assert.equal(robolink.status, 'complete');
  assert.deepEqual(files['candidate.json'].filaments.map((f) => f.id), ['f-matte', 'f-rapid', 'f-esun'], 'the pending work of other runs stays in the candidate, untouched');
  const rhino = files['jobs.json'].find((j) => j.id === 'job-rhino');
  assert.deepEqual(Object.keys(rhino.cards), [RHINO], 'and the Rhino run keeps its own card');

  // Progress events are held to the same rule, whatever sends them.
  files = freshFiles();
  sandbox = load(files);
  const progress = await post(sandbox, 'progress', {
    jobId: 'job-robolink',
    events: [
      { type: 'gather', urls: [ROBO_NEW, RHINO_2], items: [{ url: RHINO_2, name: 'stray' }] },
      { type: 'extract', card: { url: RHINO, name: 'stray card' }, decision: { action: 'create' } }
    ]
  });
  assert.equal(progress.status, 200);
  const after = Object.keys(files['jobs.json'].find((j) => j.id === 'job-robolink').cards).sort();
  assert.deepEqual(after, [ROBO, ROBO_NEW].sort(), 'a progress event cannot plant another shop on this run: ' + JSON.stringify(after));

  // The page a run reads is not a listing. The worker's closing "done" event carries the category URL,
  // and an end-to-end run showed it as a card called "3d yazicilar" on every board.
  const CATEGORY = 'https://www.robolinkmarket.com/3d-yazicilar';
  files = freshFiles();
  sandbox = load(files);
  const done = await post(sandbox, 'progress', {
    jobId: 'job-robolink',
    events: [
      { type: 'done', url: CATEGORY, card: { url: CATEGORY, name: '3d yazicilar' } },
      { type: 'gather', urls: [CATEGORY + '/', ROBO_NEW] }
    ]
  });
  assert.equal(done.status, 200);
  assert.deepEqual(Object.keys(files['jobs.json'].find((j) => j.id === 'job-robolink').cards).sort(), [ROBO, ROBO_NEW].sort(), 'the category page never becomes a card');

  // Runs saved before the fix still hold that card: the admin board leaves it out.
  const admin = { state: null, collectCards: null, uncertainRows: null, isHeldOut: null };
  const adminSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin', 'admin.js'), 'utf8')
    .replace('  init();', 'globalThis.test = { state, collectCards, uncertainRows, isHeldOut };');
  const adminContext = { URL, console, window: {}, document: { addEventListener() {}, getElementById: () => null } };
  vm.runInNewContext(adminSource, adminContext);
  Object.assign(admin, adminContext.test);
  admin.state.data = { jobs: [], catalog: { products: [], filaments: [] } };
  const saved = {
    id: 'job-old', url: CATEGORY, kind: 'printer',
    cards: { [CATEGORY]: { url: CATEGORY, name: '3d yazicilar' }, [ROBO]: { url: ROBO, name: 'Bambu Lab A1 Combo 3D Yazıcı', price: 23688, decision: { action: 'create' } } },
    events: [{ type: 'done', url: CATEGORY, card: { url: CATEGORY, name: '3d yazicilar' } }]
  };
  assert.deepEqual(Array.from(admin.collectCards(saved, admin.state.data), (e) => e.card.url), [ROBO], 'no board card for the run\'s own category page');

  // A listing held out as another category (a colour module on a printer page) stays marked all the way
  // to the board. The worker used to strip the mark from event items, so the board showed the module as
  // a plain card with no ⚠ banner and no Discard / Create category, and bulk publish could take it.
  const { compactEvent } = require('../worker/online-worker.cjs');
  const AMS = 'https://www.robolinkmarket.com/bambu-lab-ams-2-pro';
  const sent = compactEvent({ type: 'mismatch', items: [{ url: AMS, name: 'Bambu Lab AMS 2 Pro', image: 'https://cdn.example/ams.jpg', kind: 'accessory', price: 12999, mismatch: { detectedType: 'accessory', declaredType: 'printer' } }] });
  assert.equal(sent.items[0].mismatch.detectedType, 'accessory', 'the worker keeps the mismatch on the event');
  assert.equal(compactEvent({ type: 'done', url: CATEGORY }).card, undefined, 'the closing event is not a card');
  files = freshFiles();
  sandbox = load(files);
  assert.equal((await post(sandbox, 'progress', { jobId: 'job-robolink', events: [sent] })).status, 200);
  const job = files['jobs.json'].find((j) => j.id === 'job-robolink');
  assert.deepEqual(JSON.parse(JSON.stringify(job.cards[AMS].mismatch)), { detectedType: 'accessory', declaredType: 'printer' }, 'the server keeps it on the card');
  assert.equal(job.cards[AMS].price, 12999);
  admin.state.data = { jobs: [job], catalog: { products: [], filaments: [] }, baseline: { items: [] } };
  const onBoard = Array.from(admin.collectCards(job, admin.state.data)).find((e) => e.card.url === AMS);
  assert.ok(onBoard && (onBoard.mismatch || onBoard.card.mismatch), 'the board shows it as held out');
  const live = Array.from(admin.uncertainRows(admin.state.data).live);
  assert.ok(live.some((e) => e.card.url === AMS), 'Uncertain lists it, for you to decide');
  assert.equal(live.filter((e) => !admin.isHeldOut(e)).some((e) => e.card.url === AMS), false, 'Force publish all leaves it out');

  console.log('PASS: a finished run only turns its own shop\'s offers into review cards — a Robolink run no longer shows pending Rhino listings, the category page is never a card, and a held-out module stays held out.');
})().catch((e) => { console.error(e); process.exitCode = 1; });
