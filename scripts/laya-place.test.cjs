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

  const valment = { name: 'Creality K2 PROCombo 3D Yazıcı CFS Çok Renkli Baskı', brand: 'Creality', kind: 'printer', url: 'https://shop.example/k2-procombo' };
  const choices = [
    { id: 'k2', name: 'Creality K2 Combo 3D Yazıcı', brand: 'Creality', kind: 'printer', offers: [] },
    { id: 'ender', name: 'Creality Ender 3 V4 Combo 3D Yazıcı', brand: 'Creality', kind: 'printer', offers: [] },
    { id: 'spark', name: 'Creality SparkX i7 Combo 3D Yazıcı', brand: 'Creality', kind: 'printer', offers: [] },
    { id: 'k2pro', name: 'Creality K2 Pro Combo 3D Yazıcı', brand: 'Creality', kind: 'printer', offers: [] },
    { id: 'k1max', name: 'Creality K1 Max 3D Yazıcı', brand: 'Creality', kind: 'printer', offers: [] },
    { id: 'foreign', name: 'Bambu Lab P1S Combo 3D Yazıcı', brand: 'Bambu Lab', kind: 'printer', offers: [] }
  ];
  let seen = [];
  const recovered = await layaPick(valment, choices, { scorer: async (_name, candidates) => {
    seen = candidates.map((c) => c.id);
    return { threshold: 0.8, matches: candidates.map((c) => ({ id: c.id, score: c.id === 'k2' ? 0.99 : c.id === 'k2pro' ? 0.96 : 0.2 })) };
  } });
  assert.ok(seen.includes('k2pro'), 'Laya sees every relevant same-brand candidate, not only the first three');
  assert.ok(!seen.includes('foreign'), 'Laya does not compare across known brands');
  assert.equal(recovered.action, 'merge');
  assert.equal(recovered.matchId, 'k2pro', 'a conflicting first score falls through to the best valid identity');

  console.log('PASS: baseline-trained Laya scores every relevant candidate and skips hard conflicts.');
})().catch((err) => { console.error(err); process.exitCode = 1; });
