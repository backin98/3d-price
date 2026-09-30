// No limit = everything the category lists; a limit stops at that many.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { jobLimits } = require('../lib/qwen-website-job.cjs');
const { harvestCategory } = require('../lib/harvest.js');

assert.deepEqual(jobLimits({}), { maxProducts: Infinity, maxPages: 400 }, 'no limit: all products, a big page budget');
assert.deepEqual(jobLimits({ maxProducts: 0 }), { maxProducts: Infinity, maxPages: 400 });
assert.deepEqual(jobLimits({ maxProducts: 50 }), { maxProducts: 50, maxPages: 40 }, 'a small limit keeps the normal page budget');
assert.equal(jobLimits({ maxProducts: 900 }).maxPages, 123, 'a big limit gets enough pages to reach it');
assert.equal(jobLimits({ maxProducts: 50, maxPages: 5 }).maxPages, 5, 'an explicit page limit wins');

(async () => {
  const urls = Array.from({ length: 520 }, (_, i) => `https://shop.example/creality-ender-3-v${i}-3d-yazici`);
  const all = await harvestCategory({ kind: 'printer', urls });
  assert.equal(all.inScope.length, 520, 'no maxProducts: all 520, not 400');
  const some = await harvestCategory({ kind: 'printer', urls, maxProducts: 25 });
  assert.equal(some.inScope.length, 25, 'a limit stops at that many');
  // the run form sends 0 for an empty box and the server stores it as "no limit"
  const form = fs.readFileSync('public/admin/admin.js', 'utf8');
  assert.match(form, /id="shop-max" type="number" min="1" step="1" placeholder="All products"/, 'the box starts empty');
  assert.ok(!/id="shop-max"[^>]*max="400"/.test(form), 'and is not capped at 400');
  console.log('PASS: no limit scrapes every product the category lists; a limit stops at that number.');
})().catch((e) => { console.error(e); process.exitCode = 1; });
