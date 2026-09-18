const { classifyFilament } = require('../api/filament-classify');

const STOP = new Set(['3d', 'printer', 'yazici', 'filament', 'fiyat', 'inceleme', 'stoktan', 'car', 'vehicle', 'urun', 'product', 'cihaz', 'model', 'vs', 've', 'ile', 'the', 'and', 'for', 'of', 'with', 'makine', 'fdm', 'yeni', 'versiyon', 'outlet', 'bundle', 'hediyeli', 'indirimli', 'kampanya']);
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
  return {
    kind: p.kind || '',
    brand: fold(p.brand),
    polymer,
    variant,
    color: colorOf(p) || colorKey((classified && classified.color) || ''),
    weight: grams(p.weight || '') || grams(p.name || ''),
    diameter: diameterOf(p),
    packaging: packagingOf(p),
    combo: /\bcombo\b/.test(n),
    ams: (n.match(/\bams(?:\s*(?:2|ht|lite|pro))?\b/) || [''])[0],
    mini: /\bmini\b/.test(n),
    laserW: (n.match(/\b(\d+)\s*w\b/) && /\blaser\b/.test(n)) ? n.match(/\b(\d+)\s*w\b/)[1] : (/\blaser\b/.test(n) ? 'laser' : '')
  };
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
  if (a.laserW && b.laserW && a.laserW !== b.laserW) out.push('laser');
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
  return sm.every((t) => lg.some((u) => u === t || similar(t, u)));
}

function decidePair(listing, candidate) {
  const ia = identity(listing);
  const ib = identity(candidate);
  const sim = score(listing.name, candidate.name);
  const clash = conflicts(ia, ib);
  const missing = gaps(ia, ib);
  if (clash.length) {
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
    return { action: 'review', confidence: sim, reason: 'extreme gray title band', score: sim, candidateId: candidate.id, matchPath: 'magellan' };
  }
  if (sim >= 0.6) {
    return { action: 'review', confidence: sim, reason: 'magellan uncertain', score: sim, candidateId: candidate.id, matchPath: 'magellan' };
  }
  return { action: 'create', confidence: 0.8, reason: 'magellan no match', score: sim, candidateId: candidate.id, matchPath: 'magellan' };
}

function rankCandidates(listing, items) {
  return (items || [])
    .map((p) => ({ item: p, decision: decidePair(listing, p) }))
    .sort((a, b) => (b.decision.score || 0) - (a.decision.score || 0));
}

module.exports = { fold, tokens, similar, score, serialize, identity, decidePair, rankCandidates, taxonomy, normalizePrinterTitle, conflicts };
