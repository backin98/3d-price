// The matching invariants (README): combo ≠ bare, kit ≠ assembled, a bundle with extra hardware ≠
// the printer alone, different laser wattages never merge, and a listing that is "like" or "for"
// another product (tarzı, muadil, uyumlu + a part) is never that product.
//
// Two layers. Named pairs, each a real title from the shops. Then every cross-shop pair of real
// printer listings (docs/real-listings.jsonl) that share a model: anything decidePair merges must
// agree on every invariant axis. The corpus audit found the Prusa kits, the Adventurer 5X
// "Enclosed Kit Bundle", the Centauri Carbon 2 dryer/filament bundles and "A1 Uyumlu Hotend"
// merging with the bare printer.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { decidePair, identity, fold } = require('../lib/product-match.cjs');
const { classifyProductType } = require('../lib/product-type.cjs');

const decide = (a, b) => decidePair({ id: 'a', name: a, kind: 'printer' }, { id: 'b', name: b, kind: 'printer' });
const never = (a, b, why) => {
  const d = decide(a, b);
  assert.notEqual(d.action, 'merge', why + ': ' + JSON.stringify(a) + ' merged with ' + JSON.stringify(b) + ' (' + d.reason + ')');
};
const same = (a, b) => {
  const d = decide(a, b);
  assert.equal(d.action, 'merge', 'the same printer: ' + JSON.stringify(a) + ' ~ ' + JSON.stringify(b) + ' (' + d.reason + ')');
};

// combo ≠ bare
never('Bambu Lab P1S Combo 3D Yazıcı', 'Bambu Lab P1S 3D Yazıcı', 'combo vs bare');
never('Bambu Lab P1S AMS 2 Pro Combo', 'Bambu Lab P1S Combo', 'a different feeder generation');
never('Anycubic Kobra 3 V2 Combo 3D Yazıcı', 'Anycubic Kobra 3 V2 3D Yazıcı', 'combo vs bare');
// kit ≠ assembled, including a kit named on one side only
never('Original Prusa CORE One 3D Printer Kit', 'Original Prusa CORE One 3D Printer', 'kit vs assembled');
never('Original Prusa CORE One 3D Printer Kit', 'Original Prusa CORE One Assembled 3D Printer', 'kit vs assembled');
never('Prusa MK4S Kit', 'Prusa MK4S', 'kit vs assembled');
// a bundle that adds hardware is not the printer alone
never('FLASHFORGE Adventurer 5X & Enclosed Kit Bundle (Kamera Hediyeli)', 'FLASHFORGE Adventurer 5X 3D Yazıcı', 'enclosure bundle vs bare');
never('ELEGOO Centauri Carbon 2 Combo 3D Yazıcı R3D Kurutucu Bundle', 'Elegoo Centauri Carbon 2 Combo', 'dryer bundle vs combo');
never('ELEGOO Centauri Carbon 2 Combo 3D Yazıcı R3D Kurutucu Bundle', 'ELEGOO Centauri Carbon 2 Combo 3D Yazıcı Beta Filament Bundle', 'two different bundles');
// laser wattage
never('Bambu Lab H2D Laser Full Combo 10W 3D Yazıcı', 'Bambu Lab H2D Laser Full Combo 40W 3D Yazıcı', '10 W vs 40 W');
never('Bambu Lab H2C Laser 10W Full Combo 3D Yazıcı', 'Bambu Lab H2C Laser 40W Full Combo 3D Yazıcı', '10 W vs 40 W');
never('Bambu Lab H2D Laser Full Combo 10W', 'Bambu Lab H2D Combo 3D Yazıcı', 'a laser edition vs the plain combo');
// like / for / compatible
never('Bambu Lab X1C Tarzı 3D Yazıcı', 'Bambu Lab X1 Carbon 3D Yazıcı', 'a lookalike');
never('X1 Carbon Muadil Nozul', 'Bambu Lab X1 Carbon', 'a knock-off part');
never('Bambu Lab A1 Uyumlu Hotend', 'Bambu Lab A1 3D Yazıcı', 'a part that fits');
never('Bambu Lab A1 Mini Uyumlu PEI Plaka', 'Bambu Lab A1 Mini 3D Yazıcı', 'a part that fits');

// ...and the same printer worded differently still merges
same('Bambu Lab H2D Laser Full Combo 10W', 'Bambu Lab H2D Laser Full Combo 10W 3d Yazıcı Fiyatı Ve Özellikleri');
same('Bambu Lab A1 Combo 3D Yazıcı', 'Bambu Lab A1 Combo');
same('Bambu Lab P1S AMS 2 Pro 3D Yazıcı', 'Bambu Lab P1S AMS 2 Pro Combo 3D Yazıcı');
same('FLASHFORGE Adventurer 5X & Enclosed Kit Bundle (Kamera Hediyeli)', 'FLASHFORGE Adventurer 5X Enclosed Kit Bundle (Kamera Hediyeli)');
same('Original Prusa CORE One 3D Printer Kit', 'Prusa CORE One Kit');
assert.equal(decide('Bambu Lab H2S 3D Yazıcı (AMS uyumlu)', 'Bambu Lab H2S 3D Yazıcı').reason.includes('compatible part'), false,
  '"AMS uyumlu" on a real printer is a feature, not a part');

// --- every real cross-shop pair of the same model ---------------------------------------------
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const rows = fs.readFileSync(path.join(__dirname, '..', 'docs', 'real-listings.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const seen = new Set();
const byModel = new Map();
for (const r of rows) {
  const key = r.title + '|' + host(r.url);
  if (!r.title || seen.has(key) || classifyProductType(r.title, '') !== 'printer') continue;
  seen.add(key);
  const listing = { id: key, name: r.title, kind: 'printer', shop: host(r.url) };
  const core = identity(listing).modelCore;
  if (!core) continue;
  if (!byModel.has(core)) byModel.set(core, []);
  byModel.get(core).push(listing);
}
const f = (s) => ' ' + fold(s) + ' ';
const axes = {
  'kit/assembled': (s) => /\skit(?:i)?\s/.test(f(s)) && !/\s(?:enclosed|upgrade)\s+kit/.test(f(s)),
  'laser watts': (s) => (fold(s).match(/\b(\d{1,3}) ?w\b/) || [])[1] || '',
  'like/for': (s) => /\s(?:tarzi|muadil|benzeri)\s/.test(f(s)),
  'bundle extras': (s) => (/\s(?:bundle|set)\s/.test(f(s)) || /[+&]/.test(s)) ? ['enclosed kit', 'kurutucu', 'filament'].filter((w) => f(s).includes(' ' + w + ' ')).join('+') : '',
  'mini': (s) => /\smini\s/.test(f(s))
};
let pairs = 0;
const broken = [];
for (const group of byModel.values()) {
  for (let i = 0; i < group.length; i++) {
    for (let j = i + 1; j < group.length; j++) {
      const a = group[i];
      const b = group[j];
      if (a.shop === b.shop) continue;
      pairs += 1;
      const d = decidePair(a, b);
      if (d.action !== 'merge') continue;
      for (const [axis, of] of Object.entries(axes)) {
        if (of(a.name) !== of(b.name)) broken.push(axis + ': ' + JSON.stringify(a.name) + ' ~ ' + JSON.stringify(b.name) + ' (' + d.reason + ')');
      }
    }
  }
}
assert.ok(pairs > 1000, 'the corpus audit must cover the real pairs, got ' + pairs);
assert.deepEqual(broken, [], 'merges that break an invariant:\n' + broken.join('\n'));

console.log(`PASS: matching invariants hold on named pairs and on ${pairs} real cross-shop pairs of the same model.`);
