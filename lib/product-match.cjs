const { classifyFilament } = require('../api/filament-classify');
const { VISUAL_SAME, VISUAL_WEAK } = require('./image-match.cjs');
// The published brand/model reference, as data. It supplies the axes that marketing words
// cannot: which model this is, which feeder generation, laser watts, kit vs assembled.
const idx = require('./catalog-index.cjs');

// Words that never identify a product: marketing, size, capability. Shops pad titles with
// them, and padding must not make two names look different.
const STOP = new Set(['3d', 'printer', 'yazici', 'filament', 'fiyat', 'inceleme', 'stoktan', 'car', 'vehicle', 'urun', 'product', 'cihaz', 'model', 'vs', 've', 'ile', 'the', 'and', 'for', 'of', 'with', 'makine', 'fdm', 'yeni', 'new', 'versiyon', 'version', 'outlet', 'bundle', 'buffer', 'buffered', 'hediyeli', 'indirimli', 'kampanya', 'super', 'hizli', 'kapali', 'govde', 'kadar', 'renge', 'renkli', 'baski', 'mm', 'cm']);

// A configuration word says how a printer is equipped; a variant word says WHICH printer it
// is. "K2 Combo" and "K2 Plus Combo" are two different machines at two different prices, so a
// variant word must never be treated as padding when one title is a superset of the other.
const VARIANT_WORDS = new Set(['plus', 'pro', 'max', 'ultra', 'lite', 'neo', 'turbo', 'se', 'ke', 'xl']);
const variantTag = (n) => [...new Set(String(n || '').split(/\s+/).filter((t) => VARIANT_WORDS.has(t)))].sort().join(' ');
const COLORS = {
  siyah: 'black', black: 'black', beyaz: 'white', white: 'white', gri: 'gray', grey: 'gray', gray: 'gray',
  kirmizi: 'red', red: 'red', mavi: 'blue', blue: 'blue', yesil: 'green', green: 'green',
  turuncu: 'orange', orange: 'orange', sari: 'yellow', yellow: 'yellow', mor: 'purple', purple: 'purple',
  pembe: 'pink', pink: 'pink', altin: 'gold', gold: 'gold', gumus: 'silver', silver: 'silver',
  bej: 'beige', beige: 'beige', kahve: 'brown', brown: 'brown', nature: 'natural', natural: 'natural'
};

const fold = s => String(s || '').toLocaleLowerCase('tr').replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/[^a-z0-9]+/g, ' ').trim();
// Equivalents run before stripping punctuation so PLA+ survives as "pla plus".
// Absence of a word stays unknown: it is not "uncoloured", "no spool", or "plain".
function titleRules(s) {
  let t = String(s || '').toLocaleLowerCase('tr')
    .replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ö/g, 'o');
  t = t
    .replace(/\bqidi\s+tech\b/g, 'qidi')
    .replace(/\bbambu\s*lab\b/g, 'bambu lab')
    .replace(/\bflash\s*forge\b/g, 'flashforge')
    .replace(/\boriginal\s*prusa\b/g, 'prusa')
    .replace(/\buniteli\b|\bams\s*unite/g, 'combo')
    // "AMS ile" / "AMS'li" / "with AMS" is the same statement as "Combo": printer + AMS.
    // "AMS'siz" / "without AMS" is the opposite: a bare printer. Without this the two
    // spellings look like different products and never merge.
    .replace(/\bams['’]?\s*(?:ile|li)\b|\bams['’]?\s*l[iı]\b|\bwith\s+ams\b/g, 'combo')
    .replace(/\bams['’]?\s*s[iı]z\b|\bamsiz\b|\bams\s*olmadan\b|\bwithout\s+ams\b/g, 'bare')
    .replace(/\bipek\b/g, 'silk')
    .replace(/\bpla\s*\+/g, 'pla plus')
    .replace(/\bpetg\s*\+/g, 'petg plus')
    .replace(/\babs\s*\+/g, 'abs plus')
    .replace(/\bhigh\s*speed\b|\byuksek\s*hiz\b/g, 'rapid')
    .replace(/\bcarbon\s*fiber\b|\bkarbon\s*elyaf\b/g, 'cf')
    .replace(/\bglass\s*fiber\b|\bcam\s*elyaf\b/g, 'gf')
    .replace(/\bspoolless\b|\bwithout\s+spool\b|\bmakarasiz\b/g, 'refill')
    .replace(/\bwith\s+spool\b|\bmakarali\b/g, 'spool')
    .replace(/\b1000\s*g(r)?\b/g, '1kg')
    .replace(/\b1\s*kg\b/g, '1kg')
    .replace(/1[,.]75\s*(mm)?/g, '175mm')
    .replace(/2[,.]85\s*(mm)?/g, '285mm');
  return t.replace(/[^a-z0-9]+/g, ' ').trim();
}
const tokens = s => [...new Set(titleRules(s).split(' ').filter(x => x.length > 1 && !STOP.has(x) && !/^202\d$/.test(x)))];

function dist(a, b) {
  if (a === b) return 0;
  if (a.length < b.length) return dist(b, a);
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] : 1 + Math.min(prev[j - 1], prev[j], cur[j - 1]);
    prev = cur;
  }
  return prev[b.length];
}
const similar = (a, b) => {
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 4) return false;
  const d = dist(a, b);
  return d <= 1 || d / Math.max(a.length, b.length) <= 0.2;
};

