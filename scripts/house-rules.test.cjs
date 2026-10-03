// What your own edits teach the run (lib/house-rules.cjs): spool material, sub-brand lines, finish, learned tones.
// The labels here are tiny made-up ones; the real rules are learned and scored on your cards by `npm run learn`.
const assert = require('node:assert/strict');
const R = require('../lib/house-rules.cjs');
const { normalizeFilamentListing } = require('../lib/qwen-website-job.cjs');

// ---- sub-brand lines: Creality and Polymaker --------------------------------------------------------------------
const sub = (brand, title) => R.subBrandOf(brand, title);
assert.equal(sub('Creality', 'Creality Ender PLA+ Filament - Beige'), 'Ender');
assert.equal(sub('Creality', 'Creality Ender Fast PLA Siyah Filament 1.75mm 1000gr'), 'Ender');
assert.equal(sub('Creality', 'Creality CR-PLA Filament - Red'), 'CR');
assert.equal(sub('Creality', 'Creality CR PLA Beyaz Filament 1.75mm 1Kg'), 'CR');
assert.equal(sub('Creality', 'Creality CR-PETG Gri Filament 1.75mm 1000gr'), 'CR');
assert.equal(sub('Creality', 'Creality Space Pi PETG Filament'), 'Space Pi');
// Hyper is the high-speed variant in your baseline, not a sub-brand; a plain Creality PLA has no line.
assert.equal(sub('Creality', 'Creality Hyper PLA Filament - Black'), '');
assert.equal(sub('Creality', 'Creality Silk PLA Filament - Blue'), '');
assert.equal(sub('Polymaker', 'Polymaker Panchroma Matte PLA Filament Arctic Teal'), 'Panchroma');
assert.equal(sub('Polymaker', 'Polymaker Panchroma PLA Filament Celestial Mavi'), 'Panchroma');
assert.equal(sub('Polymaker', 'Polymaker PolyTerra Matte PLA Filament - Arctic Teal'), 'PolyTerra');
assert.equal(sub('Polymaker', 'Polymaker Poly Lite ASA Filament'), 'PolyLite');
assert.equal(sub('Polymaker', 'Polymaker PolyFlex TPU95'), 'PolyFlex');
assert.equal(sub('Polymaker', 'Polymaker Fiberon PA12-CF10 Filament (0.5 KG)'), 'Fiberon');
assert.equal(sub('Polymaker', 'Polymaker HT-PLA Filament Turkuaz'), '', 'no line named: none guessed');
assert.equal(sub('Bambu Lab', 'Bambu Lab PLA Matte Filament - Dark Red'), '', 'other brands are not touched');
// A line you typed yourself for some other brand is recognised the next time.
const taught = R.learnRules({ cards: [{ brand: 'eSUN', subBrand: 'eTwinkling', sourceTitle: 'eSUN eTwinkling PLA Filament - Blue' }] });
assert.equal(R.subBrandOf('eSUN', 'eSUN eTwinkling PLA Filament - Red', taught), 'eTwinkling');

// ---- spool material, learned ---------------------------------------------------------------------------------------
const card = (brand, polymer, variant, spool, extra) => ({ brand, polymer, variant, spoolMaterial: spool, sourceTitle: brand + ' ' + polymer, ...extra });
const cards = [
  ...Array.from({ length: 8 }, () => card('RhinoLab', 'pla', 'plus', 'plastic')),
  ...Array.from({ length: 3 }, () => card('RhinoLab', 'abs', 'cf', 'cardboard')),
  ...Array.from({ length: 2 }, () => card('RhinoLab', 'petg', 'cf', 'cardboard')),
  ...Array.from({ length: 6 }, () => card('eSUN', 'pla', 'plus', 'cardboard')),
  card('Bambu Lab', 'pla', 'matte', 'plastic')
];
const rules = R.learnRules({ cards });
let g = R.predictSpool(rules, { brand: 'RhinoLab', polymer: 'pla', variant: 'plus' });
assert.equal(g.value, 'plastic');
assert.ok(g.confidence >= R.SURE, 'eight of eight is sure: ' + JSON.stringify(g));
// the most specific evidence speaks: every RhinoLab -CF is cardboard, though RhinoLab is mostly plastic
g = R.predictSpool(rules, { brand: 'RhinoLab', polymer: 'asa', variant: 'cf' });
assert.equal(g.value, 'cardboard', 'RhinoLab -CF is cardboard: ' + JSON.stringify(g));
assert.equal(g.level, 'brand+variant');
// one card is not enough to be sure
g = R.predictSpool(rules, { brand: 'Bambu Lab', polymer: 'pla', variant: 'matte' });
assert.ok(g && g.confidence < R.SURE, 'a single example is only a hint: ' + JSON.stringify(g));
assert.equal(R.predictSpool(rules, { brand: 'Unknown Brand', polymer: 'pla' }), null, 'a brand never seen: no guess');

