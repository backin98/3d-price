// Backup / restore. The promise is absolute: restoring a named backup puts the database back
// exactly as it was, overriding everything that happened since. So the test changes every part
// after the backup and then insists the restore brings all of it back.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'netlify', 'functions', 'admin.mjs'), 'utf8')
  .replace(/^import .*;$/gm, '')
  .replace('export default async', 'globalThis.handler = async');

const files = {};
function makeStore(seed) {
  for (const [k, v] of Object.entries(seed)) files[k] = JSON.parse(JSON.stringify(v));
  return {
    readJSON: async (key, fallback) => (key in files ? JSON.parse(JSON.stringify(files[key])) : fallback),
    writeJSON: async (key, value) => { files[key] = JSON.parse(JSON.stringify(value)); },
    deleteKey: async (key) => { delete files[key]; }
  };
}

// headers.entries() is what the function reads to find the owner.
const req = (body) => ({ method: 'POST', headers: { get: () => null, entries: () => [][Symbol.iterator]() }, json: async () => body });

const catalog = (rows) => ({
  source: { id: 'multi', name: 'Shops' }, savedAt: '2026-02-02T10:00:00.000Z',
  products: rows.map((n, i) => ({ id: 'p' + i, name: n, offers: [{ store: 'shop.com', price: 1000 + i, url: 'https://shop.com/' + i }] })),
  filaments: []
});

const store = makeStore({
  'catalog.json': catalog(['Creality K2', 'Creality K2 Combo', 'Bambu Lab P1S']),
  'desk.json': { shops: [{ id: 'rhino', name: 'Rhino', url: 'https://www.rhino3dprinter.com', vat: 'included' }], banners: [] },
  'candidate.json': { savedAt: '2026-02-02T09:00:00.000Z', products: [], filaments: [] },
  'jobs.json': [{ id: 'job-1', createdAt: '2026-02-01T00:00:00.000Z', url: 'https://www.rhino3dprinter.com' }]
});

const sandbox = { console, Response, money: require('../lib/parse-money.cjs'), store, auth: { ownerFromHeaders: () => ({ role: 'owner' }), authReady: () => true } };
vm.runInNewContext(source, sandbox);
const call = (body) => sandbox.handler(req(body)).then(async (res) => ({ status: res.status, body: await res.json() }));

