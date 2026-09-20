// Catalog-guided Gemma.
//
// Magellan runs first and settles everything it can. When it cannot, the model is asked exactly
// one question — "which of these identities is it?" — with a *closed* list built from our own
// catalog, and the code enforces the answer:
//
//   * an identityId that was not offered is a hallucination and becomes a hold;
//   * an answer that would cross a hard conflict (bare vs combo, AMS Lite vs AMS 2 Pro,
//     10W vs 40W laser) becomes a hold;
//   * low confidence, bad JSON or a timeout become a hold.
//
// A hold is the honest outcome: it keeps the listing in front of a human instead of guessing.
// Nothing here can merge two things the reference table says are different products.

const matcher = require('./product-match.cjs');
const idx = require('./catalog-index.cjs');

const DEFAULT_MIN_CONFIDENCE = 0.75;
const MAX_ALLOWED = 8;
const MIN_ALLOWED = 3;

const axisWords = (axes) => ({
  brand: axes.brand || 'unknown',
  model: axes.modelCore || '',
  size: axes.sizeTier || '',
  combo: axes.comboAxis === 'combo' ? 'combo' : 'bare',
  feeder: axes.feederGen || '',
  feederNamed: axes.feederNamed === true,
  laser: axes.laserWatts || '',
  kit: axes.kitForm || '',
  technology: axes.technology || 'fdm'
});

// Human-readable differences, for the prompt and for the report. These are exactly the rules
// the deterministic matcher already refuses to cross.
function hardConflictsBetween(listingAxes, candidateAxes) {
  const a = axisWords(listingAxes);
  const b = axisWords(candidateAxes);
  const out = [];
  if (a.combo !== b.combo) out.push('bare≠combo');
  // The effective generation on both sides, implied defaults included: the reference lists
  // "P1S Combo" (AMS) and "P1S AMS 2 Pro Combo" as different SKUs, so an unnamed bundle may not
  // silently land on a named generation. The model can still *choose* the configuration that
  // matches (both are offered in allowedIdentities) — it just cannot cross this line.
  if (a.feeder && b.feeder && a.feeder !== b.feeder) out.push('feeder ' + a.feeder + '≠' + b.feeder);
  if (a.laser && b.laser && a.laser !== b.laser) out.push('laser ' + a.laser + 'W≠' + b.laser + 'W');
  if (a.model && b.model && a.model !== b.model) out.push('model ' + a.model + '≠' + b.model);
  if (a.technology !== b.technology) out.push('technology ' + a.technology + '≠' + b.technology);
  if (a.size && b.size && a.size !== b.size) out.push('size ' + a.size + '≠' + b.size);
  if (a.kit && b.kit && a.kit !== b.kit) out.push('kit ' + a.kit + '≠' + b.kit);
  if (a.brand !== b.brand && a.brand !== 'unknown' && b.brand !== 'unknown') out.push('brand ' + a.brand + '≠' + b.brand);
  return out;
}

