const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { placeListings } = require('./qwen-place.cjs');
const { harvestCategory, isLikelyProductUrl, slugToTitle, readStockFromHtml, extractIdentity, extractProductPage } = require('./harvest.js');
const { canonicalizeCategoryUrl, isTemplateUrl } = require('./harvest-guards.cjs');
const { resolveProductImage, scrubClonedImages } = require('./resolve-product-image.cjs');
const { withVat } = require('./parse-money.cjs');
const { fetchHtml, listingPageUrls, inferPagePattern, nextPageUrl } = require('./ai-scraper.cjs');
const { toTry, loadRates } = require('./compare-products.cjs');
const { recordMany } = require('./price-history.cjs');
const { isBuyableStock } = require('./tr-lexicon.cjs');
const clean = s => String(s || '').replace(/<(script|style|svg)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;|&amp;/g, m => m === '&amp;' ? '&' : ' ').replace(/\s+/g, ' ').trim();
const PAGINATION_RE = /[?&](tp|sayfa|pg|page|paged|ps|p)=\d+/i;
const paginationMisses = (url, added, misses = 0) => PAGINATION_RE.test(url) || /\/(?:page|sayfa)\/\d+/i.test(url) ? (added ? 0 : misses + 1) : misses;
// Same extract as a single page, just several product pages at once on this machine.
// Capped at 6 so a shop is not hit harder than before — the speedup is one shared browser, not a looser read.
const EXTRACT_AT_ONCE = Math.min(6, Math.max(4, (typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length) || 4));

function oosPagingStop({ buyable, oos, consecutive }) {
  const total = Number(buyable || 0) + Number(oos || 0);
  const ratio = total ? Number(oos || 0) / total : 0;
  if (total >= 6 && ratio >= 0.75) return { stop: true, consecutive: (consecutive || 0) + 1, ratio };
  if (Number(buyable || 0) === 0 && Number(oos || 0) >= 4) return { stop: true, consecutive: (consecutive || 0) + 1, ratio };
  if (ratio >= 0.6) {
    const n = (consecutive || 0) + 1;
    return { stop: n >= 2, consecutive: n, ratio };
  }
  return { stop: false, consecutive: 0, ratio };
}

// Explicit page text wins. When the page is silent, keep the shop's saved VAT policy.
function shouldAddVat(shopVat, pageVat) {
  return pageVat === 'excluded' || (shopVat === 'excluded' && pageVat !== 'included');
}

function listingFromHarvest(url, card, job, stockFilterUrls) {
  let price = Number(card && card.price);
  if (!card || !card.name || !Number.isFinite(price) || price <= 0) return null;
  const code = String(card.currency || 'TRY').toUpperCase();
  if (code && code !== 'TRY' && code !== 'TL') {
    const tryPrice = toTry(price, code);
    if (tryPrice) price = tryPrice;
  }
  const kind = job.kind === 'filament' ? 'filament' : job.kind === 'printer' ? 'printer' : (card.kind === 'filament' ? 'filament' : 'printer');
  const id = card.identity || extractIdentity(card.name);
  const brand = card.brand || id.brand || String(card.name || "").trim().split(/\s+/).find((w) => w.length > 1 && !/^(3d|the|a|an)$/i.test(w)) || "";
  if (!brand) return null;
  const stock = readStockFromHtml('', {
    harvested: card.stock,
    badge: card.stockBadge,
    filterVerified: stockFilterUrls.has(url)
  });
  if (!stock.verified) return null;
  if (!isBuyableStock(stock.status || card.stock || 'unknown')) return null;
  const pageVat = card.vatStatus || (card.vatExcluded === true ? 'excluded' : 'unknown');
  const vatExcluded = shouldAddVat(job.vat, pageVat);
  if (vatExcluded) price = withVat(price, 'excluded');
  return {
    name: card.name,
    brand,
    kind,
    price,
    url,
    image: card.image,
    polymer: id.polymer || '',
    variant: id.variant || '',
    color: id.color || '',
    weight: id.weight || '',
    diameter: id.diameter || '',
    packaging: id.packaging || '',
    stockStatus: stock.status || 'unknown',
    stockQuantity: Number.isFinite(stock.quantity) ? stock.quantity : null,
    stockVerified: stock.verified === true,
    stockCheckedAt: new Date().toISOString(),
    stockCheckMethod: stock.evidence || 'category-card',
    vatIncluded: true,
    vatAdded: vatExcluded === true,
    vatForced: pageVat === 'excluded'
  };
}

