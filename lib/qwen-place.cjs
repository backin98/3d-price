const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { fold, score, similar, rankCandidates, taxonomy, axesOf, conflicts, decidePair } = require('./product-match.cjs');
const matcher = { axesOf };
const { toTry } = require('./compare-products.cjs');

// The confirmed catalog: data/baseline-catalog.json, loaded once, lazily, and only if it is there.
//
// The important property is what happens when it is NOT there. A missing or unreadable baseline
// must not turn into "hold every printer" — that would stop shop runs dead the moment the file was
// deleted. So availability is asked for explicitly, and an unavailable baseline means the gate does
// not fire at all and placement behaves exactly as it did before it existed.
let _baselineIndex = null;
let _baselineLoaded = false;

function baselineReady() {
  if (!_baselineLoaded) {
    _baselineLoaded = true;
    try {
      const lib = require('./baseline-catalog.js');
      const rows = lib.loadBaseline();
      _baselineIndex = rows.length ? lib.createCatalogIndex(rows, { locale: 'tr' }) : null;
    } catch (_) {
      _baselineIndex = null;
    }
  }
  return !!_baselineIndex;
}

// The verdict for one listing against the confirmed catalog, or null when unavailable. Runs on the
// normalized title, never on raw equality: "BambuLab P1S AMS'li" and "Bambu Lab P1S Combo" are the
// same confirmed identity and must reach the same row.
function confirmedVerdict(listing) {
  if (!baselineReady()) return null;
  try {
    const { compareScrapedToBaseline } = require('./compare-to-baseline.js');
    return compareScrapedToBaseline(
      { name: listing.name, brand: listing.brand, kind: listing.kind },
      _baselineIndex,
      { locale: 'tr' }
    );
  } catch (_) {
    return null;
  }
}

function safeListing(x) {
  const u = new URL(x.url);
  if (u.protocol !== 'https:') throw Error('Only HTTPS retailer URLs');
  if (!x.name || !x.brand || !['printer', 'filament'].includes(x.kind) || !Number.isFinite(x.price) || x.price <= 0) throw Error('Incomplete listing evidence');
  return { ...x, url: u.href };
}

// Laya only scores the closed candidate list selected by Magellan. The same deterministic
// conflict gate still owns the final decision; the trained head cannot join incompatible axes.
async function layaPick(listing, candidates, opts = {}) {
  const onShelf = (candidates || []).filter((p) => p && p.id && !(p.offers || []).some((o) => o.url === listing.url));
  const normalized = { ...listing, kind: listing.kind === 'filament' ? 'filament' : 'printer' };
  const listingBrand = axesOf(normalized).brandId || fold(normalized.brand);
  const relevant = listingBrand
    ? onShelf.filter((p) => (axesOf(p).brandId || fold(p.brand)) === listingBrand)
    : onShelf;
  const ranked = rankCandidates(normalized, relevant);
  if (!ranked.length) return { action: 'create', matchId: '', confidence: 0, reason: 'nothing similar in the current catalog', candidates: [] };
  const scorer = opts.scorer || require('./laya-match.cjs').score;
  const response = await scorer(normalized.name, ranked.map(({ item }) => ({ id: item.id, name: item.name })), { signal: opts.signal });
  const scores = new Map((response.matches || []).map((m) => [m.id, Number(m.score) || 0]));
  const ordered = ranked.slice().sort((a, b) => (scores.get(b.item.id) || 0) - (scores.get(a.item.id) || 0));
  const shown = ordered.map(({ item, decision }) => ({ id: item.id, name: item.name, score: scores.get(item.id) || 0, conflict: decision.conflict === true }));
  const hit = ordered.find(({ decision }) => !decision.conflict);
  if (!hit) {
    const first = ordered[0];
    const confidence = scores.get(first.item.id) || 0;
    if (confidence <= 0.1) return { action: 'create', matchId: '', confidence: 1 - confidence, reason: 'baseline-trained Laya found no matching identity', candidates: shown };
    return { action: 'hold', matchId: first.item.id, confidence, reason: 'Laya cannot override Magellan hard conflict', rejected: 'conflict', candidates: shown };
  }
  const confidence = scores.get(hit.item.id) || 0;
  if (hit.decision.action === 'merge' && confidence >= Number(response.threshold || 0.8) * 0.95) return { action: 'merge', matchId: hit.item.id, confidence: Math.max(confidence, hit.decision.confidence || 0), reason: 'Laya candidate confirmed by deterministic identity', candidates: shown };
  if (confidence >= Number(response.threshold || 0.8)) return { action: 'merge', matchId: hit.item.id, confidence, reason: 'baseline-trained Laya match', candidates: shown };
  if (confidence <= 0.1) return { action: 'create', matchId: '', confidence: 1 - confidence, reason: 'baseline-trained Laya found no matching identity', candidates: shown };
  return {
    action: 'hold', matchId: hit.item.id, confidence,
    reason: 'baseline-trained Laya is not confident enough',
    candidates: shown
  };
}