// Build the closed list of identities the model may choose from. It always contains the
// listing's own axes, plus the best candidates from our catalog, plus — when the model core
// matches a candidate — both the bare and the combo identity of that model, because that is the
// single most common ambiguity and the model may only answer with something we offered.
function buildAllowedIdentities(listingAxes, ranked, opts) {
  const limit = Math.max(MIN_ALLOWED, Math.min(MAX_ALLOWED, Number(opts && opts.limit) || MAX_ALLOWED));
  const entries = [];
  const seen = new Set();
  const push = (entry) => {
    if (!entry.identityId || seen.has(entry.identityId)) return;
    seen.add(entry.identityId);
    entries.push(entry);
  };

  for (const { item, decision } of ranked || []) {
    const axes = matcher.axesOf(item);
    push({
      identityId: axes.identityId,
      officialLabel: item.name,
      rowId: item.id,
      axes: axisWords(axes),
      whyCandidate: decision.reason || 'magellan candidate',
      score: Math.round((decision.score || 0) * 100) / 100,
      conflict: decision.conflict === true
    });
    // The same model as a bare printer or as a bundle: both are legitimate answers.
    const core = axes.modelCore;
    if (core && core === listingAxes.modelCore) {
      for (const comboAxis of ['bare', 'combo']) {
        if (comboAxis === axes.comboAxis) continue;
        const twin = { ...axes, comboAxis };
        if (comboAxis === 'bare') twin.feederGen = '';
        else if (!twin.feederGen) twin.feederGen = idx.DEFAULT_FEEDER[axes.brand] || '';
        push({
          identityId: idx.identityId(twin),
          officialLabel: item.name + (comboAxis === 'combo' ? ' (Combo)' : ' (Bare)'),
          // This is a *configuration* of the model, not a conflicting candidate: it carries no
          // row to merge onto (rowId null) and must never inherit the candidate's conflict flag,
          // or the listing's own identity would be shadowed by its own twin.
          rowId: null,
          kind: 'configuration',
          axes: axisWords(twin),
          whyCandidate: 'same model, ' + comboAxis + ' configuration',
          score: Math.round((decision.score || 0) * 100) / 100,
          conflict: false
        });
      }
    }
  }

  // The listing's own identity last: it is what "create" means.
  push({
    identityId: idx.identityId(listingAxes),
    officialLabel: '(new) ' + (opts && opts.name ? opts.name : 'gathered listing'),
    rowId: null,
    axes: axisWords(listingAxes),
    whyCandidate: 'the listing itself, as parsed',
    score: 1,
    conflict: false
  });

  return entries.slice(0, limit);
}

function catalogHints(listingAxes) {
  const brandModels = idx.MODELS[listingAxes.brand] || {};
  const aliases = Object.keys(brandModels);
  const near = listingAxes.modelAlias
    ? aliases.filter((a) => a[0] === listingAxes.modelAlias[0]).slice(0, 8)
    : aliases.slice(0, 8);
  return {
    matchedBrand: listingAxes.brand || 'unknown',
    officialModelsNearby: near,
    officialPackTokens: Object.keys(idx.FEEDERS[listingAxes.brand] || {}),
    knownComboWords: idx.COMBO_WORDS,
    noiseIgnored: idx.NOISE.slice(0, 12)
  };
}

function buildGemmaContext(listing, ranked, opts = {}) {
  const listingAxes = matcher.axesOf({ name: listing.name, brand: listing.brand || '', kind: listing.kind || 'printer', variant: listing.variant || '' });
  const allowed = buildAllowedIdentities(listingAxes, ranked, { name: listing.name, limit: opts.limit });
  const conflicts = [];
  for (const { item } of ranked || []) {
    const other = matcher.axesOf(item);
    for (const c of hardConflictsBetween(listingAxes, other)) if (!conflicts.includes(c)) conflicts.push(c);
  }
  return {
    gathered: {
      title: listing.name,
      shop: listing.store || listing.site || '',
      url: listing.url || '',
      imageUrl: listing.image || '',
      parsedAxes: axisWords(listingAxes)
    },
    allowedIdentities: allowed,
    hardConflicts: conflicts,
    visualScores: (opts.visualScores || []).filter(Boolean),
    catalogHints: catalogHints(listingAxes),
    listingAxes,
    listingIdentity: idx.identityId(listingAxes)
  };
}

const PROMPT = [
  'You are a product-identity judge for 3D printers and lasers.',
  'You may ONLY answer with one of the allowedIdentities you are given, or "create" (a genuinely new product) or "hold" (not sure).',
  'Obey hardConflicts absolutely: if the listing differs from an identity on a listed conflict, you may not choose it.',
  'Catalog rows are ground truth for official names and packs. Noise words (buffer, hediyeli, 16 renk, kargo, "3D Yazıcı") are not identity.',
  'Answer with JSON only: {"decision":"merge|create|hold","identityId":string|null,"confidence":0-1,"reason":"short"}'
].join(' ');

