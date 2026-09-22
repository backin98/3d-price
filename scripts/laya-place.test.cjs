const assert = require('node:assert/strict');
const { layaPick } = require('../lib/qwen-place.cjs');

const catalog = [
  { id: 'combo', name: 'Bambu Lab P1S Combo 3D Yazıcı', brand: 'Bambu Lab', kind: 'printer', offers: [] },
  { id: 'bare', name: 'Bambu Lab P1S 3D Yazıcı', brand: 'Bambu Lab', kind: 'printer', offers: [] },
  { id: 'a1', name: 'Bambu Lab A1 3D Yazıcı', brand: 'Bambu Lab', kind: 'printer', offers: [] }
];
const listing = { name: 'Bambu Lab P1S Combo 3D Printer', brand: 'Bambu Lab', kind: 'printer', url: 'https://shop.example/p1s-combo' };
const scores = (values) => async (_name, candidates) => ({ threshold: 0.8, matches: candidates.map((c) => ({ id: c.id, score: values[c.id] || 0 })) });

(async () => {
  const merged = await layaPick(listing, catalog, { scorer: scores({ combo: 0.97, bare: 0.8 }) });
  assert.equal(merged.action, 'merge');
  assert.equal(merged.matchId, 'combo');

  const refused = await layaPick(listing, [catalog[1]], { scorer: scores({ bare: 0.99 }) });
  assert.equal(refused.action, 'hold');
  assert.equal(refused.rejected, 'conflict', 'Laya cannot merge combo onto a bare printer');

  const different = await layaPick(listing, catalog, { scorer: scores({ combo: 0.03, bare: 0.02, a1: 0.01 }) });
  assert.equal(different.action, 'create');

  console.log('PASS: baseline-trained Laya scores a closed list and Magellan still blocks hard conflicts.');
})().catch((err) => { console.error(err); process.exitCode = 1; });