const IMAGE_CLONE_LIMIT = 3; // same photo on more rows than this is a harvest bug, not evidence

function catalogImageCounts(catalog) {
  const counts = new Map();
  for (const p of [...(catalog.products || []), ...(catalog.filaments || [])]) {
    for (const url of [p.image, ...(p.offers || []).map((o) => o.image)]) {
      if (url) counts.set(url, (counts.get(url) || 0) + 1);
    }
  }
  return counts;
}

const imageOf = (p) => p.image || ((p.offers || []).find((o) => o.image) || {}).image || '';

// Local reverse-image search against our own catalog thumbnails. Deterministic
// classical CV — Gemma still never sees a pixel. Any failure (no browser, dead
// CDN, junk URL) degrades to "no visual evidence" and changes nothing.
async function visualScores(listing, ranked, counts, signal) {
  const empty = { scores: {}, details: {}, phash: '' };
  const { fingerprint, visualScore } = require('./image-match.cjs');
  if (!/^https?:/i.test(String(listing.image || ''))) return empty;
  if ((counts.get(listing.image) || 0) > IMAGE_CLONE_LIMIT) return empty;
  const a = await fingerprint(listing.image, { signal });
  if (!a) return empty;
  const scores = {};
  const details = {};
  for (const { item } of ranked) {
    const url = imageOf(item);
    if (!url) continue;
    const s = url === listing.image ? { score: 1, distance: 0, sameUrl: true } : visualScore(a, await fingerprint(url, { signal }));
    if (!s) continue;
    scores[item.id] = s.score;
    details[item.id] = { url, ...s };
  }
  return { scores, details, phash: a.p };
}

// One definition of "a status we could actually read", used by every writer. An unknown status must
// never be reported as verified - that is what let unknown offers set the headline price.
function isResolvedStatus(s) {
  return s === "in_stock" || s === "out_of_stock" || s === "preorder" || s === "dropshipping";
}

