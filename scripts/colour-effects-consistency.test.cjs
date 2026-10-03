// The finishes a swatch can have are listed in five places (the rules, the API, the worker, the admin page, the storefront).
// If one list drifts, a finish is silently dropped on its way from the run to the screen. This keeps them equal.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EFFECTS } = require('../lib/house-rules.cjs');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const listIn = (src, re, label) => {
  const m = src.match(re);
  assert.ok(m, 'could not find the finish list in ' + label);
  return [...m[1].matchAll(/"([a-z]+)"/g)].map((x) => x[1]);
};
const sorted = (a) => [...a].sort();

assert.deepEqual(sorted(listIn(read('netlify/functions/admin.mjs'), /const COLOUR_EFFECTS = \[([^\]]*)\]/, 'netlify/functions/admin.mjs')), sorted(EFFECTS), 'API');
assert.deepEqual(sorted(listIn(read('public/admin/admin.js'), /const COLOUR_EFFECTS = \[([^\]]*)\]/, 'public/admin/admin.js')), sorted(EFFECTS), 'admin page');
assert.deepEqual(sorted(listIn(read('public/js/app.js'), /\[("marble"[^\]]*)\]\.indexOf\(p\.colorEffect\)/, 'public/js/app.js')), sorted(EFFECTS), 'storefront');
assert.match(read('worker/online-worker.cjs'), /EFFECTS: COLOUR_EFFECTS\b[^\n]*house-rules\.cjs/, 'the worker takes the list from the rules');

// every finish has a look in the shared stylesheet
const css = read('public/css/swatch-finishes.css');
for (const fx of EFFECTS.filter((e) => !['marble', 'galaxy'].includes(e))) assert.match(css, new RegExp('\\.fx-' + fx + '\\b'), 'a look for ' + fx);
// and the two flecked looks keep theirs in the page stylesheets
assert.match(read('public/admin/admin.css'), /\.colour-dot\.fx-marble/);
assert.match(read('public/css/styles.css'), /\.cdot\.fx-galaxy/);

console.log('PASS: the swatch finishes are the same list in the rules, the API, the worker, the admin page and the storefront, and each has a look.');
