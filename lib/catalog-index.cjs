// Catalog index: the published brand/model reference as data, so Magellan can read identity
// instead of guessing from marketing words, and so Gemma can be handed a *closed* list of
// identities to choose from ("allowedIdentities") rather than being asked to invent one.
//
// Source: the 2026-09-20 brand/model reference pass (official storefronts + compare pages),
// restricted to what this catalogue and Turkish shops actually stock. Rows the reference marks
// uncertain are encoded as boost-only aliases: they may raise confidence, never force a split.
//
// Nothing here is required for matching to work: an unlisted maker still gets a full identity
// from the generic axis parser, with an `unknown/...` id (see axesOf).

const fold = (s) =>
  String(s || '')
    .toLocaleLowerCase('tr')
    .replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ç/g, 'c').replace(/ğ/g, 'g')
    .replace(/ü/g, 'u').replace(/ö/g, 'o')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

// ---------------------------------------------------------------- brands
const BRANDS = {
  bambu: ['bambu', 'bambu lab', 'bambulab', 'bbl'],
  creality: ['creality', 'creality3d', 'creality 3d'],
  anycubic: ['anycubic', 'any cubic'],
  elegoo: ['elegoo'],
  flashforge: ['flashforge', 'flash forge', 'ff'],
  snapmaker: ['snapmaker', 'snap maker'],
  prusa: ['prusa', 'prusa research', 'original prusa'],
  qidi: ['qidi', 'qidi tech'],
  flsun: ['flsun'],
  sovol: ['sovol', 'sovol3d'],
  artillery: ['artillery', 'artillery3d'],
  voron: ['voron', 'voron design'],
  wanhao: ['wanhao'],
  twotrees: ['twotrees', 'two trees', 'two trees 3d'],
  kingroon: ['kingroon'],
  zaxe: ['zaxe'],
  raise3d: ['raise3d', 'raise 3d', 'raise'],
  ultimaker: ['ultimaker', 'ultimaker'],
  bcn3d: ['bcn3d', 'bcn 3d'],
  formlabs: ['formlabs', 'form labs'],
  phrozen: ['phrozen'],
  xtool: ['xtool', 'x tool'],
  atomstack: ['atomstack', 'atom stack'],
  iemai: ['iemai'],
  creality_falcon: ['falcon', 'creality falcon'],
};

const BRAND_BY_ALIAS = (() => {
  const map = new Map();
  for (const [id, aliases] of Object.entries(BRANDS)) {
    for (const a of aliases) map.set(a, id);
  }
  return map;
})();