// ---- enrich: fills blanks, never overwrites -------------------------------------------------------------------------
const base = { kind: 'filament', brand: 'RhinoLab', polymer: 'pla', variant: 'plus', name: 'RhinoLab PLA+ Filament', sourceTitle: 'RhinoLab PLA+ Filament - Red' };
let out = R.enrichListing(base, rules);
assert.equal(out.spoolMaterial, 'plastic');
assert.equal(out.guess.spoolMaterial.from, 'your labels');
assert.equal(R.enrichListing({ ...base, spoolMaterial: 'cardboard' }, rules).spoolMaterial, 'cardboard', 'a value that is set is never replaced');
assert.equal(R.enrichListing({ ...base, subBrand: 'Mine' }, rules).subBrand, 'Mine');
out = R.enrichListing({ ...base, brand: 'Bambu Lab', variant: 'matte', sourceTitle: 'Bambu Lab PLA Matte' }, rules);
assert.equal(out.spoolMaterial, undefined, 'a weak guess is only offered, not filled in');
assert.ok(out.guess.spoolMaterial && out.guess.spoolMaterial.value === 'plastic');
assert.equal(R.enrichListing({ kind: 'printer', brand: 'Bambu Lab', name: 'P1S' }, rules).guess, undefined, 'printers are not touched');

// ---- learned tones: only your own picks teach ---------------------------------------------------------------------
const toneRules = R.learnRules({ cards: [
  { brand: 'Acme', colorName: 'Red', color: 'red', colorHex: '#aa2233', sourceTitle: 'Acme Red' },
  { brand: 'Acme', colorName: 'Red', color: 'red', colorHex: '#ab2334', sourceTitle: 'Acme Red' },
  { brand: 'Other', colorName: 'Red', color: 'red', colorHex: '#ff0000', colorHexSource: 'photo', sourceTitle: 'Other Red' }
] });
assert.equal(R.toneFor(toneRules, { brand: 'Acme', colorName: 'Red' }).level, 'brand+colour');
assert.ok(['#aa2233', '#ab2334'].includes(R.toneFor(toneRules, { brand: 'Acme', colorName: 'Red' }).hex), 'a shade you really picked, not an average');
assert.equal(R.toneFor(toneRules, { brand: 'Other', colorName: 'Red' }).hex.toLowerCase().startsWith('#a'), true, 'a photo-picked shade does not teach the run');
assert.equal(R.toneFor(toneRules, { brand: 'Acme', colorName: 'Red', multicolor: true }), null, 'gradients have no single tone');

// ---- a guess you left alone is not a label ---------------------------------------------------------------------------------
{
  const guess = (field, value) => ({ [field]: { value, from: 'your labels', confidence: 0.9 } });
  const taught = R.learnRules({ cards: [
    // saved by autosave with the run's own guess still in place: says nothing about what you think
    { brand: 'Zed', polymer: 'pla', variant: 'plus', spoolMaterial: 'cardboard', handEdited: true, guess: guess('spoolMaterial', 'cardboard'), sourceTitle: 'Zed PLA+' },
    // you changed the guess: that is a label
    { brand: 'Zed', polymer: 'pla', variant: 'plus', spoolMaterial: 'plastic', handEdited: true, guess: guess('spoolMaterial', 'cardboard'), sourceTitle: 'Zed PLA+' },
    // no guess was ever made (an older card): a label
    { brand: 'Zed', polymer: 'pla', variant: 'plus', spoolMaterial: 'plastic', handEdited: true, sourceTitle: 'Zed PLA+' }
  ] });
  assert.equal(taught.trainedOn.spoolLabels, 2, 'only the corrected and the unguessed card count');
  assert.deepEqual(taught.spool.brand.zed, { plastic: 2 });
  const subs = R.learnRules({ cards: [{ brand: 'Zed', subBrand: 'Lite', handEdited: true, guess: guess('subBrand', 'Lite'), sourceTitle: 'Zed Lite PLA' }] });
  assert.deepEqual(subs.subBrands, {}, 'a sub-brand the run guessed itself is not learned back');
}