function isNavUrl(href, kind, currentPath) {
  let u;
  try { u = new URL(href); } catch { return false; }
  if (u.protocol === 'javascript:' || String(href).includes('{{')) return false;
  const p = u.pathname.toLowerCase();
  if (isLikelyProductUrl(href, kind)) return false;
  if (/\/(haber|blog|anket|sepet|uye|account|cart|search|marka)\b/.test(p)) return false;
  if (/recine|resin|parca|yedek|motor|surucu|kalem|cnc|tarayici|baski-hizmeti/.test(p)) return false;
  const paginated = /[?&](tp|sayfa|pg|page|paged|ps|p)=\d+/i.test(href) || /\/(?:page|sayfa)\/\d+/i.test(href);
  if (paginated && currentPath && p === String(currentPath).toLowerCase()) return true;
  const cat = /\/kategori\//.test(p) || /\/collections\//.test(p) || paginated || /hammadde|filament|yazici/.test(p);
  if (!cat) return false;
  if (kind === 'printer') return /yazici|printer/.test(p + u.search);
  if (kind === 'filament') return /filament|hammadde|\/pla|\/abs|\/petg|silk|asa|tpu|glow/.test(p + u.search);
  return /yazici|printer|filament|hammadde|\/pla|\/abs|\/petg|silk|asa|tpu|glow/.test(p + u.search);
}

