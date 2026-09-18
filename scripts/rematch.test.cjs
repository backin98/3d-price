// Aggressive LLM help: a second, on-demand pass. It must only run when asked, only on what
// the deterministic pass could not sort, and it must never publish by itself.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const vm = require('node:vm');

const askDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rematch-'));

// --- the model is stubbed: one call per listing, answer configurable -----------------
const Module = require('node:module');
const load = Module._load;
let asked = 0;
let answer = { decision: 'merge', matchId: 'cat-p1s', confidence: 0.92, reason: 'same printer, shops spell AMS differently' };
Module._load = function (request, ...rest) {
  if (request === '../scripts/local-qwen.cjs') {
    return { ask: async (task, input) => { asked += 1; assert.equal(task, 'match-gray'); lastInput = input; return answer; } };
  }
  return load.call(this, request, ...rest);
};
let lastInput = null;
const { gemmaPick } = require('../lib/qwen-place.cjs');

const catalog = [
  { id: 'cat-p1s', name: 'Bambu Lab P1S Combo 3D Yazıcı', brand: 'Bambu Lab', kind: 'printer', offers: [{ url: 'https://rhino.example/p1s-combo' }] },
  { id: 'cat-a1', name: 'Bambu Lab A1 3D Yazıcı', brand: 'Bambu Lab', kind: 'printer', offers: [{ url: 'https://rhino.example/a1' }] },
  { id: 'cat-bare', name: 'Bambu Lab P1S 3D Yazıcı', brand: 'Bambu Lab', kind: 'printer', offers: [{ url: 'https://rhino.example/p1s' }] }
];
const listing = { name: 'Bambu Lab P1s Combo 3D Yazıcı Ams ile 16 Renge Kadar Baskı', brand: 'Bambu Lab', kind: 'printer', url: 'https://shop.example/p1s' };

(async () => {
  // 1. A merge answer comes back as a placement, with the candidates it saw.
  const merged = await gemmaPick(listing, catalog, { dir: askDir });
  assert.equal(asked, 1, 'exactly one model call for one listing');
  assert.equal(merged.action, 'merge');
  assert.equal(merged.matchId, 'cat-p1s');
  assert.equal(merged.candidates[0].id, 'cat-p1s', 'the best catalog candidates are reported back');
  assert.ok(merged.candidates.every((c) => typeof c.score === 'number'));
  assert.ok(lastInput.candidates.length <= 3, 'only the top few candidates are sent, not the whole catalog');

  // 1b. The local model says "match", not "merge" — that must merge, not hold.
  answer = { decision: 'match', matchId: 'cat-p1s', confidence: 0.95, reason: 'same printer' };
  const synonym = await gemmaPick(listing, catalog, { dir: askDir });
  assert.equal(synonym.action, 'merge', 'a "match" answer is a merge, not a silent hold');

  // 2. The listing's own row is never offered as a candidate (it is already in the catalog).
  const own = await gemmaPick({ ...listing, url: 'https://rhino.example/p1s-combo' }, catalog, { dir: askDir });
  assert.ok(!own.candidates.some((c) => c.id === 'cat-p1s'), 'the row it came from is excluded');

  // 3. An empty catalog is not a reason to call the model at all.
  const before = asked;
  const cold = await gemmaPick(listing, [], { dir: askDir });
  assert.equal(cold.action, 'create');
  assert.equal(asked, before, 'no model call when there is nothing to compare against');

  // 4. A hard conflict cannot be merged by the model, even when it says merge.
  answer = { decision: 'merge', matchId: 'cat-bare', confidence: 0.95, reason: 'looks the same to me' };
  const bare = { name: 'Bambu Lab P1S 3D Yazıcı', brand: 'Bambu Lab', kind: 'printer', url: 'https://shop.example/bare' };
  const held = await gemmaPick({ ...bare, name: 'Bambu Lab P1S 3D Yazıcı' }, [
    { id: 'cat-p1s', name: 'Bambu Lab P1S Combo 3D Yazıcı', brand: 'Bambu Lab', kind: 'printer', offers: [{ url: 'https://rhino.example/p1s-combo' }] }
  ], { dir: askDir });
  assert.equal(held.action, 'hold', 'combo/bare conflict survives the aggressive pass');
  answer = { decision: 'create', matchId: null, confidence: 0.9, reason: 'nothing like it in the catalog' };

  // 5. The review board offers both buttons, disabled until there is something to ask about.
  const context = {
    URL, document: { querySelector: () => null, querySelectorAll: () => [] }, location: { hash: '' },
    window: {}, setInterval: () => 1, clearInterval() {}, setTimeout() {}, clearTimeout() {},
    fetch: async () => ({ ok: true, status: 200, json: async () => ({}) })
  };
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin', 'admin.js'), 'utf8').replace('  init();', '  globalThis.test={reviewBoardHtml};');
  vm.runInNewContext(src, context);
  const job = { id: 'j1', events: [
    { card: { url: 'https://shop.example/p1s', name: 'Gathered P1S', kind: 'printer' }, decision: { action: 'merge', candidateId: 'cat-p1s' } },
    { card: { url: 'https://shop.example/mystery', name: 'Unmatched mystery', kind: 'printer' }, decision: {} }
  ] };
  const html = context.test.reviewBoardHtml(job, { catalog: { products: [], filaments: [] } });
  assert.match(html, /Aggressive LLM help/);
  assert.match(html, /id="gemma-unmatched"[^>]*>Ask Gemma: all unmatched \(1\)/, 'counts only the unmatched card');
  assert.match(html, /id="gemma-selected" disabled[^>]*>Ask Gemma: selected \(0\)/, 'disabled until cards are selected');

  // --- the endpoint: validation and refusals, no model needed -------------------------
  const port = 18791;
  const child = spawn(process.execPath, [path.join('worker', 'online-worker.cjs')], {
    env: {
      ...process.env,
      INGEST_TOKEN: 'test-token-long-enough',
      WORKER_PORT: String(port),
      WORKER_HOST: '127.0.0.1',
      // Unreachable site and no poll: this test must never claim a real job.
      ONLINE_URL: 'http://127.0.0.1:1/',
      POLL_MS: '600000',
      ONLINE_CATALOG_FILE: path.join(askDir, 'no-such-catalog.json')
    },
    cwd: path.join(__dirname, '..'),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let out = '';
  child.stdout.on('data', (c) => { out += c; });
  child.stderr.on('data', (c) => { out += c; });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('worker did not start: ' + out)), 8000);
    const check = () => { if (/Worker listening at/.test(out)) { clearTimeout(t); resolve(true); } };
    child.stdout.on('data', check);
    child.stderr.on('data', check);
    child.on('exit', (code) => { clearTimeout(t); reject(new Error('exited ' + code + ': ' + out)); });
  });
  try {
    const base = 'http://127.0.0.1:' + port + '/rematch';
    const none = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cards: [] }) });
    assert.equal(none.status, 400);
    assert.match((await none.json()).error, /No cards/);
    const noCatalog = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cards: [{ name: 'X', url: 'https://x.example/1', kind: 'printer' }] }) });
    assert.equal(noCatalog.status, 400);
    assert.match((await noCatalog.json()).error, /No local catalog/);
  } finally {
    child.kill();
  }

  console.log('PASS: aggressive Gemma help is on demand only, excludes the row it came from, cannot override conflicts, and says so when it has nothing to work with.');
})()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => { Module._load = load; fs.rmSync(askDir, { recursive: true, force: true }); });