// ---- the run uses it ---------------------------------------------------------------------------------------------------
const run = (title, brand) => normalizeFilamentListing({ name: title, sourceTitle: title, brand, kind: 'filament', url: 'https://x.test/' + title.replace(/\W+/g, '-'), price: 500 });
let l = run('Polymaker Panchroma Silk PLA Filament Krom', 'Polymaker');
assert.equal(l.subBrand, 'Panchroma');
l = run('Creality Ender PLA+ Filament - Beige', 'Creality');
assert.equal(l.subBrand, 'Ender');
l = run('Bambu Lab PLA Matte Filament - Dark Red', 'Bambu Lab');
assert.equal(l.spoolMaterial, 'plastic', 'learned from your Bambu Lab cards');
l = run('Porima PETG Transparan Filament - Neon Yeşil', 'Porima');
assert.equal(l.colorEffect, '', 'no sheen effects: only marble and galaxy are drawn on a swatch');
assert.equal(run('Polymaker Panchroma Silk PLA Filament Krom', 'Polymaker').colorEffect, '');
assert.equal(run('RhinoLab PLA Marble Filament - Marble', 'RhinoLab').colorEffect, 'marble');
assert.equal(run('Esun PLA Galaxy Filament - Night', 'Esun').colorEffect, 'galaxy');

console.log('PASS: Creality and Polymaker lines are read from the title, spool material is learned from your labels (specific evidence wins, weak guesses are only hints) and nothing set by a person is overwritten.');

// ---- the store guard: a scratch or emptied store must never replace good rules ---------------------------------------
{
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const S = require('../lib/house-rules-store.cjs');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'house-rules-'));
  const rulesFile = path.join(tmp, 'rules.json');
  const store = path.join(tmp, 'store');
  fs.mkdirSync(store);
  const job = (n) => [{ id: 'j', cards: Object.fromEntries(Array.from({ length: n }, (_, i) => ['https://x.test/' + i, { url: 'https://x.test/' + i, handEdited: true, brand: 'Acme', polymer: 'pla', spoolMaterial: 'plastic', sourceTitle: 'Acme PLA ' + i }])) }];
  const keepEnv = { f: process.env.HOUSE_RULES_FILE, s: process.env.SITE_STORE_DIR };
  try {
    process.env.HOUSE_RULES_FILE = rulesFile;
    delete process.env.SITE_STORE_DIR;
    fs.writeFileSync(path.join(store, 'jobs.json'), JSON.stringify(job(5)));
    assert.equal(S.learnIfStale(store).learned, true, 'first time: learns from 5 hand-edited cards');
    assert.equal(JSON.parse(fs.readFileSync(rulesFile, 'utf8')).trainedOn.cards, 5);
    // an emptied store is newer than the rules but has fewer labels: the rules stay
    fs.writeFileSync(path.join(store, 'jobs.json'), JSON.stringify(job(0)));
    const later = new Date(Date.now() + 5000);
    fs.utimesSync(path.join(store, 'jobs.json'), later, later);
    const guarded = S.learnIfStale(store);
    assert.equal(guarded.learned, false);
    assert.equal(JSON.parse(fs.readFileSync(rulesFile, 'utf8')).trainedOn.cards, 5, 'good rules were not replaced');
    // a scratch copy (SITE_STORE_DIR) never teaches, even with more cards
    fs.writeFileSync(path.join(store, 'jobs.json'), JSON.stringify(job(9)));
    fs.utimesSync(path.join(store, 'jobs.json'), new Date(Date.now() + 9000), new Date(Date.now() + 9000));
    process.env.SITE_STORE_DIR = store;
    assert.equal(S.learnIfStale(store).why, 'scratch store');
    delete process.env.SITE_STORE_DIR;
    assert.equal(S.learnIfStale(store).learned, true, 'the real store with more labels does teach');
    assert.equal(JSON.parse(fs.readFileSync(rulesFile, 'utf8')).trainedOn.cards, 9);
  } finally {
    if (keepEnv.f === undefined) delete process.env.HOUSE_RULES_FILE; else process.env.HOUSE_RULES_FILE = keepEnv.f;
    if (keepEnv.s === undefined) delete process.env.SITE_STORE_DIR; else process.env.SITE_STORE_DIR = keepEnv.s;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log('PASS: relearning at start never replaces good rules with a scratch or emptied store.');
}