// ---------------------------------------------------------------- models
// alias -> canonical identity stem. Longest alias wins, so "k2 plus" beats "k2" and
// "a1 mini" beats "a1". Every alias is folded.
const MODELS = {
  bambu: {
    'a1 mini': 'a1-mini',
    'a1mini': 'a1-mini',
    a2l: 'a2l',
    a1: 'a1',
    p1p: 'p1p',
    'p1s carbon': 'p1s',
    p1s: 'p1s',
    p2s: 'p2s',
    'x1 carbon': 'x1c',
    x1c: 'x1c',
    x1: 'x1',
    x2d: 'x2d',
    h2s: 'h2s',
    h2d: 'h2d',
    h2c: 'h2c'
  },
  creality: {
    'k2 plus': 'k2-plus',
    'k2 pro': 'k2-pro',
    'k2 se': 'k2-se',
    k2: 'k2',
    'k1 max': 'k1-max',
    'k1 se': 'k1-se',
    'k1c 2025': 'k1c',
    k1c: 'k1c',
    k1: 'k1',
    'ender 3 v3 se': 'ender-3-v3-se',
    'ender 3 v3': 'ender-3-v3',
    'ender 3': 'ender-3',
    'ender 5 max': 'ender-5-max',
    'sparkx i7': 'sparkx-i7',
    'hi combo': 'hi',
    hi: 'hi',
    'cr 10': 'cr-10',
    'falcon a1c': 'falcon-a1c',
    'falcon a1 pro': 'falcon-a1-pro',
    'falcon a1': 'falcon-a1',
    'falcon t1': 'falcon-t1',
    'falcon2 pro s': 'falcon2-pro-s',
    'falcon2 pro': 'falcon2-pro',
    falcon2: 'falcon2'
  },
  anycubic: {
    'kobra 3 max': 'kobra-3-max',
    'kobra 3 v2': 'kobra-3-v2',
    'kobra 3': 'kobra-3',
    'kobra 4': 'kobra-4',
    'kobra s1 max': 'kobra-s1-max',
    'kobra s1': 'kobra-s1',
    'kobra x': 'kobra-x',
    'kobra 2 max': 'kobra-2-max',
    'kobra 2': 'kobra-2',
    'kobra go': 'kobra-go',
    vyper: 'vyper',
    'photon mono m7 pro': 'photon-mono-m7-pro',
    'photon mono m7': 'photon-mono-m7',
    'photon mono 4 ultra': 'photon-mono-4-ultra',
    'photon mono 4': 'photon-mono-4',
    'photon p1 max': 'photon-p1-max',
    'photon p1': 'photon-p1',
    'wash cure 3 max': 'wash-cure-3-max',
    'wash cure 3 plus': 'wash-cure-3-plus',
    'wash cure 3': 'wash-cure-3'
  },
  elegoo: {
    'centauri carbon 2': 'centauri-carbon-2',
    'centauri carbon': 'centauri-carbon',
    'centauri 2': 'centauri-2',
    'neptune 4 max': 'neptune-4-max',
    'neptune 4 plus': 'neptune-4-plus',
    'neptune 4 pro': 'neptune-4-pro',
    'neptune 4': 'neptune-4',
    'neptune 3 pro': 'neptune-3-pro',
    'neptune 3': 'neptune-3',
    'mars 5 ultra': 'mars-5-ultra',
    'mars 5': 'mars-5',
    'mars 4 ultra': 'mars-4-ultra',
    'mars 4': 'mars-4',
    'saturn 4 ultra 16k': 'saturn-4-ultra-16k',
    'saturn 4 ultra': 'saturn-4-ultra',
    'saturn 4': 'saturn-4',
    'saturn 3 ultra': 'saturn-3-ultra',
    'saturn 3': 'saturn-3',
    'jupiter 2': 'jupiter-2',
    orangestorm: 'orangestorm-giga',
    'mercury plus': 'mercury-plus',
    'mercury xs': 'mercury-xs'
  },
  flashforge: {
    ad5x: 'ad5x',
    'adventurer 5m pro': 'adventurer-5m-pro',
    'adventurer 5m': 'adventurer-5m',
    'adventurer 5x': 'adventurer-5x',
    'adventurer 5x combo': 'adventurer-5x',
    'adventurer 3': 'adventurer-3',
    'adventurer 4': 'adventurer-4',
    'creator 5 pro': 'creator-5-pro',
    'creator 5': 'creator-5',
    'creator 4': 'creator-4',
    'creator pro 2': 'creator-pro-2',
    guider: 'guider'
  },
  snapmaker: {
    artisan: 'artisan',
    'snapmaker 2 0 a350': 'snapmaker-2-a350',
    'snapmaker 2 0 a250': 'snapmaker-2-a250',
    'snapmaker 2 0 a150': 'snapmaker-2-a150',
    a350: 'snapmaker-2-a350',
    a250: 'snapmaker-2-a250',
    a150: 'snapmaker-2-a150',
    u1: 'u1',
    j1s: 'j1s',
    j1: 'j1',
    ray: 'ray'
  },
  prusa: {
    'core one l': 'core-one-l',
    'core one': 'core-one',
    'xl': 'xl',
    mk4s: 'mk4s',
    'mk3s': 'mk3s',
    'mini': 'mini',
    sl1s: 'sl1s',
    ht90: 'ht90'
  },
  qidi: {
    q2c: 'q2c',
    q2: 'q2',
    plus4: 'plus4',
    plus5: 'plus5',
    max4: 'max4',
    'x max 3': 'x-max-3',
    'x plus 3': 'x-plus-3'
  },
  flsun: {
    't1 pro': 't1-pro',
    't1 max': 't1-max',
    't1': 't1',
    's1 pro': 's1-pro',
    's1': 's1',
    'v400 max': 'v400-max',
    'v400': 'v400'
  },
  sovol: {
    // "ACE" here is part of Sovol's own model name, never Anycubic's ACE feeder.
    'sv06 plus ace': 'sv06-plus-ace',
    'sv06 ace': 'sv06-ace',
    'sv06 plus': 'sv06-plus',
    sv06: 'sv06',
    'sv08 max': 'sv08-max',
    sv08: 'sv08',
    'sv07 plus': 'sv07-plus',
    sv07: 'sv07',
    sv04: 'sv04',
    zero: 'zero'
  },
  artillery: {
    'm1 pro s1': 'm1-pro-s1',
    'm1 pro': 'm1-pro',
    'm1': 'm1',
    'sidewinder x4 pro': 'sidewinder-x4-pro',
    'sidewinder x4 plus': 'sidewinder-x4-plus',
    'sidewinder x4': 'sidewinder-x4',
    sidewinder: 'sidewinder-x2',
    genius: 'genius'
  },
  voron: {
    '2 4': '2-4',
    trident: 'trident',
    '0 2': '0-2',
    switchwire: 'switchwire'
  },
  twotrees: {
    sk1: 'sk1',
    'blu 5': 'blu-5',
    'blu 3': 'blu-3',
    'sapphire pro': 'sapphire-pro',
    'sapphire plus': 'sapphire-plus',
    'sp 5': 'sp-5',
    bluer: 'bluer',
    ttc3018: 'ttc3018',
    ttc450: 'ttc450',
    ttc6050: 'ttc6050'
  },
  kingroon: {
    'kp3s pro v2': 'kp3s-pro-v2',
    'kp3s pro': 'kp3s-pro',
    kp3s: 'kp3s',
    klp1: 'klp1'
  },
  zaxe: {
    z3s: 'z3s',
    x4: 'x4',
    z3: 'z3',
    z2: 'z2',
    z1: 'z1'
  },
  raise3d: {
    'pro3 hs': 'pro3-hs',
    pro3: 'pro3',
    e3: 'e3',
    rmf500: 'rmf500',
    'df2 plus': 'df2-plus',
    df2: 'df2',
    rms220: 'rms220'
  },
  ultimaker: {
    'factor 4': 'factor-4',
    s8: 's8',
    s7: 's7',
    'method xl': 'method-xl',
    'method x': 'method-x',
    method: 'method'
  },
  bcn3d: {
    'epsilon w50': 'epsilon-w50',
    'epsilon w27': 'epsilon-w27',
    'sigma d25': 'sigma-d25',
    'omega i60': 'omega-i60'
  },
  formlabs: {
    'form 4bl': 'form-4bl',
    'form 4b': 'form-4b',
    'form 4l': 'form-4l',
    'form 4': 'form-4',
    'form 3bl': 'form-3bl',
    'form 3b': 'form-3b',
    'form 3l': 'form-3l',
    'form 3': 'form-3',
    'fuse 1': 'fuse-1',
    fuse: 'fuse-1'
  },
  phrozen: {
    'sonic mighty revo': 'sonic-mighty-revo',
    'sonic mega 8k v2': 'sonic-mega-8k-v2',
    'sonic mega 8k': 'sonic-mega-8k',
    'sonic mini 8k': 'sonic-mini-8k',
    arco: 'arco'
  },
  xtool: {
    'f1 ultra': 'f1-ultra',
    f1: 'f1',
    p3: 'p3',
    p2s: 'p2s',
    p2: 'p2',
    s1: 's1',
    'm1 ultra': 'm1-ultra',
    m1: 'm1'
  },
  atomstack: {
    'a20 pro': 'a20-pro',
    'a40 pro': 'a40-pro',
    'x20 pro': 'x20-pro',
    'x30 pro': 'x30-pro',
    's20 pro': 's20-pro'
  },
  iemai: {
    'magic ht max': 'magic-ht-max',
    'ym nt 1200': 'ym-nt-1200',
    'ym nt 1000': 'ym-nt-1000',
    'ym nt 750': 'ym-nt-750',
    'fast jet 1500': 'fast-jet-1500'
  },
  creality_falcon: {}
};