const SCHEMA = {
  type: 'object',
  properties: {
    decision: { type: 'string' },
    identityId: { type: 'string' },
    confidence: { type: 'number' },
    reason: { type: 'string' }
  }
};

// Ask the local model, then enforce. `ask` is injectable so tests never touch a model.
async function gemmaDecide(context, opts = {}) {
  const ask = opts.ask || require('../scripts/local-qwen.cjs').ask;
  const timeoutMs = Number(opts.timeoutMs) || 20000;
  const payload = {
    instruction: opts.instruction || PROMPT,
    gathered: context.gathered,
    allowedIdentities: context.allowedIdentities.map((e) => ({
      identityId: e.identityId,
      officialLabel: e.officialLabel,
      axes: e.axes,
      whyCandidate: e.whyCandidate
    })),
    hardConflicts: context.hardConflicts,
    visualScores: context.visualScores,
    catalogHints: context.catalogHints
  };
  let raw;
  try {
    raw = await ask('match-catalog-guided', payload, SCHEMA, opts.dir, opts.signal, timeoutMs);
  } catch (err) {
    return {
      action: 'held',
      reason: 'catalog-guided Gemma unavailable (' + String((err && err.message) || err).slice(0, 60) + ')',
      matchPath: 'gemma-catalog-guided',
      identityId: null,
      rejected: 'timeout'
    };
  }
  return enforceDecision(raw, context, opts);
}

// The enforcement rules, applied to whatever the model said.
function enforceDecision(raw, context, opts = {}) {
  const min = Number(opts.minConfidence) || DEFAULT_MIN_CONFIDENCE;
  const allowed = context.allowedIdentities || [];
  const byId = new Map(allowed.map((e) => [e.identityId, e]));
  const said = String((raw && raw.decision) || '').trim().toLowerCase();
  const decision = /^(merge|match|same|duplicate|dupe|yes|true)$/.test(said) ? 'merge'
    : /^(create|new|different|other|no|false)$/.test(said) ? 'create'
    : 'hold';
  const confidence = Number(raw && raw.confidence);
  const identityId = raw && raw.identityId ? String(raw.identityId) : '';
  const reason = String((raw && raw.reason) || '').slice(0, 140);
  const base = { matchPath: 'gemma-catalog-guided', identityId: identityId || null, confidence: Number.isFinite(confidence) ? confidence : 0 };

  if (decision === 'merge') {
    const hit = byId.get(identityId);
    // An id we never offered is a hallucination, however confident the answer sounded.
    if (!hit) return { ...base, action: 'held', reason: 'rejected: identityId was not among the allowed identities', rejected: 'hallucinated-id' };
    if (hit.conflict) return { ...base, action: 'held', reason: 'rejected: that identity is a hard conflict', rejected: 'conflict' };
    if (!Number.isFinite(confidence) || confidence < min) return { ...base, action: 'held', reason: 'rejected: confidence ' + (Number.isFinite(confidence) ? confidence : 'missing') + ' below ' + min, rejected: 'low-confidence' };
    if (!hit.rowId) return { ...base, action: 'held', reason: 'rejected: no catalog row for that identity', rejected: 'no-row' };
    return { ...base, action: 'merge', candidateId: hit.rowId, reason: reason || 'catalog-guided merge', rule: 'gemma-catalog-guided' };
  }
  if (decision === 'create') {
    if (!Number.isFinite(confidence) || confidence < min) return { ...base, action: 'held', reason: 'rejected: confidence below ' + min, rejected: 'low-confidence' };
    return { ...base, action: 'create', reason: reason || 'catalog-guided create', rule: 'gemma-catalog-guided' };
  }
  return { ...base, action: 'held', reason: reason || 'catalog-guided hold', rejected: 'hold' };
}

module.exports = {
  buildGemmaContext,
  buildAllowedIdentities,
  hardConflictsBetween,
  gemmaDecide,
  enforceDecision,
  PROMPT,
  SCHEMA,
  DEFAULT_MIN_CONFIDENCE
};
