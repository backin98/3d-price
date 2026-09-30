// Filament details from real shop titles (docs/real-listings.jsonl): when a title states a polymer,
// a diameter or a spool weight, the classifier must read exactly that. It read "Esun PLA-High Speed
// Filament - Peek Green" as PEEK: the longest polymer alias anywhere in the title won, and the colour
// name "Peek Green" is longer than "PLA". The first material named is the material.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { classifyFilament, gramsFromText, coloursFromName } = require('../api/filament-classify.js');
const { classifyProductType } = require('../lib/product-type.cjs');

const named = (title, want) => {
  const got = classifyFilament({ name: title });
  for (const [key, value] of Object.entries(want)) {
    assert.equal(got[key], value, JSON.stringify(title) + ' ' + key);
  }
};
named('Esun PLA-High Speed Filament - Peek Green', { polymer: 'pla', variant: 'high-speed', color: 'green' });
named('Fibromast PEEK Filament Natural', { polymer: 'peek' });
named('Bambu Lab PETG-CF Filament', { polymer: 'petg', variant: 'cf' });
named('Esun PLA+ Filament', { polymer: 'pla', variant: 'plus' });
named('Creality Ender PLA+ Kırmızı Filament 1.75mm 1000gr', { polymer: 'pla', color: 'red', weight: '1000 g', diameter: '1.75 mm' });
named('Polymaker PolyLite PETG 2.85mm', { polymer: 'petg', diameter: '2.85 mm' });
named('Basf Ultrafuse PAHT CF15 1.75 mm 750g', { weight: '750 g', diameter: '1.75 mm' });

// Every real filament title: what it states, the classifier reads.
const rows = fs.readFileSync(path.join(__dirname, '..', 'docs', 'real-listings.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const seen = new Set();
const wrong = [];
let n = 0;
let withColour = 0;
for (const r of rows) {
  const t = r.title;
  if (!t || seen.has(t) || classifyProductType(t, '') !== 'filament') continue;
  seen.add(t);
  n += 1;
  const c = classifyFilament({ name: t });
  const diameter = /\b1[.,]75\s*mm|\b1[.,]75\b/.test(t) ? '1.75 mm' : /\b2[.,]85/.test(t) ? '2.85 mm' : '';
  if (diameter && c.diameter !== diameter) wrong.push('diameter ' + c.diameter + ' for ' + JSON.stringify(t));
  const grams = gramsFromText(t);
  if (grams && c.weight !== grams + ' g') wrong.push('weight ' + c.weight + ' for ' + JSON.stringify(t));
  const polymer = /\bpetg\b/i.test(t) ? 'petg' : /\bpla\b|pla\+|pla-/i.test(t) ? 'pla' : /\babs\b/i.test(t) ? 'abs' : /\basa\b/i.test(t) ? 'asa' : /\btpu\b/i.test(t) ? 'tpu' : '';
  if (polymer && c.polymer !== polymer && !(polymer === 'pla' && c.polymer === 'plabs')) wrong.push('polymer ' + c.polymer + ' for ' + JSON.stringify(t));
  if (c.color || coloursFromName(t).length) withColour += 1;
}
assert.ok(n > 1000, 'the audit covers the real filament titles, got ' + n);
assert.deepEqual(wrong, [], 'filament fields that disagree with the title:\n' + wrong.join('\n'));
assert.ok(withColour / n > 0.85, 'most real spools name a colour the classifier reads: ' + withColour + '/' + n);

console.log(`PASS: polymer, diameter and weight read as stated on ${n} real filament titles; ${withColour} with a colour.`);