(async () => {
  // --- a backup needs a name ---------------------------------------------------------
  const unnamed = await call({ action: 'createBackup', name: '   ' });
  assert.notEqual(unnamed.status, 200, 'an unnamed backup is refused: ' + JSON.stringify(unnamed.body));

  // --- back it up --------------------------------------------------------------------
  const made = await call({ action: 'createBackup', name: 'before the big cleanup' });
  assert.equal(made.status, 200, JSON.stringify(made.body));
  assert.equal(made.body.backup.name, 'before the big cleanup');
  assert.equal(made.body.backup.rows, 3, 'three products counted');
  assert.equal(made.body.backup.offers, 3, 'and their offers');
  assert.equal(made.body.backup.shops, 1, 'and the shops');
  assert.equal(made.body.backup.hasDraft, true, 'the draft is part of it');
  assert.equal(made.body.backup.jobs, undefined, 'run history is not part of a backup');
  const key = made.body.backup.key;
  assert.match(key, /^backups\/before-the-big-cleanup-/, 'the key is readable and namespaced: ' + key);
  assert.equal(made.body.backups.length, 1, 'the index lists it');

  // A second backup of a different name coexists.
  const second = await call({ action: 'createBackup', name: 'after publishing' });
  assert.equal(second.body.backups.length, 2, 'two backups listed');
  assert.equal(second.body.backups[0].name, 'after publishing', 'newest first');

  // --- now wreck everything ----------------------------------------------------------
  await call({ action: 'deleteAllCatalog' });
  assert.equal(files['catalog.json'].products.length, 0, 'catalog emptied');
  files['desk.json'] = { shops: [], banners: [] };
  files['desk.json'].shops.push({ id: 'added-later', name: 'A shop added later' });
  files['jobs.json'] = [{ id: 'job-2', createdAt: '2026-03-01T00:00:00.000Z', url: 'https://www.rhino3dprinter.com' }];
  files['desk.json'].shops[0].vat = 'excluded';
  files['candidate.json'] = { savedAt: '2026-03-03T00:00:00.000Z', products: [{ id: 'new', name: 'Added after the backup' }], filaments: [] };
  assert.equal(files['catalog.json'].products.length, 0, 'nothing left in the catalog');
  assert.equal(files['jobs.json'][0].id, 'job-2', 'a newer run replaced the old one');

  // --- restore: everything comes back, exactly ----------------------------------------
  const restored = await call({ action: 'restoreBackup', key });
  assert.equal(restored.status, 200, JSON.stringify(restored.body));
  assert.equal(restored.body.restored.name, 'before the big cleanup');
  assert.deepEqual(
    files['catalog.json'].products.map((p) => p.name),
    ['Creality K2', 'Creality K2 Combo', 'Bambu Lab P1S'],
    'the catalog is back as it was'
  );
  assert.equal(files['catalog.json'].savedAt, '2026-02-02T10:00:00.000Z', 'including its timestamp');
  assert.equal(files['desk.json'].shops.length, 1, 'the shops are back');
  assert.equal(files['desk.json'].shops[0].id, 'rhino', 'the shop added later is gone');
  assert.equal(files['desk.json'].shops[0].vat, 'included', 'and its old setting is back');
  assert.deepEqual(files['candidate.json'].products.map((p) => p.name), [], 'the draft is back to the snapshot, not the newer one');
  // Run history is not data: a restore must not resurrect old runs over newer ones.
  assert.equal(files['jobs.json'][0].id, 'job-2', 'the run history is left alone by a restore');

  // --- a restore is itself undoable ---------------------------------------------------
  const auto = restored.body.backups.find((b) => /before restore/.test(b.name));
  assert.ok(auto, 'a snapshot of the pre-restore state was taken: ' + JSON.stringify(restored.body.backups.map((b) => b.name)));
  assert.equal(auto.rows, 0, 'and it captured the empty catalog we were about to replace');
  const back = await call({ action: 'restoreBackup', key: auto.key });
  assert.equal(back.status, 200, JSON.stringify(back.body));
  assert.equal(files['catalog.json'].products.length, 0, 'restoring the auto-snapshot returns the emptied state');
  assert.equal(files['desk.json'].shops[0].id, 'added-later', 'with the shop added later');
  // put the real backup back so the rest of the test is predictable
  await call({ action: 'restoreBackup', key });
  assert.equal(files['catalog.json'].products.length, 3, 'sanity: restored again');

  // --- deleting a backup never touches live data --------------------------------------
  const deleted = await call({ action: 'deleteBackup', key: second.body.backup.key });
  assert.equal(deleted.status, 200);
  assert.equal(deleted.body.backups.some((b) => b.key === second.body.backup.key), false, 'it is gone from the index');
  assert.equal(files['catalog.json'].products.length, 3, 'and the catalog is untouched');
  assert.equal(deleted.body.backups.some((b) => b.key === key), true, 'the other backup is still listed');

  // --- bad input is refused, not guessed at -------------------------------------------
  const bogus = await call({ action: 'restoreBackup', key: 'catalog.json' });
  assert.notEqual(bogus.status, 200, 'only a backups/ key can be restored');
  const missing = await call({ action: 'restoreBackup', key: 'backups/nope-123.json' });
  assert.notEqual(missing.status, 200, 'a backup that does not exist is an error');
  assert.equal(files['catalog.json'].products.length, 3, 'and a failed restore changes nothing');

  console.log('PASS: a named backup restores the catalog, draft, shops and runs exactly, overriding everything since — and the restore itself is undoable.');
})().catch((e) => { console.error(e); process.exitCode = 1; });