const score = (a, b) => {
  if (titleRules(a) && titleRules(a) === titleRules(b)) return 1;
  const x = tokens(a), y = tokens(b);
  if (!x.length && !y.length) return fold(a) === fold(b) ? 1 : 0;
  const used = new Set();
  let n = 0;
  for (const t of x) {
    const hit = y.findIndex((u, i) => !used.has(i) && (u === t || similar(t, u)));
    if (hit >= 0) { used.add(hit); n++; }
  }
  return n / Math.max(1, x.length + y.length - n);
};

function grams(w) {
  const m = fold(w).replace(/1000\s*g(r)?/, '1 kg').match(/(\d+(?:\.\d+)?)\s*(kg|gr|g)\b/);
  if (!m) return '';
  return String(Math.round(Number(m[1]) * (m[2] === 'kg' ? 1000 : 1)));
}
function colorKey(c) {
  const t = fold(c).split(' ')[0];
  return COLORS[t] || t;
}

function packagingOf(p) {
  const t = titleRules(p.name);
  if (/\brefill\b/.test(t)) return 'refill';
  if (/\bspool\b/.test(t)) return 'spool';
  const raw = fold(p.packaging || '');
  if (raw === 'refill' || raw === 'spool') return raw;
  return '';
}

function colorOf(p) {
  if (p.color) return colorKey(p.color);
  const parts = titleRules(p.name).split(' ').filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i--) {
    if (COLORS[parts[i]]) return COLORS[parts[i]];
  }
  return '';
}

function diameterOf(p) {
  const named = titleRules(p.name).match(/\b(175mm|285mm|300mm)\b/);
  return named ? named[1].replace('mm', '') : '';
}

// Axes (Part B of the reference): brand? + modelCore + sizeTier + comboAxis + feederGen +
// laserWatts + kitForm + technology. Every axis is identity: if two titles differ on any of
// them they are different products, whatever the rest of the words say.
function axesFromTitle(title, hint) {
  const brand = idx.brandOf(title) || ((hint && hint.brandId) ? { id: hint.brandId, alias: '' } : null);
  const brandId = brand && brand.id;
  const model = idx.modelOf(brandId, title);
  const feeder = idx.feederOf(brandId, title);
  const comboWord = idx.wordHit(title, idx.COMBO_WORDS);
  // "AMS'siz" / "without AMS" is an explicit bare printer; "AMS ile" folds to combo in titleRules.
  const bareWord = idx.wordHit(title, idx.BARE_WORDS);
  return {
    brand: brand ? brandId : '',
    // From the reference table when it knows the maker, otherwise from the title itself.
    modelCore: model ? model.id : idx.genericModelCore(title, brand && brand.alias),
    modelAlias: model ? model.alias : '',
    sizeTier: idx.sizeTierOf(title),
    // An unnamed "Combo" still means the feeder that brand ships with, which is what keeps
    // "Kobra S1 Combo" (ACE Pro) apart from "Kobra S1 ACE 2 Pro Combo" in the identity id.
    feederGen: feeder ? feeder.id : (comboWord && idx.DEFAULT_FEEDER[brandId] ? idx.DEFAULT_FEEDER[brandId] : ''),
    // ...but only a *named* generation is evidence: "AMS ile" says bundle, not which one.
    feederNamed: !!feeder,
    comboAxis: bareWord ? 'bare' : comboWord || feeder ? 'combo' : '',
    laserWatts: idx.laserWattsOf(title),
    kitForm: idx.kitFormOf(title),
    technology: idx.technologyOf(brandId, title),
    // A core two unknown brands share ("i3", "mega") must not merge on its own.
    genericCore: !brandId && !!model && idx.GENERIC_CORES.has(model.id)
  };
}