async function placeListings({ listings, site, catalogFile, apply, emit, runDir, signal, autoLlmMatch, visualMatch, baselineFile }) {
  const useVision = visualMatch !== false;
  signal?.throwIfAborted();
  const catalog = JSON.parse(fs.readFileSync(catalogFile, 'utf8'));
  const model = '';
  const audit = [];
  const next = JSON.parse(JSON.stringify(catalog));
  const imageCounts = catalogImageCounts(next);
  const log = emit || (() => {});
  const askDir = path.join(path.dirname(catalogFile), 'qwen-employee');
  const boardLib = require('./baseline-board.cjs');
  const humanBoard = boardLib.loadHumanBoard(catalogFile, baselineFile);

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
    const listingKind = x.kind === 'filament' ? 'filament' : 'printer';
    const useHumanBoard = !existing && !!(humanBoard && (humanBoard.items || []).some((it) => boardLib.kindOf(it) === listingKind));
    let d = null;
    if (useHumanBoard) {
      const hit = boardLib.matchListingToBoard(x, humanBoard);
      if (hit && hit.item) {
        const live = boardLib.catalogProductForItem(next, hit.item);
        if (live) {
          d = { ...tax, action: 'merge', candidateId: live.id, confidence: 0.92, reason: 'human baseline: ' + hit.item.name, matchPath: 'human-baseline', baselineId: hit.item.id, rule: 'human-baseline' };
          log({ type: 'log', stage: 'compare', text: 'Baseline merge ' + x.name + ' → ' + live.name });
        } else {
          d = { ...tax, action: 'create', candidateId: hit.item.id, confidence: 0.92, reason: 'human baseline: ' + hit.item.name, matchPath: 'human-baseline', baselineId: hit.item.id, baselineName: hit.item.name, rule: 'human-baseline' };
          log({ type: 'log', stage: 'compare', text: 'Baseline create ' + hit.item.name + ' from ' + x.name });
        }
      } else {
        const row = { listing: x, action: 'held', needsPermission: true, reason: 'No human baseline model for ' + (x.name || x.url), matchPath: 'human-baseline' };
        audit.push(row);
        log({ type: 'place', ...row });
        continue;
      }
    }
    const brand = fold(x.brand);
    const sameBrand = (p) => {
      const pb = fold(p.brand);
      return pb === brand || (' ' + fold(p.name) + ' ').includes(' ' + brand + ' ') || (pb && brand && similar(pb.replace(/ /g, ''), brand.replace(/ /g, '')));
    };
    const pool = list.filter(p => p.id !== existing?.id && (sameBrand(p) || score(x.name, p.name) >= 0.4 || fold(p.name) === fold(x.name)));
    let ranked = rankCandidates(x, pool);
    let best = ranked[0];
    let vision = null;
    if (useVision && best && best.decision.action === 'review' && !best.decision.conflict) {
      vision = await visualScores(x, ranked.slice(0, 3), imageCounts, signal);
      if (Object.keys(vision.scores).length) {
        ranked = rankCandidates(x, pool, vision.scores);
        best = ranked[0];
        log({ type: 'log', stage: 'compare', text: 'Vision ' + x.name + ' — ' + Object.entries(vision.details).map(([id, d]) => id + ' ' + d.score.toFixed(2) + ' @' + d.distance + ' bits').join(' | ') });
      }
    }
    const candidates = ranked.slice(0, 8).map(({ item: p }) => (
      x.kind === 'filament'
        ? { candidateId: p.id, name: p.name, brand: p.brand, polymer: p.polymer || '', variant: p.variant || '', color: p.color || '', weight: p.weight || '', diameter: p.diameter || '', packaging: p.packaging || '' }
        : { candidateId: p.id, name: p.name, brand: p.brand, model: p.model || '', configuration: p.configuration || '' }
    ));

    if (d) {
      // Human baseline already decided merge or create.
    } else if (best && best.decision.action === 'merge') {
      const seen = vision && vision.details[best.item.id];
      d = { ...best.decision, ...tax, rule: 'magellan', matchPath: best.decision.matchPath || 'magellan', visualDistance: seen && seen.distance };
      log({ type: 'log', stage: 'compare', text: 'Magellan merge ' + x.name + ' → ' + best.item.name + ' (' + best.decision.reason + ')' });
    } else if (!ranked.some(r => r.decision.action === 'merge' || r.decision.action === 'review')) {
      // Toggle off: never invent a product when the catalog already holds the same brand and
      // model. A human decides, which costs one review instead of a duplicate row.
      const listingAxes = matcher.axesOf(x);
      const twin = autoLlmMatch !== true
        ? ranked.find((r) => {
            const axes = matcher.axesOf(r.item);
            // Same configuration only: an "A1" row is not a reason to hold an "A1 Combo"
            // listing, which the reference says is a different product.
            return listingAxes.brand && axes.brand === listingAxes.brand
              && listingAxes.modelCore && axes.modelCore === listingAxes.modelCore
              && conflicts(listingAxes, axes).length === 0;
          })
        : null;
      if (twin) {
        const row = {
          listing: x,
          action: 'held',
          reason: 'catalog already has ' + twin.item.name + ' — needs a look (LLM help is off)',
          matchPath: 'magellan',
          candidateId: twin.item.id,
          candidateName: twin.item.name,
          identityId: listingAxes.identityId,
          nearDupe: true
        };
        audit.push(row);
        log({ type: 'place', ...row });
        continue;
      }
      // --- the confirmed-catalog gate -------------------------------------------------
      // data/baseline-catalog.json is the confirmed catalog: the products we trust. A printer that
      // matches a confirmed row is placed onto it. A printer whose model and make are in NO
      // confirmed row is a genuinely new product, and a new product is never created silently —
      // it is held with needsPermission so the board can frame it and a human says yes.
      //
      // Scoped to printers on purpose. The baseline is a printer reference (FDM + resin); applying
      // this gate to filament would hold every spool in every run, because no spool is in it.
      if (x.kind === 'printer' && baselineReady()) {
        const verdict = confirmedVerdict(x);
        if (verdict && verdict.status === 'match') {
          const target = both.find((p) => matcher.axesOf(p).identityId === verdict.identityId);
          if (target) {
            d = {
              action: 'merge', confidence: 0.9, candidateId: target.id,
              reason: 'confirmed identity ' + verdict.identityId,
              keepImage: true, // the confirmed row's thumbnail outranks whatever this shop served
              ...tax, rule: 'baseline', matchPath: 'baseline'
            };
            log({ type: 'log', stage: 'compare', text: 'Confirmed merge ' + x.name + ' → ' + target.name + ' (' + verdict.identityId + ')' });
          } else {
            // Confirmed product, no row yet: create it — but named and identified from the
            // confirmed data, not from this shop's wording, so the next shop merges onto it.
            d = {
              action: 'create', confidence: 0.9,
              reason: 'confirmed identity ' + verdict.identityId + ' not yet in the catalog',
              baselineIdentityId: verdict.identityId,
              ...tax, rule: 'baseline', matchPath: 'baseline'
            };
            log({ type: 'log', stage: 'compare', text: 'Confirmed create ' + x.name + ' (' + verdict.identityId + ')' });
          }
        } else {
          const row = {
            listing: x,
            action: 'held',
            needsPermission: true,
            highlight: true,
            reason: 'NEW product — no confirmed row for ' + (verdict && verdict.brand ? verdict.brand : x.brand || '?')
              + (verdict && verdict.modelCore ? ' / ' + verdict.modelCore : '') + ': ask before creating it',
            matchPath: 'baseline',
            brand: (verdict && verdict.brand) || x.brand || ''
          };
          audit.push(row);
          log({ type: 'place', ...row });
          continue;
        }
      } else {
        d = { action: 'create', confidence: 0.88, reason: (best && best.decision.reason) || 'no catalog match', ...tax, rule: 'magellan', matchPath: 'magellan' };
        log({ type: 'log', stage: 'compare', text: 'Magellan create ' + x.name + (best ? ' — ' + best.decision.reason : '') });
      }
    } else if (autoLlmMatch === true && best && best.decision.action === 'review' && !best.decision.conflict) {
      try {
        const pick = await layaPick(x, both, { signal });
        d = { ...tax, action: pick.action === 'hold' ? 'held' : pick.action, candidateId: pick.matchId || null, confidence: pick.confidence, reason: pick.reason, rejected: pick.rejected, matchPath: 'laya-baseline', rule: 'laya-baseline' };
        log({ type: 'log', stage: 'compare', text: 'Laya ' + d.action + ' ' + x.name + ' — ' + d.reason });
      } catch (err) {
        const row = { listing: x, action: 'held', reason: 'baseline-trained Laya failed: ' + err.message, matchPath: 'laya-baseline', candidateId: best && best.item.id };
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
      const row = { listing: x, action: 'held', reason: (best && best.decision.nearDupe && best.decision.reason) || 'Ambiguous deterministic title match', matchPath: (best && best.decision.matchPath) || 'magellan', nearDupe: !!(best && best.decision.nearDupe), photoMatch: !!(best && best.decision.photoMatch), visual: best && best.decision.visual, candidateId: best && best.item.id };
      audit.push(row);
      log({ type: 'place', ...row });
      continue;
    }

    if (x.catalogTaxonomy) d = { ...d, ...x.catalogTaxonomy };
    if (existing && d.action === 'create' && d.confidence >= 0.8) {
      const at = existing.offers.findIndex(o => o.url === x.url);
      existing.offers[at] = { ...existing.offers[at], store: site, price: x.price, was: x.was && x.was > x.price ? x.was : existing.offers[at].was, url: x.url, image: x.image || '', vatIncluded: true, vatAdded: x.vatAdded === true, vatForced: x.vatForced === true, stockStatus: x.stockStatus, stockQuantity: x.stockQuantity, stockVerified: isResolvedStatus(x.stockStatus), stockCheckedAt: x.stockCheckedAt, stockPolicyVersion: 2, stockCheckOnPreview: true, sourceTitle: x.name || '', priceSuspect: x.priceSuspect === true ? 'harvest' : undefined, priceCurrency: x.currency || undefined };
      existing.offers.sort((a, b) => a.price - b.price);
      if (x.kind === 'filament') Object.assign(existing, { polymer: d.polymer, variant: d.variant, color: d.color, weight: d.weight, diameter: d.diameter, packaging: d.packaging, family: d.family });
      const row = { listing: x, ...d, action: 'updated', candidateId: existing.id, candidateName: existing.name, shelf: x.kind, rule: 'exact-url-with-deterministic-taxonomy', compared: (existing.offers || []).filter(o => o.url !== x.url && o.store).map(o => ({ store: o.store, price: o.price, url: o.url, name: existing.name })) };
      audit.push(row);
      log({ type: 'place', ...row });
      continue;
    }
    const target = d.candidateId && candidates.find(c => c.candidateId === d.candidateId);
    const targetRow = d.candidateId && both.find((p) => p.id === d.candidateId);
    const refusal = targetRow && decidePair(x, targetRow);
    if (d.action === 'merge' && (!target || !targetRow || d.confidence < 0.7 || refusal.action === 'create')) {
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

    const offer = { store: site, price: x.price, was: x.was && x.was > x.price ? x.was : undefined, url: x.url, image: x.image || '', vatIncluded: true, vatAdded: x.vatAdded === true, vatForced: x.vatForced === true, stockStatus: x.stockStatus, stockQuantity: x.stockQuantity, stockVerified: isResolvedStatus(x.stockStatus), stockCheckedAt: x.stockCheckedAt, stockPolicyVersion: 2, stockCheckOnPreview: true, sourceTitle: x.name || '', priceSuspect: x.priceSuspect === true ? 'harvest' : undefined, priceCurrency: x.currency || undefined };
    // ponytail: fingerprint only when a gray band asked for vision; a photo nobody
    // questioned is a download nobody needs. Stamp it when we did compute it.
    if (vision && vision.phash) offer.phash = vision.phash;
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
      const baseItem = d.baselineId && humanBoard && (humanBoard.items || []).find((it) => it.id === d.baselineId);
      const id = (baseItem && baseItem.id) || ('qwen-' + crypto.createHash('sha256').update(x.url).digest('hex').slice(0, 16));
      list.push({
        ...x,
        polymer: d.polymer, variant: d.variant, color: d.color, weight: d.weight, diameter: d.diameter, packaging: d.packaging, family: d.family, category: d.category, subcategory: d.subcategory,
        id,
        name: (baseItem && baseItem.name) || x.name,
        brand: (baseItem && baseItem.brand) || x.brand,
        image: (baseItem && baseItem.image) || x.image,
        baselineId: baseItem ? baseItem.id : undefined,
        sourceId: site, source: site, aisle: d.aisle || (x.kind === 'printer' ? 'fdm' : 'filament'), unit: x.brand,
        currency: { code: 'TRY', symbol: 'TL', position: 'after', decimals: 2 },
        offers: [offer]
      });
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

module.exports = { placeListings, layaPick, score, similar, fold };
