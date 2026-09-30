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

function freshFiles() {
  return {
    'jobs.json': [
      {
        id: 'job-robolink', url: 'https://www.robolinkmarket.com/3d-yazicilar', kind: 'printer', status: 'running',
        createdAt: '2026-09-30T10:00:00.000Z', cards: { [ROBO]: { url: ROBO, name: 'Bambu Lab A1 Combo 3D Yazıcı' } }, events: []
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
      { id: 'p-p2s', name: 'Bambu Lab P2S Combo', kind: 'printer', offers: [{ store: 'robolinkmarket.com', url: ROBO_NEW, price: 41000 }] },
      { id: 'p-k2', name: 'Creality K2 Plus Combo', kind: 'printer', offers: [{ store: 'robolinkmarket.com', url: ROBO_LIVE, price: 60000 }] }
    ],
    filaments: [
      { id: 'f-matte', name: 'RhinoLab PLA Matte', kind: 'filament', offers: [{ store: 'rhino3dprinter.com', url: RHINO, price: 450 }] },
      { id: 'f-rapid', name: 'Filamix Rapid PLA+', kind: 'filament', offers: [{ store: 'rhino3dprinter.com', url: RHINO_2, price: 520 }] }
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
  assert.equal(robolink.status, 'complete');
  assert.deepEqual(files['candidate.json'].filaments.map((f) => f.id), ['f-matte', 'f-rapid'], 'the pending Rhino work stays in the candidate, untouched');
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

  console.log('PASS: a finished run only turns its own shop\'s offers into review cards — a Robolink run no longer shows pending Rhino listings.');
})().catch((e) => { console.error(e); process.exitCode = 1; });