// ---------------------------------------------------------------- feeders / multicolor packs
// Brand-scoped on purpose: Sovol's "ACE" is a model word, Anycubic's "ACE Pro" is a feeder.
// A token only means a feeder for the brand that owns it.
const FEEDERS = {
  bambu: { 'ams 2 pro': 'ams-2-pro', 'ams lite': 'ams-lite', 'ams ht': 'ams-ht', ams: 'ams' },
  creality: { 'cfs c': 'cfs-c', 'cfs 2': 'cfs-2', 'cfs 4': 'cfs-4', cfs: 'cfs' },
  anycubic: { 'ace 2 pro': 'ace-2-pro', 'ace pro': 'ace-pro' },
  elegoo: { canvas: 'canvas' },
  flashforge: { ifs: 'ifs' },
  qidi: { 'qidi box': 'qidi-box', box: 'qidi-box' },
  prusa: { 'mmu3': 'mmu3', mmu: 'mmu3', 'indx 8 tool': 'indx', indx: 'indx' },
  ultimaker: { 'material station': 'material-station' }
};

// "Combo" without a named feeder still means the feeder that model ships with. Knowing the
// brand's default is what makes "Kobra S1 Combo" (ACE Pro) differ from "Kobra S1 ACE 2 Pro
// Combo", instead of both looking like the same bundle worded twice.
const DEFAULT_FEEDER = {
  bambu: 'ams',
  creality: 'cfs',
  anycubic: 'ace-pro',
  elegoo: 'canvas',
  flashforge: 'ifs',
  qidi: 'qidi-box',
  prusa: 'mmu3'
};

