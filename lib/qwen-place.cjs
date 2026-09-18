const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { fold, score, similar, rankCandidates, taxonomy } = require('./product-match.cjs');
const { toTry } = require('./compare-products.cjs');

function safeListing(x) {
  const u = new URL(x.url);
  if (u.protocol !== 'https:') throw Error('Only HTTPS retailer URLs');
  if (!x.name || !x.brand || !['printer', 'filament'].includes(x.kind) || !Number.isFinite(x.price) || x.price <= 0) throw Error('Incomplete listing evidence');
  return { ...x, url: u.href };
}

const MATCH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['decision', 'matchId', 'confidence', 'reason'],
  properties: {
    decision: { type: 'string' },
    matchId: {},
    confidence: { type: 'number' },
    reason: { type: 'string' }
  }
};

async function gemmaGrayMatch(listing, ranked, signal, dir) {
  const { ask } = require('../scripts/local-qwen.cjs');
  const top = ranked.slice(0, 3).map(({ item: p, decision }) => ({
    id: p.id,
    name: p.name,
    score: decision.score,
    action: decision.action,
    reason: decision.reason,
    conflict: decision.conflict === true
  }));
  if (top.some((c) => c.conflict && c.id)) {
    /* still send; caller blocks merge across conflict ids */
  }
  const g = await ask('match-gray', {
    instruction: 'Decide if the gathered listing is the same physical printer as a candidate. Titles only. Do not use price or stock. Never merge if combo/mini/laser/AMS conflict. JSON only.',
    listing: { name: listing.name, url: listing.url, brand: listing.brand },
    candidates: top
  }, MATCH_SCHEMA, dir, signal, 20000);
  const decision = String(g.decision || 'hold');
  const conf = Number(g.confidence);
  const matchId = g.matchId || null;
  const hit = top.find((c) => c.id === matchId);
  if (decision === 'merge' && hit && hit.conflict) {
    return { action: 'held', reason: 'Gemma cannot override Magellan hard conflict', matchPath: 'gemma-gray', candidateId: matchId };
  }
  if (decision === 'merge' && hit && conf >= 0.8) {
    return { action: 'merge', reason: g.reason || 'gemma-gray merge', confidence: conf, candidateId: matchId, matchPath: 'gemma-gray', rule: 'gemma-gray' };
  }
  if (decision === 'create' && conf >= 0.8) {
    return { action: 'create', reason: g.reason || 'gemma-gray create', confidence: conf, matchPath: 'gemma-gray', rule: 'gemma-gray' };
  }
  return { action: 'held', reason: g.reason || 'gemma-gray hold', matchPath: 'gemma-gray', candidateId: matchId };
}