async function runWebsiteJob(job, emit) {
  job.signal?.throwIfAborted();
  const log = emit || (() => {});
  const start = new URL(canonicalizeCategoryUrl(job.url));
  let pagePattern = null;
  if (job.page2Url) {
    try { pagePattern = inferPagePattern(start.href, new URL(job.page2Url, start).href); } catch { pagePattern = null; }
  }
  if (start.protocol !== 'https:' || !start.hostname.includes('.')) throw Error('The job URL must be a public HTTPS website');
  if (!['printer', 'filament', 'both'].includes(job.kind)) throw Error('kind must be printer, filament, or both');
  const root = path.resolve(__dirname, '..');
  const catalog = path.resolve(job.catalog || path.join(root, 'data/catalog.json'));
  const run = path.join(root, 'data/qwen-url-jobs', new Date().toISOString().replace(/[:.]/g, '-'));
  fs.mkdirSync(run, { recursive: true });
  const site = job.site || start.hostname.replace(/^www\./, '');
  // Stay inside the category subtree the user supplied. A bare homepage keeps full crawl scope.
  const scopePath = start.pathname === '/' ? '' : start.pathname.replace(/\/+$/, '');
  const inScope = u => {
    if (!scopePath) return true;
    const p = (u.pathname || '').replace(/\/+$/, '');
    return p === scopePath || p.startsWith(scopePath + '/') || scopePath.split('/').filter(Boolean).length === 1 && p.startsWith('/' + scopePath.split('/').filter(Boolean)[0] + '/');
  };
  const sameOrigin = u => {
    const x = new URL(u, start);
    if (x.origin !== start.origin) throw Error('Off-site URL rejected');
    return x.href;
  };
  const fetchPage = async url => {
    const u = sameOrigin(url);
    const listing = /kategori|collections|collection|yazicilar|filament|\/3d-yazici|\/3d-printer|products|katalog/i.test(u);
    log({ type: 'log', stage: 'discover', text: 'Opening ' + u });
    let html;
    try {
      html = await fetchHtml(u, job.signal, {
        scroll: listing,
        maxScrolls: listing ? 8 : 0,
        extraScrolls: 28,
        pauseMs: 800,
        extendIfNoPager: listing,
        discoverStock: false,
        onNote: (text) => log({ type: 'log', stage: 'discover', text })
      });
    } catch (err) {
      job.signal?.throwIfAborted();
      const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36', 'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.7' }, redirect: 'follow', signal: AbortSignal.any([AbortSignal.timeout(30000), ...(job.signal ? [job.signal] : [])]) });
      if (!r.ok) throw Error('HTTP ' + r.status + ' ' + u + (err && err.message ? ' (scroll: ' + err.message + ')' : ''));
      html = await r.text();
    }
    const links = [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)].flatMap(m => {
      try { return [{ url: sameOrigin(m[1]), text: clean(m[2]).slice(0, 180) }]; } catch { return []; }
    });
    const rank = x => isLikelyProductUrl(x.url, job.kind) ? 0 : /\b(?:3d\s*yaz[ıi]c[ıi]|filament)(?:ler)?\b/i.test(x.text) ? 1 : 2;
    const unique = [...new Map(links.map(x => [x.url, x])).values()].sort((a, b) => rank(a) - rank(b));
    const harvested = await harvestCategory({ categoryUrl: u, kind: job.kind, html, maxProducts: Number(job.maxProducts || 400), inStockOnly: true });
    if (harvested.warning) log({ type: 'log', stage: 'discover', text: harvested.warning + ' · ' + u });
    const pdpCache = new Map();
    const loadPdp = async (url) => {
      if (pdpCache.has(url)) return pdpCache.get(url);
      const body = await fetchHtml(url, job.signal, { scroll: false, discoverStock: false });
      pdpCache.set(url, body);
      return body;
    };
    const missingImages = harvested.inScope.filter((p) => !p.image).slice(0, 20);
    let imgCursor = 0;
    async function fillOneImage() {
      while (imgCursor < missingImages.length) {
        const p = missingImages[imgCursor];
        imgCursor += 1;
        try {
          const pdp = await loadPdp(p.url);
          p.image = resolveProductImage({ productPageHtml: pdp, productUrl: p.url, pageUrl: p.url }) || '';
        } catch { /* leave empty */ }
      }
    }
    await Promise.all(Array.from({ length: Math.min(4, missingImages.length) }, () => fillOneImage()));
    scrubClonedImages(harvested.inScope);
    const productUrls = harvested.inScope.map((p) => p.url);
    let imageManifest = {};
    try { imageManifest = require('../public/assets/robolink/manifest.json'); } catch { /* optional local thumbs */ }
    const thumbs = Object.fromEntries(harvested.inScope.map((p) => [p.url, {
      name: p.name || slugToTitle(p.url),
      brand: p.brand || '',
      kind: p.kind || '',
      image: p.image ? (imageManifest[p.image] || p.image) : '',
      price: p.price,
      stock: p.stock,
      stockBadge: p.stockBadge,
      identity: p.identity || null
    }]));
    const pageLinks = unique.filter(x => (/[?&](sayfa|tp|pg|page|paged|ps|p)=\d+/i.test(x.url) || /\/(?:page|sayfa)\/\d+/i.test(x.url)) && !String(x.url).includes('{{')).map(x => x.url);
    return { url: u, html, image: '', text: clean(html).slice(0, 22000), links: unique.slice(0, 250), productUrls, pageLinks, thumbs, harvested };
  };

  log({ type: 'log', stage: 'boot', text: 'Starting at ' + start.href + (pagePattern ? ' (page pattern from shop second-page URL)' : '') });
  const queue = [start.href];
  if (job.page2Url) {
    try {
      const second = sameOrigin(job.page2Url);
      if (second !== start.href) queue.push(second);
    } catch { /* page2 must stay on this shop */ }
  }
  const seen = new Set();
  const products = new Set();
  const stockFilterUrls = new Set();
  const harvestedByUrl = new Map();
  const errors = [];
  const maxPages = Number(job.maxPages || 40);
  const maxProducts = Number(job.maxProducts || 400);
  let emptyPaginationPages = 0;
  let oosStreak = 0;
  const stopped = () => job.signal && job.signal.aborted;

  while (queue.length && seen.size < maxPages && products.size < maxProducts) {
    if (stopped()) throw Error('Stopped');
    const nextUrl = queue.shift();
    let page;
    try { page = await fetchPage(nextUrl); }
    catch (e) {
      job.signal?.throwIfAborted();
      errors.push({ url: nextUrl, error: e.message });
      log({ type: 'log', stage: 'discover', text: 'Page failed: ' + e.message });
      continue;
    }
    if (seen.has(page.url)) continue;
    seen.add(page.url);
    log({ type: 'log', stage: 'discover', text: 'Reading ' + page.url });
    const remaining = Math.max(0, maxProducts - products.size);
    const added = [];
    for (const url of page.productUrls) {
      if (products.size >= maxProducts) break;
      if (isTemplateUrl(url) || !isLikelyProductUrl(url, job.kind, '', page.url)) continue;
      if (job.kind === 'filament' && /recine|resin/i.test(url)) continue;
      if (products.has(url)) continue;
      products.add(url);
      added.push(url);
      const thumb = page.thumbs && page.thumbs[url];
      if (thumb) harvestedByUrl.set(url, { ...(harvestedByUrl.get(url) || {}), ...thumb });
    }
    emptyPaginationPages = paginationMisses(page.url, added.length, emptyPaginationPages);
    const oosOnPage = ((page.harvested && page.harvested.rejected) || []).filter((r) => r.reason === "out_of_stock").length;
    const buyableOnPage = ((page.harvested && page.harvested.inScope) || []).length;
    const oosGate = oosPagingStop({ buyable: buyableOnPage, oos: oosOnPage, consecutive: oosStreak });
    oosStreak = oosGate.consecutive;
    const stopPaging = emptyPaginationPages >= 2 || oosGate.stop;
    if (stopPaging) {
      for (let i = queue.length - 1; i >= 0; i -= 1) {
        if (PAGINATION_RE.test(queue[i]) || /\/(?:page|sayfa)\/\d+/i.test(queue[i])) queue.splice(i, 1);
      }
      log({ type: 'log', stage: 'discover', text: oosGate.stop
        ? ('Pagination stopped: too many out-of-stock products on this page (' + oosOnPage + ' of ' + (oosOnPage + buyableOnPage) + ').')
        : 'Pagination stopped after two pages added no buyable products.' });
    } else {
      const fromPattern = pagePattern ? nextPageUrl(pagePattern, page.url, start.href) : null;
      const extra = [fromPattern, ...listingPageUrls(page.url, page.html)].find((x) => x && !seen.has(x) && !queue.includes(x));
      if (extra) {
        queue.push(extra);
        log({ type: 'log', stage: 'discover', text: 'Queued next listing page ' + extra });
      }
    }
    const harvested = added.length;
    if (added.length) log({ type: 'gather', urls: added, items: added.map((url) => ({ url, ...(page.thumbs && page.thumbs[url] || {}) })), products: products.size });
    else log({ type: 'log', stage: 'discover', text: 'No in-scope products on this page yet (' + ((page.harvested && page.harvested.rejected && page.harvested.rejected.length) || 0) + ' dropped)' });
    const dropped = (page.harvested && page.harvested.rejected) || [];
    const mismatches = (page.harvested && page.harvested.mismatches) || [];
    if (dropped.length) log({ type: 'log', stage: 'discover', text: 'Dropped ' + dropped.length + ' non-product URLs before placement' });
    if (mismatches.length) {
      log({
        type: 'mismatch',
        items: mismatches.map((m) => ({
          url: m.url,
          name: m.name,
          image: m.image,
          price: m.price,
          kind: m.detectedType,
          mismatch: { detectedType: m.detectedType, declaredType: m.declaredType }
        })),
        text: mismatches.length + ' category mismatch' + (mismatches.length === 1 ? '' : 'es') + ' held out of the ' + (job.kind || 'printer') + ' run'
      });
    }
    log({ type: 'log', stage: 'discover', text: 'Harvested ' + harvested + ' product URLs from the page HTML' });
    for (const raw of stopPaging ? [] : page.pageLinks) {
      try {
        const u = sameOrigin(raw);
        if (!seen.has(u) && !queue.includes(u) && inScope(u) && isNavUrl(u, job.kind, new URL(page.url).pathname)) {
          queue.push(u);
          break;
        }
      } catch (e) {
      job.signal?.throwIfAborted(); errors.push({ url: raw, error: e.message }); }
    }
    fs.writeFileSync(path.join(run, 'discovery.json'), JSON.stringify({ pages: [...seen], queued: queue, products: [...products], stockFilterUrls: [...stockFilterUrls], errors }, null, 2));
    log({ type: 'discover', pages: seen.size, products: products.size, stockVerified: stockFilterUrls.size, queued: queue.length, page: page.url });
  }

  const urls = [...products].slice(0, maxProducts).filter((url) => isLikelyProductUrl(url, job.kind));
  const listings = [];
  const needPage = [];
  for (const url of urls) {
    const card = harvestedByUrl.get(url);
    const listing = listingFromHarvest(url, card, job, stockFilterUrls);
    if (listing) {
      listings.push(listing);
      log({ type: 'extract', done: listings.length, total: urls.length, accepted: listings.length, held: errors.length, listing });
    } else needPage.push(url);
  }
  log({ type: 'log', stage: 'extract', text: listings.length + ' listings taken from category cards' + (needPage.length ? '; ' + needPage.length + ' still need a product page' : '') + '.' });
  for (let offset = 0; offset < needPage.length; offset += EXTRACT_AT_ONCE) {
    await Promise.all(needPage.slice(offset, offset + EXTRACT_AT_ONCE).map(async (pageUrl, batchIndex) => {
    const i = offset + batchIndex;
    if (stopped()) throw Error('Stopped');
    try {
      const page = await fetchPage(pageUrl);
      const filterVerified = stockFilterUrls.has(page.url);
      const harvested = harvestedByUrl.get(page.url) || {};
      log({ type: 'log', stage: 'extract', text: 'Reading product page ' + (i + 1) + '/' + needPage.length + ' · ' + page.url });
      const stock = readStockFromHtml(page.html, {
        filterVerified,
        harvested: harvested.stock,
        badge: harvested.stockBadge
      });
      if (!isBuyableStock(stock.status)) {
        errors.push({ url: page.url, error: 'out_of_stock' });
        log({ type: 'extract', done: i + 1, total: urls.length, accepted: listings.length, held: errors.length, url: page.url, error: 'out_of_stock' });
        return;
      }
      const extracted = extractProductPage(page.html, page.url, job.kind);
      if (extracted.mismatch) {
        log({
          type: 'mismatch',
          items: [{
            url: extracted.mismatch.url,
            name: extracted.mismatch.name,
            image: extracted.mismatch.image,
            price: extracted.mismatch.price,
            kind: extracted.mismatch.detectedType,
            mismatch: { detectedType: extracted.mismatch.detectedType, declaredType: extracted.mismatch.declaredType }
          }],
          text: 'category mismatch held out of the ' + (job.kind || 'printer') + ' run'
        });
        errors.push({ url: page.url, error: 'category_mismatch', mismatch: extracted.mismatch });
        return;
      }
      if (extracted.incomplete || !extracted.product) {
        const partial = extracted.incomplete;
        if (partial && partial.name && Number.isFinite(partial.price) && partial.price > 0 && partial.image) {
          const brand = partial.brand || extractIdentity(partial.name).brand || String(partial.name).split(/\s+/).find((w) => w.length > 1) || '';
          if (brand) {
            listings.push({
              name: partial.name, brand, kind: job.kind === 'filament' ? 'filament' : job.kind === 'printer' ? 'printer' : (partial.kind || 'printer'),
              price: partial.price, url: page.url, image: partial.image || page.image,
              stockStatus: stock.status,
              stockVerified: stock.verified === true,
              stockCheckedAt: new Date().toISOString(),
              stockCheckMethod: stock.evidence || 'html',
              vatIncluded: true, extractor: 'html'
            });
            log({ type: 'extract', done: listings.length, total: urls.length, accepted: listings.length, held: errors.length, listing: listings[listings.length - 1] });
            return;
          }
        }
        throw Error((extracted && extracted.reason) || 'Incomplete deterministic product evidence');
      }
      const x = extracted.product;
      const id = x.identity || extractIdentity(x.name);
      let price = x.price;
      // Record what the price carries: a later KDV flip on the shop has to know whether
      // the 20% is already in there, and a page that prints "+KDV" must keep it.
      const pageVat = x.vatStatus || (x.plusVat === true || x.vatIncluded === false ? 'excluded' : x.vatIncluded === true ? 'included' : 'unknown');
      const forcedVat = pageVat === 'excluded';
      const vatExcludedHere = shouldAddVat(job.vat, pageVat);
      if (vatExcludedHere) price = withVat(price, 'excluded');
      const listing = {
        name: x.name, brand: x.brand, polymer: id.polymer || '', variant: id.variant || '', color: id.color || '',
        weight: id.weight || '', diameter: id.diameter || '', packaging: id.packaging || '',
        kind: x.kind, price, url: page.url, image: x.image || page.image,
        stockStatus: stock.status || x.stock || 'unknown',
        stockQuantity: Number.isFinite(stock.quantity) ? stock.quantity : x.stockQuantity,
        stockVerified: stock.verified === true,
        stockCheckedAt: new Date().toISOString(),
        stockCheckMethod: stock.evidence || (filterVerified ? 'retailer-stock-only-filter' : 'html'),
        vatIncluded: true, vatAdded: vatExcludedHere, vatForced: forcedVat, was: x.was
      };
      listings.push(listing);
      log({ type: 'extract', done: listings.length, total: urls.length, accepted: listings.length, held: errors.length, listing });
    } catch (e) {
      job.signal?.throwIfAborted();
      errors.push({ url: pageUrl, error: e.message });
      log({ type: 'extract', done: i + 1, total: urls.length, accepted: listings.length, held: errors.length, url: pageUrl, error: e.message });
    }
    }));
  }

  job.signal?.throwIfAborted();
  const inputFile = path.join(run, 'verified-listings.json');
  fs.writeFileSync(inputFile, JSON.stringify(listings, null, 2));
  fs.writeFileSync(path.join(run, 'held.json'), JSON.stringify(errors, null, 2));
  try {
    const rates = await loadRates();
    recordMany(listings.map((l) => ({ ...l, price_try: toTry(l.price, l.currency || 'TRY', rates), status: 'ok' })));
  } catch (e) {
    log({ type: 'log', stage: 'extract', text: 'Price history skip: ' + e.message });
  }
  log({ type: 'log', stage: 'place', text: 'Grouping ' + listings.length + ' accepted listings against the catalog. Live site stays unchanged until you deploy.' });
  // Vision may have opened Chromium; a live browser keeps this process alive, so the
  // job owns the shutdown even when the run throws (abort, bad listing, CDN failure).
  let placed;
  try {
    placed = await placeListings({ listings, site, catalogFile: catalog, baselineFile: catalog ? path.join(path.dirname(catalog), "online-baseline.json") : undefined, apply: job.applyToCatalog === true, emit: log, runDir: run, signal: job.signal, autoLlmMatch: job.autoLlmMatch === true, visualMatch: job.visualMatch !== false });
  } finally {
    await require('./image-match.cjs').shutdown();
  }
  job.signal?.throwIfAborted();
  const placeHeld = (placed.audit || []).filter((row) => row.action === 'held').map((row) => ({
    url: row.listing && row.listing.url, error: row.reason, action: 'held'
  }));
  if (placeHeld.length) {
    errors.push(...placeHeld);
    fs.writeFileSync(path.join(run, 'held.json'), JSON.stringify(errors, null, 2));
  }
  const model = placed.run && placed.run.model || '';
  const summary = {
    status: 'complete', model, url: start.href, site, verified: listings.length, held: errors.length,
    applied: job.applyToCatalog === true, run, placement: placed.run, candidateFile: placed.candidateFile
  };
  fs.writeFileSync(path.join(run, 'summary.json'), JSON.stringify(summary, null, 2));
  log({ type: 'done', ...summary });
  return summary;
}

module.exports = { runWebsiteJob, paginationMisses, oosPagingStop, listingFromHarvest, shouldAddVat };