// A bundle word means "printer + its feeder" without naming the generation.
const COMBO_WORDS = ['combo', 'unite li', 'multicolor', 'cok renkli'];
// The opposite: explicitly no feeder. Only meaningful when the brand has feeders at all.
const BARE_WORDS = ['ams siz', 'amsiz', 'bare', 'without ams', 'feederless'];

// ---------------------------------------------------------------- technology
const RESIN_WORDS = ['resin', 'recine', 'sla', 'dlp', 'lcd', 'photon', 'mars', 'saturn', 'jupiter', 'halot', 'form 3', 'form 4', 'fuse', 'sonic'];
const LASER_WORDS = ['laser', 'lazer', 'falcon', 'engraver', 'atomstack', 'xtool', 'diode', 'co2'];
const CNC_WORDS = ['cnc', 'ttc3018', 'ttc450', 'ttc6050'];
// Brands whose own name settles the technology when the title says nothing.
const RESIN_ONLY_BRANDS = new Set(['formlabs', 'phrozen', 'bcn3d']);

// ---------------------------------------------------------------- noise
// Words shops add that never identify a product. Kept here (not only in the matcher) so the
// same list feeds the axes parser and the Gemma context.
const NOISE = [
  'buffer', 'with buffer', 'buffered', 'hediyeli', 'hediye', 'kampanya', 'indirim', 'indirimli',
  'firsat', 'outlet', 'teşhir', 'teshir', '16 renge', '16 renk', 'cok renkli', 'renkli',
  'super hizli', 'super', 'hizli', 'kapali govde', 'hizli kargo', 'ucretsiz kargo', 'kargo bedava',
  'kargo', '3d', '3d yazici', '3d printer', 'yazici', 'printer', 'filamentli', 'set', 'yeni', 'new',
  'enhanced', 'exclusive', 'vip', 'refurbished', 'yenilenmis', 'ikinci el', 'sifir', 'orijinal',
  'resmi', 'garantili', 'garanti', 'distributor', 'ithalatci', 'turkiye', 'stoktan', 'teslim',
  'mm', 'cm', 'adet', 'kutu', 'hediyeli kutu', 'sok', 'taksit', 'fatura', 'bedava'
];

// Model cores so generic that two *unknown* brands sharing one must not auto-merge.
const GENERIC_CORES = new Set(['i3', 'i3-mega', 'mega', 'ender-3', 'prusa-i3', 'clone', 'diy', 'a1', 'k2']);

// No table entry for this maker: derive the model core from the title's own alphanumerics, so
// "xyz-200", "kp3s" or "blu-3" still identify one product across shops. Pure numbers, units and
// marketing words are not a model.
function genericModelCore(title, brandAlias) {
  const noise = new Set(NOISE);
  const brandWords = new Set(fold(brandAlias || '').split(' ').filter(Boolean));
  const words = fold(title)
    .split(' ')
    .filter((w) => w && !noise.has(w) && !brandWords.has(w) && !/^\d+(mm|cm|w|kg|g|tl|adet)$/.test(w));
  // A model looks like "kp3s", "blu3", "h2d" (letters and digits in one token)…
  const mixed = words.filter((w) => /[a-z]/.test(w) && /\d/.test(w) && w.length > 1);
  // …or like "XYZ-200" / "Ender 3", where folding splits the letter from the number.
  const pairs = [];
  for (let i = 0; i < words.length - 1; i++) {
    if (/^[a-z]{2,5}$/.test(words[i]) && /^\d{1,4}$/.test(words[i + 1])) pairs.push(words[i] + '-' + words[i + 1]);
  }
  const core = mixed[0] || pairs[0] || '';
  if (!core) return '';
  const variant = words.find((w) => ['pro', 'plus', 'max', 'mini', 'ultra', 'se', 'lite'].includes(w));
  return variant && !core.includes(variant) ? core + '-' + variant : core;
}

const longestAliasMatch = (title, table) => {
  const t = ' ' + fold(title) + ' ';
  let best = '';
  let bestId = '';
  for (const [alias, id] of Object.entries(table || {})) {
    if (!alias) continue;
    if (t.includes(' ' + alias + ' ') && alias.length > best.length) {
      best = alias;
      bestId = id;
    }
  }
  return bestId ? { alias: best, id: bestId } : null;
};