async function placeListings({ listings, site, catalogFile, apply, emit, runDir, signal, autoLlmMatch }) {
  signal?.throwIfAborted();
  const catalog = JSON.parse(fs.readFileSync(catalogFile, 'utf8'));
  const model = '';
  const audit = [];
  const next = JSON.parse(JSON.stringify(catalog));
  const log = emit || (() => {});
  const askDir = path.join(path.dirname(catalogFile), 'qwen-employee');

  for (const raw of listings) {
    signal?.throwIfAborted();
    let x;
    try { x = safeListing(raw); }
    catch (e) {
      const row = { listing: raw, action: 'held', reason: e.message };
      audit.push(row);
      log({ type: 'place', ...row });
      continue;
    }
    {
      const code = String((x.currency && x.currency.code) || x.currency || 'TRY').toUpperCase();
      if (code && code !== 'TRY' && code !== 'TL') {
        const tryPrice = toTry(x.price, code);
        if (tryPrice) x = { ...x, price: tryPrice, was: x.was ? toTry(x.was, code) || x.was : x.was, currency: 'TRY' };
      }
    }

    const tax = taxonomy(x);
    x = { ...x, ...tax };
    const shelf = x.kind === 'filament' ? 'filaments' : 'products';
    const list = next[shelf] || [];
    const both = [...(next.products || []), ...(next.filaments || [])];
    const existing = both.find(p => (p.offers || []).some(o => o.url === x.url));
    const brand = fold(x.brand);
    const sameBrand = (p) => {
      const pb = fold(p.brand);
      return pb === brand || (' ' + fold(p.name) + ' ').includes(' ' + brand + ' ') || (pb && brand && similar(pb.replace(/ /g, ''), brand.replace(/ /g, '')));
    };
    const pool = list.filter(p => p.id !== existing?.id && (sameBrand(p) || score(x.name, p.name) >= 0.4 || fold(p.name) === fold(x.name)));
    const ranked = rankCandidates(x, pool);
    const best = ranked[0];
    const candidates = ranked.slice(0, 8).map(({ item: p }) => (
      x.kind === 'filament'
        ? { candidateId: p.id, name: p.name, brand: p.brand, polymer: p.polymer || '', variant: p.variant || '', color: p.color || '', weight: p.weight || '', diameter: p.diameter || '', packaging: p.packaging || '' }
        : { candidateId: p.id, name: p.name, brand: p.brand, model: p.model || '', configuration: p.configuration || '' }
    ));

    let d = null;
    if (best && best.decision.action === 'merge') {
      d = { ...best.decision, ...tax, rule: 'magellan', matchPath: 'magellan' };
      log({ type: 'log', stage: 'compare', text: 'Magellan merge ' + x.name + ' → ' + best.item.name + ' (' + best.decision.reason + ')' });
    } else if (!ranked.some(r => r.decision.action === 'merge' || r.decision.action === 'review')) {
      d = { action: 'create', confidence: 0.88, reason: (best && best.decision.reason) || 'no catalog match', ...tax, rule: 'magellan', matchPath: 'magellan' };
      log({ type: 'log', stage: 'compare', text: 'Magellan create ' + x.name + (best ? ' — ' + best.decision.reason : '') });
    } else if (autoLlmMatch === true && best && best.decision.action === 'review' && !best.decision.conflict) {
      try {
        d = { ...tax, ...(await gemmaGrayMatch(x, ranked, signal, askDir)) };
        log({ type: 'log', stage: 'compare', text: 'Gemma-gray ' + (d.action || 'hold') + ' ' + x.name + (d.reason ? ' — ' + d.reason : '') });
      } catch (err) {
        const row = { listing: x, action: 'held', reason: 'Gemma gray match failed: ' + err.message, matchPath: 'gemma-gray', candidateId: best && best.item.id };
        audit.push(row);
        log({ type: 'place', ...row });
        continue;
      }
      if (d.action === 'held' || d.action === 'review') {
        const row = { listing: x, ...d, action: 'held', candidateId: d.candidateId || (best && best.item.id) };
        audit.push(row);
        log({ type: 'place', ...row });
        continue;
      }
    } else {
      const row = { listing: x, action: 'held', reason: 'Ambiguous deterministic title match', matchPath: 'magellan', candidateId: best && best.item.id };
      audit.push(row);
      log({ type: 'place', ...row });
      continue;
    }

    if (x.catalogTaxonomy) d = { ...d, ...x.catalogTaxonomy };
    if (existing && d.action === 'create' && d.confidence >= 0.8) {
      const at = existing.offers.findIndex(o => o.url === x.url);
      existing.offers[at] = { ...existing.offers[at], store: site, price: x.price, was: x.was && x.was > x.price ? x.was : existing.offers[at].was, url: x.url, image: x.image || '', vatIncluded: true, vatAdded: x.vatAdded === true, stockStatus: x.stockStatus, stockQuantity: x.stockQuantity, stockVerified: true, stockCheckedAt: x.stockCheckedAt, stockPolicyVersion: 2, stockCheckOnPreview: true };
      existing.offers.sort((a, b) => a.price - b.price);
      if (x.kind === 'filament') Object.assign(existing, { polymer: d.polymer, variant: d.variant, color: d.color, weight: d.weight, diameter: d.diameter, packaging: d.packaging, family: d.family });
      const row = { listing: x, ...d, action: 'updated', candidateId: existing.id, candidateName: existing.name, shelf: x.kind, rule: 'exact-url-with-deterministic-taxonomy', compared: (existing.offers || []).filter(o => o.url !== x.url && o.store).map(o => ({ store: o.store, price: o.price, url: o.url, name: existing.name })) };
      audit.push(row);
      log({ type: 'place', ...row });
      continue;
    }
    const target = d.candidateId && candidates.find(c => c.candidateId === d.candidateId);
    if (d.action === 'merge' && (!target || d.confidence < 0.7)) {
      const row = { listing: x, ...d, action: 'held', reason: 'Invalid or low-confidence merge' };
      audit.push(row);
      log({ type: 'place', ...row });
      continue;
    }
    if (d.action !== 'merge' && (d.action === 'review' || d.confidence < 0.8)) {
      const row = { listing: x, ...d, action: 'held' };
      audit.push(row);
      log({ type: 'place', ...row });
      continue;
    }

    const offer = { store: site, price: x.price, was: x.was && x.was > x.price ? x.was : undefined, url: x.url, image: x.image || '', vatIncluded: true, vatAdded: x.vatAdded === true, stockStatus: x.stockStatus, stockQuantity: x.stockQuantity, stockVerified: true, stockCheckedAt: x.stockCheckedAt, stockPolicyVersion: 2, stockCheckOnPreview: true };
    const shopsOf = (p) => (p.offers || []).filter(o => o.url !== x.url && o.store).map(o => ({ store: o.store, price: o.price, url: o.url, name: p.name }));
    if (d.action === 'merge') {
      const p = both.find(row => row.id === d.candidateId);
      if (!p) {
        const row = { listing: x, ...d, action: 'held', reason: 'Merge target missing from catalog' };
        audit.push(row);
        log({ type: 'place', ...row });
        continue;
      }
      if (existing && existing !== p) {
        p.offers = [...new Map([...(existing.offers || []), ...(p.offers || [])].map(o => [o.url, o])).values()];
        p.mergedIds = [...new Set([...(p.mergedIds || []), existing.id, ...(existing.mergedIds || [])])];
        const home = (next.products || []).includes(existing) ? next.products : next.filaments;
        const i = home.indexOf(existing);
        if (i >= 0) home.splice(i, 1);
      }
      const at = p.offers.findIndex(o => o.url === x.url);
      if (at >= 0) p.offers[at] = offer; else p.offers.push(offer);
      p.offers.sort((a, b) => a.price - b.price);
      if (x.kind === 'filament') Object.assign(p, { polymer: d.polymer, variant: d.variant, color: d.color, weight: d.weight, diameter: d.diameter, packaging: d.packaging, family: d.family });
      const row = { listing: x, ...d, action: 'merge', candidateName: p.name, shelf: x.kind, compared: shopsOf(p) };
      audit.push(row);
      log({ type: 'place', ...row });
    } else {
      const id = 'qwen-' + crypto.createHash('sha256').update(x.url).digest('hex').slice(0, 16);
      list.push({ ...x, polymer: d.polymer, variant: d.variant, color: d.color, weight: d.weight, diameter: d.diameter, packaging: d.packaging, family: d.family, category: d.category, subcategory: d.subcategory, id, sourceId: site, source: site, aisle: d.aisle || (x.kind === 'printer' ? 'fdm' : 'filament'), unit: x.brand, currency: { code: 'TRY', symbol: 'TL', position: 'after', decimals: 2 }, offers: [offer] });
      const similar = candidates.slice(0, 6).flatMap(c => {
        const p = list.find(row => row.id === c.candidateId);
        return p ? shopsOf(p).slice(0, 2) : [];
      });
      const row = { listing: x, ...d, action: 'create', candidateId: id, shelf: x.kind, compared: similar };
      audit.push(row);
      log({ type: 'place', ...row });
    }
  }

  signal?.throwIfAborted();
  next.productCount = next.products.length;
  next.filamentCount = next.filaments.length;
  next.savedAt = new Date().toISOString();
  const run = {
    model, site, input: listings.length,
    merged: audit.filter(x => x.action === 'merge').length,
    created: audit.filter(x => x.action === 'create').length,
    updated: audit.filter(x => x.action === 'updated').length,
    held: audit.filter(x => x.action === 'held').length,
    completedAt: next.savedAt
  };
  fs.mkdirSync(askDir, { recursive: true });
  fs.writeFileSync(path.join(askDir, 'last-audit.json'), JSON.stringify({ run, audit }, null, 2));
  fs.writeFileSync(path.join(askDir, 'catalog.candidate.json'), JSON.stringify(next, null, 2));
  if (runDir) {
    fs.writeFileSync(path.join(runDir, 'placement.json'), JSON.stringify({ run, audit }, null, 2));
  }
  if (apply) fs.writeFileSync(catalogFile, JSON.stringify(next, null, 2));
  return { run, audit, candidateFile: path.join(askDir, 'catalog.candidate.json'), applied: apply === true };
}

module.exports = { placeListings, score, similar, fold };