// A wattage figure only makes sense for a laser module, so "H2C 10 Watt Combo" describes the same
// machine as "H2C Combo Laser 10 Watt" even though only one of the two says "Laser". Without this the
// two derive different `technology` values, Magellan reports a hard conflict, and one product becomes
// two catalogue rows. Written without backslash escapes on purpose: this repo has silently written
// control characters instead of regex escapes three times.
function isLaserWattage(name) {
  return /[0-9]+[ ]*(w|watt)/i.test(String(name || ""));
}

// Wattage in a printer title means the laser module. The old check required the English word
// "laser", so every Turkish title ("Lazer 10W", "10 Watt") extracted no wattage at all and 10W vs 40W
// fell into the gray band instead of hard-splitting. Written without backslash escapes on purpose.
function laserWattsFromName(name) {
  const m = String(name || "").toLowerCase().match(/([0-9]+)[ ]*(w|watt)/);
  return m ? m[1] : "";
}

function identity(p) {
  const classified = p.kind === 'filament' ? classifyFilament({ name: p.name, brand: p.brand || '' }) : null;
  const polymer = fold(p.polymer || '') && fold(p.polymer) !== 'other'
    ? fold(p.polymer)
    : (classified && classified.polymer && classified.polymer !== 'other' ? fold(classified.polymer) : '');
  let variant = fold(p.variant || '');
  if (!variant || variant === 'standard') {
    variant = classified && classified.variant && classified.variant !== 'standard' ? fold(classified.variant) : '';
  }
  if (variant === 'standard') variant = '';
  const n = titleRules((p.name || '') + ' ' + (p.variant || ''));
  const amsWord = /\bams\b/.test(n);
  // Only a named generation is an axis: "AMS 2 Pro" is a different unit from a plain AMS,
  // while a bare "AMS" is what "Combo" already means on these printers.
  const amsGen = (n.match(/\bams\s*(2|ht|lite|pro)\b/) || ['', ''])[1];
  const ams = amsGen ? 'ams ' + amsGen : '';
  // The reference table knows the model and its feeder generation; the regex above knows AMS.
  const axes = axesFromTitle((p.name || '') + ' ' + (p.variant || ''), { brandId: foldBrand(p.brand) });
  const combo = /\bcombo\b/.test(n) || amsWord || axes.comboAxis === 'combo';
  // Feeder words look like model variants ("AMS 2 Pro", "ACE 2 Pro", "AMS Lite"). They belong
  // to the feeder, so they must not also read as a "Pro" or "Lite" printer.
  const nNoFeeder = n
    .replace(/\bams\s*(?:2\s*)?(?:pro|lite|ht)\b/g, ' ')
    .replace(/\bace\s*(?:2\s*)?pro\b/g, ' ')
    .replace(/\bace\b/g, ' ')
    .replace(/\bqidi\s*box\b|\bcfs(?:-?\w+)?\b|\bcanvas\b|\bifs\b|\bmmu\w*\b|\bindx\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return {
    kind: p.kind || '',
    brand: foldBrand(p.brand) || axes.brand || fold(p.brand),
    // Only a brand the reference knows becomes part of a stable identity id; an unlisted maker
    // keeps its name for display, while the identity is built from the model tokens instead.
    brandId: foldBrand(p.brand) || axes.brand || '',
    polymer,
    variant,
    color: colorOf(p) || colorKey((classified && classified.color) || ''),
    weight: grams(p.weight || '') || grams(p.name || ''),
    diameter: diameterOf(p),
    packaging: packagingOf(p),
    // "Combo", "üniteli" and an AMS mention all say the same thing: printer + AMS bundle.
    // Shops are inconsistent about which one they write, and one shop stating the bundle
    // while another names it is not a difference between two products.
    combo,
    comboAxis: axes.comboAxis || (combo ? 'combo' : 'bare'),
    variantTag: variantTag(nNoFeeder),
    ams,
    mini: /\bmini\b/.test(n),
    laserW: laserWattsFromName(p.name) || (/(lazer|laser)/.test(n) ? 'laser' : ''),
    // Axes from the catalog index (see axesFromTitle).
    modelCore: axes.modelCore,
    sizeTier: axes.sizeTier,
    feederGen: axes.feederGen || ams,
    feederNamed: axes.feederNamed === true,
    technology: (axes.laserWatts || isLaserWattage(p.name)) ? 'laser' : axes.technology,
    kitForm: axes.kitForm,
    laserWatts: axes.laserWatts,
    genericCore: axes.genericCore
  };
}

// A brand written many ways ("Bambu Lab", "BambuLab", "bambu-lab") is one brand.
function foldBrand(brand) {
  const hit = idx.brandOf(brand);
  return hit ? hit.id : '';
}

// The axes of a product plus its stable identity id ("bambu/p1s/combo/ams-2-pro"), which is
// what the Gemma context offers as allowedIdentities and what a merge is recorded against.
function axesOf(p) {
  const id = identity(p);
  return { ...id, identityId: idx.identityId(id) };
}

function normalizePrinterTitle(title) {
  return titleRules(title);
}

function conflicts(a, b) {
  const out = [];
  if (a.kind && b.kind && a.kind !== b.kind) out.push('kind');
  if (a.polymer && b.polymer && a.polymer !== b.polymer) out.push('polymer');
  if (a.variant && b.variant && a.variant !== b.variant && a.variant !== 'standard' && b.variant !== 'standard') out.push('variant');
  if (a.color && b.color && a.color !== b.color) out.push('color');
  if (a.weight && b.weight && a.weight !== b.weight) out.push('weight');
  if (a.diameter && b.diameter && a.diameter !== b.diameter) out.push('diameter');
  if (a.packaging && b.packaging && a.packaging !== b.packaging) out.push('packaging');
  if (a.combo !== b.combo) out.push('combo');
  if ((a.ams || '') !== (b.ams || '')) out.push('ams');
  if (a.mini !== b.mini) out.push('mini');
  // "K2" and "K2 Plus" are different machines, never the same one worded differently.
  if ((a.variantTag || '') !== (b.variantTag || '')) out.push('variant');
  // A laser wattage is a real configuration, so one side naming it and the other not is a
  // difference, not an omission: "H2D Laser Full Combo 10W" is not the plain "H2D Combo".
  // A bare "laser" mention without watts stays a marketing word and does not split.
  if (a.laserW !== b.laserW && (/\d/.test(a.laserW || '') || /\d/.test(b.laserW || ''))) out.push('laser');
  // Model core from the reference table: "K2" vs "K2 Plus", "A1" vs "A1 mini".
  if (a.modelCore && b.modelCore && a.modelCore !== b.modelCore) out.push('model');
  // A feeder generation is a different machine configuration: AMS Lite ≠ AMS 2 Pro, CFS ≠ CFS-C,
  // ACE Pro ≠ ACE 2 Pro. Only compared within a brand, so Sovol's "ACE" never collides.
  if (a.feederGen && b.feederGen && a.feederGen !== b.feederGen) out.push('feeder');
  // Kit, assembled and bare frame are different sellable products.
  if (a.kitForm && b.kitForm && a.kitForm !== b.kitForm) out.push('kit');
  // Never group across technologies, even when one shop bundles two machines in one title.
  if (a.technology && b.technology && a.technology !== b.technology) out.push('technology');
  if (a.sizeTier && b.sizeTier && a.sizeTier !== b.sizeTier) out.push('size');
  // Same generic core across two unknown brands: hold, never auto-merge (possible white-label).
  if (a.genericCore && b.genericCore && (a.brand || '') !== (b.brand || '')) out.push('unknown-brand');
  return out;
}

function gaps(a, b) {
  const keys = a.kind === 'printer' || b.kind === 'printer'
    ? []
    : ['color', 'weight', 'diameter', 'packaging', 'polymer', 'variant'];
  return keys.filter((k) => (a[k] && !b[k]) || (!a[k] && b[k]));
}

function serialize(p) {
  return ['name', 'brand', 'kind', 'polymer', 'variant', 'color', 'weight', 'diameter', 'packaging']
    .filter((k) => p[k])
    .map((k) => 'COL ' + k + ' VAL ' + p[k])
    .join(' ');
}

function taxonomy(p) {
  if (p.kind === 'filament') {
    const c = classifyFilament(p);
    const id = identity(p);
    return {
      category: c.polymer,
      subcategory: c.variant,
      family: c.familyKey,
      polymer: c.polymer,
      variant: c.variant,
      color: id.color || c.color || p.color || '',
      weight: id.weight || c.weight || p.weight || '',
      diameter: id.diameter || '',
      packaging: id.packaging || '',
      aisle: 'filament'
    };
  }
  const n = p.name || '';
  const aisle = /kurutucu|\bdryer\b/i.test(n) ? 'filament-kurutucu'
    : /\bams\b|renk mod/i.test(n) && !/combo|yaz[iı]c[iı]|printer/i.test(n) ? 'renk-modulu'
    : 'fdm';
  return { category: aisle, subcategory: p.brand || '', family: fold((p.brand || '') + ' ' + n), aisle };
}

function titleSubset(a, b) {
  const x = tokens(a);
  const y = tokens(b);
  if (x.length < 2 || y.length < 2) return false;
  const [sm, lg] = x.length <= y.length ? [x, y] : [y, x];
  if (!sm.every((t) => lg.some((u) => u === t || similar(t, u)))) return false;
  // Everything the shorter title says is in the longer one — unless the longer one adds a
  // variant word ("Plus", "Pro"), which means a different model, not the same one padded.
  const extra = lg.filter((t) => !sm.some((u) => u === t || similar(t, u)));
  return !extra.some((t) => VARIANT_WORDS.has(t));
}

// Is this title a DIFFERENT product that merely mentions this one - a knockoff, or a part that fits?
//
// Magellan had no such check, so it merged "Bambu Lab A1 tarzi" (A1-style, a clone) and "A1 nozzle
// yedek parca" (a spare nozzle) into the genuine A1 row. That is the most expensive mistake the
// matcher can make: it welds two different products into one.
//
// The word list is deliberately split the same way lib/compare-to-baseline.js splits it. Strong words
// mean "like/for something else" and always disqualify. "uyumlu"/"uygun"/"compatible" alone do NOT:
// Turkish shops write "Bambu Lab H2S 3D Yazici (AMS uyumlu)" on a genuine printer.
const NOT_THE_PRODUCT_STRONG = /\b(tarzi|benzer|muadil|alternatif|replacement for|for use with)\b/;
// A part noun alone is NOT enough. "Cift Nozul" (dual nozzle) and "AMS 2 Pro" are features of a
// genuine printer, and matching a bare "nozul" blocked real merges and turned gray-band reviews into
// hard creates. A part noun only disqualifies when the listing is FOR or A SPARE of something, which
// is what "icin"/"for"/"yedek"/"spare" signal.
const PART_NOUN = /\b(nozzle|nozul|hotend|hot end|extruder|bowden|plaka|plate|kabin|enclosure|tabla|termistor|thermistor|kayis|filtre)\b/;
const SPARE_MARKER = /\b(yedek|spare|için|icin|for)\b/;
function isNotTheProduct(name) {
  const t = ' ' + String(name || '').toLowerCase()
    .replace(/ı/g, 'i').replace(/İ/g, 'i')
    .replace(/ş/g, 's').replace(/ğ/g, 'g').replace(/ü/g, 'u')
    .replace(/ö/g, 'o').replace(/ç/g, 'c')
    .replace(/[^a-z0-9]+/g, ' ') + ' ';
  if (NOT_THE_PRODUCT_STRONG.test(t)) return true;
  return PART_NOUN.test(t) && SPARE_MARKER.test(t);
}

function decidePair(listing, candidate, visual) {
  // One side is a knockoff or a part that fits the other: never the same product, whatever the
  // titles score. Checked before anything else so no later rule can merge them.
  const notProductA = isNotTheProduct(listing.name);
  const notProductB = isNotTheProduct(candidate.name);
  if (notProductA !== notProductB) {
    return { action: 'create', confidence: 0.9, reason: 'one side is a compatible part or a lookalike', score: 0, candidateId: candidate.id, matchPath: 'magellan', conflict: true };
  }
  const ia = identity(listing);
  const ib = identity(candidate);
  const sim = score(listing.name, candidate.name);
  const clash = conflicts(ia, ib);
  const missing = gaps(ia, ib);
  const v = typeof visual === 'number' && Number.isFinite(visual) ? visual : null;
  if (clash.length) {
    // Hard conflicts never merge: combo / AMS / mini / laser / polymer beat both vision and Gemma.
    return { action: 'create', confidence: 0.92, reason: 'different ' + clash.join(', '), score: sim, candidateId: candidate.id, matchPath: 'magellan', conflict: true };
  }
  if (missing.length) {
    return { action: 'review', confidence: sim, reason: 'unknown ' + missing.join(', '), score: sim, candidateId: candidate.id, matchPath: 'magellan' };
  }
  if (normalizePrinterTitle(listing.name) && normalizePrinterTitle(listing.name) === normalizePrinterTitle(candidate.name)) {
    return { action: 'merge', confidence: 0.99, reason: 'identical title', score: 1, candidateId: candidate.id, matchPath: 'magellan' };
  }
  const printer = listing.kind === 'printer' || candidate.kind === 'printer';
  if (printer && titleSubset(listing.name, candidate.name)) {
    return { action: 'merge', confidence: 0.9, reason: 'magellan title subset', score: Math.max(sim, 0.9), candidateId: candidate.id, matchPath: 'magellan' };
  }
  if (sim >= 0.75) {
    return { action: 'merge', confidence: 0.93, reason: 'magellan same title', score: sim, candidateId: candidate.id, matchPath: 'magellan' };
  }
  if (!printer && sim >= 0.55 && ia.brand && ia.brand === ib.brand) {
    return { action: 'merge', confidence: 0.93, reason: 'magellan same SKU', score: sim, candidateId: candidate.id, matchPath: 'magellan' };
  }
  if (printer && sim >= 0.55 && ia.brand && ia.brand === ib.brand) {
    // A gray title stays a hold no matter how alike the thumbnails look: two different
    // models can share one stock photo, and only a title that is equal after the noise
    // words fold merges on its own (that lands at score 1, well above this band).
    const samePhoto = v !== null && v >= VISUAL_SAME;
    return {
      action: 'review',
      confidence: sim,
      reason: samePhoto ? 'same thumbnail, close titles — confirm one printer' : v !== null && v <= VISUAL_WEAK ? 'near duplicate — thumbnails disagree' : 'extreme gray title band',
      score: sim,
      visual: v,
      nearDupe: true,
      photoMatch: samePhoto,
      candidateId: candidate.id,
      matchPath: samePhoto ? 'magellan+visual' : 'magellan'
    };
  }
  if (sim >= 0.6) {
    return { action: 'review', confidence: sim, reason: 'magellan uncertain', score: sim, visual: v, candidateId: candidate.id, matchPath: 'magellan' };
  }
  if (v !== null && v >= VISUAL_SAME) {
    // Same photo, different model is a real thing: one shop reusing a stock shot.
    return { action: 'review', confidence: sim, reason: 'same thumbnail, different title — suspicious', score: sim, visual: v, nearDupe: true, candidateId: candidate.id, matchPath: 'magellan+visual' };
  }
  return { action: 'create', confidence: 0.8, reason: 'magellan no match', score: sim, candidateId: candidate.id, matchPath: 'magellan' };
}

function rankCandidates(listing, items, visuals) {
  return (items || [])
    .map((p) => ({ item: p, decision: decidePair(listing, p, visuals ? visuals[p.id] : undefined) }))
    .sort((a, b) => (b.decision.score || 0) - (a.decision.score || 0));
}

module.exports = { fold, tokens, similar, score, serialize, identity, axesOf, axesFromTitle, decidePair, rankCandidates, taxonomy, normalizePrinterTitle, conflicts, index: idx };