const brandOf = (title) => {
  const t = fold(title);
  let best = '';
  let bestId = '';
  for (const [alias, id] of BRAND_BY_ALIAS) {
    if (!alias) continue;
    if (new RegExp('(^|\\s)' + alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\s|$)').test(t) && alias.length > best.length) {
      best = alias;
      bestId = id;
    }
  }
  return bestId ? { id: bestId, alias: best } : null;
};

const modelOf = (brandId, title) => (brandId && MODELS[brandId] ? longestAliasMatch(title, MODELS[brandId]) : null);

const feederOf = (brandId, title) => (brandId && FEEDERS[brandId] ? longestAliasMatch(title, FEEDERS[brandId]) : null);

const wordHit = (title, words) => {
  const t = ' ' + fold(title) + ' ';
  return (words || []).find((w) => t.includes(' ' + fold(w) + ' ')) || '';
};

const technologyOf = (brandId, title) => {
  const t = fold(title);
  if (wordHit(title, CNC_WORDS) || /\bcnc\b/.test(t)) return 'cnc';
  // A laser *machine*, not a laser caught in the marketing: "Lazer modülü hediyeli" is a gift,
  // while "Laser Edition" / "Laser Full Combo" / Falcon / xTool / Atomstack are the machine.
  const laserMachine = wordHit(title, LASER_WORDS) || /\b(laser|lazer)\s+(edition|full combo)\b/.test(t);
  const giftOnly = /\b(hediyeli|hediye|ucretsiz|free)\b/.test(t) && !/\b(edition|full combo)\b/.test(t);
  if (laserMachine && !giftOnly) return 'laser';
  if (wordHit(title, RESIN_WORDS)) return 'resin';
  if (brandId && RESIN_ONLY_BRANDS.has(brandId) && !wordHit(title, ['fdm', 'filament'])) return 'resin';
  return 'fdm';
};

const laserWattsOf = (title) => {
  const m = fold(title).match(/\b(\d{1,3})\s*w\b/);
  return m ? m[1] : '';
};

const kitFormOf = (title) => {
  const t = fold(title);
  if (/\b(assembly kit|kit topla|toplama kiti|montajsiz|unassembled|diy|klon|clone)\b/.test(t)) return 'kit';
  if (/\b(assembled|preassembled|montajli|kurulu)\b/.test(t)) return 'assembled';
  return '';
};

// The size tier that is genuinely part of identity for these machines (Voron build volume,
// FLSUN/Snapmaker bed sizes). A random "300x300x300 mm" spec string is noise, not a tier.
const sizeTierOf = (title) => {
  const t = fold(title);
  const m = t.match(/\b(250|300|350)\s*(mm)?\b/);
  return m ? m[1] : '';
};

// Stable identity id: brand/model/axis-flags, e.g. "bambu/p1s/combo/ams-2-pro", or
// "unknown/kp3s/bare" when the maker is not in the table. The axes that are present are the
// ones encoded, in a fixed order, so two shops wording the same machine land on one id.
function identityId(axes) {
  // An unlisted maker contributes no brand to the id: `unknown/<model>/<axes>` is what two shops
  // selling the same white-label machine can agree on.
  const brand = axes.brandId || 'unknown';
  const core = axes.modelCore || (axes.modelWords || []).join('-') || 'unnamed';
  const parts = [brand, core];
  if (axes.sizeTier) parts.push('size-' + axes.sizeTier);
  parts.push(axes.comboAxis === 'combo' ? 'combo' : 'bare');
  if (axes.feederGen) parts.push(axes.feederGen);
  if (axes.laserWatts) parts.push('laser-' + axes.laserWatts + 'w');
  if (axes.kitForm) parts.push(axes.kitForm);
  if (axes.technology && axes.technology !== 'fdm') parts.push(axes.technology);
  if (axes.variantTag) parts.push(axes.variantTag.replace(/\s+/g, '-'));
  if (axes.mini) parts.push('mini');
  return parts.join('/');
}

module.exports = {
  fold,
  DEFAULT_FEEDER,
  BRANDS,
  BRAND_BY_ALIAS,
  MODELS,
  FEEDERS,
  COMBO_WORDS,
  BARE_WORDS,
  NOISE,
  GENERIC_CORES,
  RESIN_WORDS,
  LASER_WORDS,
  brandOf,
  modelOf,
  genericModelCore,
  feederOf,
  technologyOf,
  laserWattsOf,
  kitFormOf,
  sizeTierOf,
  wordHit,
  identityId
};
