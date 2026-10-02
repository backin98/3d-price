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
const { classifyFilament, canonicalColour, colourAgnosticTitle, colourNameFromTitle, coloursFromName, gramsFromText, MULTI_COLOUR } = require('../api/filament-classify.js');
const { variantsFromPage } = require('./product-variants.cjs');
const { classifyProductType } = require('./product-type.cjs');
const { clickThroughOptions } = require('./variant-clicker.cjs');
const clean = s => String(s || '').replace(/<(script|style|svg)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;|&amp;/g, m => m === '&amp;' ? '&' : ' ').replace(/\s+/g, ' ').trim();
const PAGINATION_RE = /[?&](tp|sayfa|pg|page|paged|ps|p)=\d+/i;
const paginationMisses = (url, added, misses = 0) => PAGINATION_RE.test(url) || /\/(?:page|sayfa)\/\d+/i.test(url) ? (added ? 0 : misses + 1) : misses;
// Same extract as a single page, just several product pages at once on this machine.
// Eight keeps a 14-core worker busy without opening hundreds of pages at once.
const EXTRACT_AT_ONCE = Math.min(8, Math.max(4, (typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length) || 4));
function shouldScrollPage(url, startUrl) {
  const target = new URL(url);
  const start = new URL(startUrl);
  if (target.pathname === start.pathname) return true;
  // Product slugs often contain the category word (for example Rhino's
  // /rhinolab-pla-matte-filament-black). A detail page must never inherit the
  // category's deep-scroll pass just because its URL contains "filament" or
  // "products".
  if (isLikelyProductUrl(target.href, 'filament') || isLikelyProductUrl(target.href, 'printer')) return false;
  if (PAGINATION_RE.test(target.search) || /\/(?:page|sayfa)\/\d+/i.test(target.pathname)) return true;
  return /\/kategori(?:ler)?\/|\/category(?:ies)?\/|\/collections?\/|yazicilar|filament-cesitleri|3d-yazici|3d-printer|katalog/i.test(target.pathname);
}

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

// Some shops stamp one brand on every product (rhino3dprinter.com marks RhinoLab and Filamix spools
// "Bambu Lab"). When the page brand is not in the title but a known filament brand is, the title wins.
const FILAMENT_BRANDS = (() => {
  try {
    const items = require('../data/filament-baseline.json').items || [];
    return [...new Set(items.map((x) => x.brand).filter(Boolean))].sort((a, b) => b.length - a.length);
  } catch { return []; }
})();
const brandWords = (s) => ' ' + String(s || '').toLocaleLowerCase('tr').normalize('NFD').replace(/\p{M}/gu, '').replace(/ı/g, 'i').replace(/[^a-z0-9+]+/g, ' ').trim() + ' ';
function brandFromTitle(title, brand) {
  const words = brandWords(title);
  const inTitle = (b) => brandWords(b).trim() && words.includes(brandWords(b));
  if (brand && inTitle(brand)) return brand;
  return FILAMENT_BRANDS.find(inTitle) || brand;
}

// Shops often print the spool weight only in the page <title>, og:title or meta description
// ("Bambu Lab PLA Basic Silver Filament 1.75mm 1Kg | RFID"), not in the on-page heading.
function pageWeight(html) {
  const h = String(html || '');
  const bits = [(h.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]];
  for (const key of ['og:title', 'description', 'og:description', 'keywords']) {
    const tag = h.match(new RegExp('<meta[^>]+(?:property|name)=["\']' + key + '["\'][^>]*>', 'i'));
    bits.push(tag && (tag[0].match(/content=["']([^"']*)["']/i) || [])[1]);
  }
  // A labelled spec line in the body ("Ağırlık: 1 kg", "Net Weight 1000 g"): one regex over the page we
  // already downloaded, never the whole description, so a "30 g test print" mention cannot win.
  const label = h.match(/(?:net\s*)?(?:a[gğ][ıi]rl[ıi]k|weight|gramaj|miktar)\s*(?:<[^>]{0,200}>\s*|[:：\-]\s*){0,6}([\d.,]+\s*(?:kg|kilogram|gr|gram|g)\b)/i);
  if (label) bits.push(label[1]);
  for (const b of bits) {
    const g = gramsFromText(b);
    if (g) return g + ' g';
  }
  return '';
}

// How far a run goes. No limit given (empty / 0) = every product the category has, reading as many pages as
// it takes; a limit stops at that many products, with enough pages to reach it.
function jobLimits(job) {
  const maxProducts = Number(job && job.maxProducts) > 0 ? Number(job.maxProducts) : Infinity;
  const fallbackPages = Number.isFinite(maxProducts) ? Math.max(40, Math.ceil(maxProducts / 8) + 10) : 400;
  const maxPages = Number(job && job.maxPages) > 0 ? Number(job.maxPages) : fallbackPages;
  return { maxProducts, maxPages };
}

function normalizeFilamentListing(listing) {
  if (!listing || listing.kind !== 'filament') return listing;
  const sourceTitle = listing.sourceTitle || listing.name || '';
  const id = classifyFilament(listing);
  const colour = colourNameFromTitle(sourceTitle, id.color);
  // Dual / tri colour: the matcher already compares colour SETS (lib/product-match.cjs colorSetOf).
  const colorSet = colour.name ? coloursFromName(colour.name) : [];
  const multicolor = colorSet.length > 1 || MULTI_COLOUR.test(sourceTitle);
  const color = colorSet.length > 1 ? colorSet.join('+')
    : multicolor && !colorSet.length && colour.name ? colour.name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '')
    : id.color;
  const urlGrams = gramsFromText(String(listing.url || '').replace(/[-_/]+/g, ' '));
  // Nothing anywhere says the weight: a standard spool is 1 kg, flagged as assumed so the admin shows it.
  const weight = id.weight || (urlGrams ? urlGrams + ' g' : '');
  return {
    ...listing,
    brand: brandFromTitle(sourceTitle, listing.brand),
    sourceTitle,
    name: colour.head || colourAgnosticTitle(sourceTitle, id.color),
    colorName: colour.name,
    colorSet,
    multicolor,
    // Marble has big dark flecks, galaxy a fine glitter: the admin dot shows them.
    colorEffect: /\bmarble\b|\bmermer\b/i.test(sourceTitle) ? 'marble' : /\bgalaxy\b|\bglitter\b|\bsparkle\b|\bsimli\b|\bgalaksi\b/i.test(sourceTitle) ? 'galaxy' : '',
    weight: weight || '1000 g',
    weightAssumed: !weight,
    polymer: id.polymer,
    variant: id.variant,
    color,
    diameter: id.diameter || '1.75 mm',
    packaging: id.packaging || 'spool',
    // A multi-pack ("4'lü set", "10 adet"): spools in the pack, 0 when a bundle does not say.
    packCount: id.packCount || 0,
    bundle: id.bundle === true
  };
}

// A filament listing that names no colour is usually a family card: the shop sells the colours as options
// on the product page (Filament Marketim lists one card per model). Those need the page.
function needsVariantPage(listing) {
  return !!listing && listing.kind === 'filament' && !listing.color && !listing.multicolor && !listing.variantOf;
}

// One listing per option the product page sells (colour, and weight or diameter when the shop splits those
// too). Each keeps its own URL, price, stock and picture; out-of-stock options are left out like any
// out-of-stock listing. The option label is appended to the shop title, so the filament classifier reads
// colour, weight and diameter from the shop's own words.
//   → { listings, outOfStock, links, source } ; listings is empty when the page offers no choice.
function variantListings(base, html, opts = {}) {
  return listingsFromOptions(base, opts.found || variantsFromPage(html, base.url, { pagePrice: base.vatAdded ? base.price / 1.2 : base.price }));
}

// found: { source, variants: [{ label, url, price, was, stock, image, id }], links }. An option without a
// URL of its own opens as the product with ?variant=<its name>, so every colour is its own offer.
function listingsFromOptions(base, found) {
  const listings = [];
  const outOfStock = [];
  const title = base.sourceTitle || base.name || '';
  const basePrice = base.vatAdded ? base.price / 1.2 : base.price;
  const seen = new Set();
  for (const raw of found.variants) {
    let v = raw;
    if (!v.url) {
      try { const u = new URL(base.url); u.searchParams.set('variant', String(v.id || v.label).toLocaleLowerCase('tr').normalize('NFD').replace(/\p{M}/gu, '').replace(/ı/g, 'i').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')); v = { ...v, url: u.href }; } catch { continue; }
    }
    if (seen.has(v.url)) continue;
    seen.add(v.url);
    if (v.stock === 'out_of_stock') { outOfStock.push(v.url); continue; }
    // A price far from the card's is a misread (another product's array), except for packs: a 10-spool
    // option can be ten times the single spool.
    let price = !(basePrice > 0) ? v.price : v.price > 0 && v.price >= basePrice * 0.2 && v.price <= basePrice * 12 ? v.price : basePrice;
    if (!(price > 0)) continue; // no price anywhere for this option: nothing to compare
    let was = v.was > price ? v.was : undefined;
    if (base.vatAdded) { price = withVat(price, 'excluded'); if (was) was = withVat(was, 'excluded'); }
    const named = title + ' - ' + v.label;
    const listing = normalizeFilamentListing({
      ...base,
      name: named,
      sourceTitle: named,
      url: v.url,
      price: Math.round(price * 100) / 100,
      was,
      image: v.image || base.image,
      // Re-read from the title with the option in it; what the card alone said no longer holds.
      polymer: '', variant: '', color: '', colorName: '', colorSet: undefined, multicolor: undefined, colorEffect: '',
      weight: base.weightAssumed ? '' : base.weight, diameter: '', packaging: '',
      stockStatus: v.stock || base.stockStatus,
      stockVerified: v.stock ? true : base.stockVerified,
      stockCheckMethod: v.stock ? 'product-variant' : base.stockCheckMethod,
      stockCheckedAt: new Date().toISOString(),
      variantOf: base.url,
      variantLabel: v.label,
      optionThumb: v.thumb || '',
      variantSource: found.source
    });
    // A colour the taxonomy does not know ("Galaxy Night") is still this option's colour: keep the shop's
    // word as its name and identity instead of leaving it in the title of a colourless spool.
    if (!listing.color && !listing.colorName && !listing.multicolor) {
      const word = String(v.label).split('/')[0].trim();
      Object.assign(listing, { name: normalizeFilamentListing({ ...base, name: title, sourceTitle: title }).name, colorName: word, color: word.toLocaleLowerCase('tr').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') });
    }
    listings.push(listing);
  }
  return { listings, outOfStock, links: found.links || [], source: found.source };
}

async function fillMissingFilamentColours(listings, signal, detect) {
  const vision = detect || require('./image-match.cjs').detectFilamentColour;
  // A rainbow / dual / tri-colour spool has no single colour, and its photo is mostly cardboard:
  // guessing one from pixels gave "light brown" for a Rainbow Spring Lake spool.
  const missing = (listings || []).filter((row) => row.kind === 'filament' && !row.color && row.image && !row.multicolor);
  for (let offset = 0; offset < missing.length; offset += 4) {
    await Promise.all(missing.slice(offset, offset + 4).map(async (row) => {
      signal?.throwIfAborted();
      let imageText = String(row.image).replace(/[-_]+/g, ' ');
      try { imageText = decodeURIComponent(imageText); } catch { /* malformed URL: pixels may still work */ }
      const fromImageName = canonicalColour(imageText);
      if (fromImageName) { row.color = fromImageName; row.colorSource = 'image-url'; return; }
      const found = await vision(row.image, { signal }).catch(() => null);
      if (found && found.color && Number(found.confidence) >= 0.38) {
        row.color = found.color;
        row.colorSource = 'image';
      }
    }));
  }
  return listings;
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
  return normalizeFilamentListing({
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
  });
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
  const productHtmlCache = new Map();
  const loadProductHtml = url => {
    const u = sameOrigin(url);
    if (productHtmlCache.has(u)) return productHtmlCache.get(u);
    const pending = fetchHtml(u, job.signal, { scroll: false, blockResources: true, discoverStock: false })
      .catch((err) => { productHtmlCache.delete(u); throw err; });
    productHtmlCache.set(u, pending);
    return pending;
  };
  const fetchPage = async url => {
    const u = sameOrigin(url);
    // A known/paginated listing already exposes its next slice. Deep-scrolling it
    // only repeats the same 20 cards and delays every page; scrolling is reserved
    // for a category with no usable pagination.
    const paginated = PAGINATION_RE.test(u) || /\/(?:page|sayfa)\/\d+/i.test(new URL(u).pathname);
    const listing = shouldScrollPage(u, start.href) && !paginated && !pagePattern;
    const productPage = isLikelyProductUrl(u, job.kind);
    log({ type: 'log', stage: 'discover', text: 'Opening ' + u });
    let html;
    try {
      html = productPage ? await loadProductHtml(u) : await fetchHtml(u, job.signal, {
        scroll: listing,
        maxScrolls: listing ? 8 : 0,
        extraScrolls: 28,
        pauseMs: 800,
        extendIfNoPager: listing,
        blockResources: productPage,
        discoverStock: false,
        onNote: (text) => log({ type: 'log', stage: 'discover', text })
      });
    } catch (err) {
      job.signal?.throwIfAborted();
      // A replayed run never falls back to the network: a page missing from the archive is a miss.
      if (err && err.code === 'REPLAY_MISS') throw err;
      const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36', 'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.7' }, redirect: 'follow', signal: AbortSignal.any([AbortSignal.timeout(30000), ...(job.signal ? [job.signal] : [])]) });
      if (!r.ok) throw Error('HTTP ' + r.status + ' ' + u + (err && err.message ? ' (scroll: ' + err.message + ')' : ''));
      html = await r.text();
      if (productPage) productHtmlCache.set(u, Promise.resolve(html));
    }
    const links = [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)].flatMap(m => {
      try { return [{ url: sameOrigin(m[1]), text: clean(m[2]).slice(0, 180) }]; } catch { return []; }
    });
    const rank = x => isLikelyProductUrl(x.url, job.kind) ? 0 : /\b(?:3d\s*yaz[ıi]c[ıi]|filament)(?:ler)?\b/i.test(x.text) ? 1 : 2;
    const unique = [...new Map(links.map(x => [x.url, x])).values()].sort((a, b) => rank(a) - rank(b));
    const harvested = await harvestCategory({ categoryUrl: u, kind: job.kind, html, maxProducts: jobLimits(job).maxProducts, inStockOnly: true });
    if (harvested.warning) log({ type: 'log', stage: 'discover', text: harvested.warning + ' · ' + u });
    const missingImages = harvested.inScope.filter((p) => !p.image).slice(0, 20);
    let imgCursor = 0;
    async function fillOneImage() {
      while (imgCursor < missingImages.length) {
        const p = missingImages[imgCursor];
        imgCursor += 1;
        try {
          const pdp = await loadProductHtml(p.url);
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
  const { maxPages, maxProducts } = jobLimits(job);
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
      const choices = pagePattern
        ? [nextPageUrl(pagePattern, page.url, start.href)]
        : listingPageUrls(page.url, page.html);
      const extra = choices.find((x) => x && !seen.has(x) && !queue.includes(x));
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
  const families = [];
  const accept = (listing) => {
    listings.push(listing);
    log({ type: 'extract', done: listings.length, total: urls.length, accepted: listings.length, held: errors.length, listing });
  };
  // A family listing (no colour in its name) whose product page sells the colours as options becomes one
  // listing per colour. Colour links (each colour its own page) are read like any product page.
  let debugSaved = 0;
  // The page as a filament family listing (no colour in its name), or null.
  const familyFromPage = (page, harvested) => {
    const extracted = extractProductPage(page.html, page.url, 'filament');
    if (extracted.mismatch) return null;
    const x = extracted.product || extracted.incomplete || {};
    const name = x.name || harvested.name || '';
    if (!name || (job.kind !== 'filament' && classifyProductType(name, x.brand || harvested.brand) !== 'filament')) return null;
    const pageVat = x.vatStatus || (x.plusVat === true || x.vatIncluded === false ? 'excluded' : 'unknown');
    const vatAdded = shouldAddVat(job.vat, pageVat);
    const raw = Number(x.price) > 0 ? Number(x.price) : Number(harvested.price) > 0 ? Number(harvested.price) : 0;
    const listing = normalizeFilamentListing({
      name, brand: x.brand || harvested.brand || extractIdentity(name).brand || String(name).split(/\s+/)[0],
      kind: 'filament', url: page.url, image: x.image || harvested.image || '',
      price: raw && vatAdded ? withVat(raw, 'excluded') : raw,
      stockStatus: 'unknown', stockVerified: false, stockCheckedAt: new Date().toISOString(), stockCheckMethod: 'family-page',
      vatIncluded: true, vatAdded, vatForced: pageVat === 'excluded'
    });
    return needsVariantPage(listing) ? listing : null;
  };
  // true when the listing's colours (or its colour pages) were taken; false leaves the listing to the caller.
  const expandFamily = async (listing, html) => {
    let found = variantListings(listing, html);
    // Nothing in the page HTML: the shop draws its options with script (Filament Marketim, on Qukasoft).
    // Open the page and click each option, like a person would.
    let clicked = null;
    if (!found.listings.length && !found.links.length && !found.outOfStock.length && !process.env.SCRAPE_REPLAY_DIR) {
      try {
        const browser = await require('./ai-scraper.cjs').browserFor(job.signal).catch(() => null);
        clicked = await clickThroughOptions(listing.url, { signal: job.signal, browser: browser || undefined, keepHtml: true });
        if (clicked.variants.length) found = listingsFromOptions(listing, { source: 'clicked', variants: clicked.variants, links: [] });
        // Colour pages linked only once the page's scripts ran.
        else if (clicked.html) found = variantListings(listing, clicked.html);
      } catch (e) {
        job.signal?.throwIfAborted();
        clicked = { variants: [], groups: [], note: 'clicking failed: ' + e.message };
      }
    }
    if (!found.listings.length && !found.links.length && !found.outOfStock.length) {
      // Still one colourless listing: say why, and keep the page so it can be looked at (work/variant-debug).
      let saved = '';
      if (debugSaved < 10 && (html || (clicked && clicked.html))) {
        try {
          const dir = path.join(root, 'work', 'variant-debug');
          fs.mkdirSync(dir, { recursive: true });
          saved = path.join(dir, site.replace(/[^a-z0-9.-]/gi, '_') + '-' + String(new URL(listing.url).pathname).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 80) + '.html');
          // The page as the browser drew it (after its scripts) when we have it: that is what shows the options.
          fs.writeFileSync(saved, (clicked && clicked.html) || html);
          debugSaved += 1;
        } catch { saved = ''; }
      }
      log({ type: 'log', stage: 'extract', text: 'No colour options found for ' + (listing.sourceTitle || listing.name) + ' (' + ((clicked && clicked.note) || 'none in the page') + (clicked && clicked.groups && clicked.groups.length ? '; option-like blocks: ' + clicked.groups.map((g) => g.name + ' ×' + g.size).join(', ') : '') + ')' + (saved ? ' — page saved to ' + path.relative(root, saved) : '') });
    }
    if (found.listings.length) {
      log({ type: 'variants', url: listing.url, urls: found.listings.map((l) => l.url), text: (listing.sourceTitle || listing.name) + ': ' + found.listings.length + ' options in stock' + (found.outOfStock.length ? ', ' + found.outOfStock.length + ' out of stock' : '') + ' (' + found.source + ')' });
      for (const url of found.outOfStock) errors.push({ url, error: 'out_of_stock' });
      found.listings.forEach(accept);
      return true;
    }
    const more = found.links.map((l) => { try { return sameOrigin(l.url); } catch { return ''; } })
      .filter((u) => u && !products.has(u) && isLikelyProductUrl(u, job.kind));
    if (!more.length) return false;
    // Each colour is its own page: those pages are the listings, and the colourless family page goes.
    more.forEach((u) => { products.add(u); needPage.push(u); });
    log({ type: 'variants', url: listing.url, urls: more, text: (listing.sourceTitle || listing.name) + ': ' + more.length + ' colours on their own pages' });
    log({ type: 'gather', urls: more, items: more.map((url) => ({ url })) });
    return true;
  };
  const acceptWithVariants = async (listing, html) => {
    if (!(await expandFamily(listing, html))) accept(listing);
  };
  for (const url of urls) {
    const card = harvestedByUrl.get(url);
    const listing = listingFromHarvest(url, card, job, stockFilterUrls);
    if (listing && needsVariantPage(listing)) families.push(listing);
    else if (listing) accept(listing);
    else needPage.push(url);
  }
  log({ type: 'log', stage: 'extract', text: listings.length + ' listings taken from category cards' + (families.length ? '; ' + families.length + ' name no colour, so their product pages are read for colour options' : '') + (needPage.length ? '; ' + needPage.length + ' still need a product page' : '') + '.' });
  for (let offset = 0; offset < families.length; offset += EXTRACT_AT_ONCE) {
    await Promise.all(families.slice(offset, offset + EXTRACT_AT_ONCE).map(async (listing) => {
      if (stopped()) throw Error('Stopped');
      let html = '';
      try { html = await loadProductHtml(listing.url); }
      catch (e) {
        job.signal?.throwIfAborted();
        log({ type: 'log', stage: 'extract', text: 'Colour options not read (' + e.message + '): ' + listing.url });
      }
      await acceptWithVariants(listing, html);
    }));
  }
  // needPage grows while it is read (colours on their own pages): advance by what this batch took.
  for (let offset = 0, batch = []; offset < needPage.length; offset += batch.length) {
    batch = needPage.slice(offset, offset + EXTRACT_AT_ONCE);
    await Promise.all(batch.map(async (pageUrl, batchIndex) => {
    const i = offset + batchIndex;
    if (stopped()) throw Error('Stopped');
    try {
      const page = await fetchPage(pageUrl);
      const filterVerified = stockFilterUrls.has(page.url);
      const harvested = harvestedByUrl.get(page.url) || {};
      log({ type: 'log', stage: 'extract', text: 'Reading product page ' + (i + 1) + '/' + needPage.length + ' · ' + page.url });
      // A filament family page (Filament Marketim: one card per model, the colours picked on the page) often
      // reads as out of stock or price-less until a colour is chosen. Its colours come first; the stock and
      // price checks below are for pages that sell one thing.
      if (job.kind !== 'printer') {
        const family = familyFromPage(page, harvested);
        if (family && await expandFamily(family, page.html)) return;
      }
      const stock = readStockFromHtml(page.html, {
        filterVerified,
        harvested: harvested.stock,
        badge: harvested.stockBadge
      });
      // "Lütfen renk seçiniz": the cart waits for a choice, the product is not sold out. Keep reading it.
      const awaitingChoice = /l[uü]tfen\s+(?:bir\s+)?(?:renk|se[cç]enek|varyant|beden|model)\s+se[cç]i|(?:renk|se[cç]enek|varyant)\s+se[cç]iniz|please\s+(?:select|choose)\s+(?:a\s+)?(?:colou?r|option|variant)/i.test(String(page.html).replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' '));
      if (awaitingChoice && stock.status === 'out_of_stock') stock.status = 'unknown';
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
        const partial = extracted.incomplete ? { ...extracted.incomplete } : null;
        // No price on the page until a colour is picked: the category card showed one.
        if (partial && !(Number(partial.price) > 0) && awaitingChoice && Number(harvested.price) > 0) partial.price = Number(harvested.price);
        if (partial && !partial.image && harvested.image) partial.image = harvested.image;
        if (partial && partial.name && Number.isFinite(partial.price) && partial.price > 0 && partial.image) {
          const brand = partial.brand || extractIdentity(partial.name).brand || String(partial.name).split(/\s+/).find((w) => w.length > 1) || '';
          if (brand) {
            listings.push(normalizeFilamentListing({
              name: partial.name, brand, kind: job.kind === 'filament' ? 'filament' : job.kind === 'printer' ? 'printer' : (partial.kind || 'printer'),
              price: partial.price, url: page.url, image: partial.image || page.image, weight: pageWeight(page.html),
              stockStatus: stock.status,
              stockVerified: stock.verified === true,
              stockCheckedAt: new Date().toISOString(),
              stockCheckMethod: stock.evidence || 'html',
              vatIncluded: true, extractor: 'html'
            }));
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
      const listing = normalizeFilamentListing({
        name: x.name, brand: x.brand, polymer: id.polymer || '', variant: id.variant || '', color: id.color || '',
        weight: id.weight || pageWeight(page.html), diameter: id.diameter || '', packaging: id.packaging || '',
        kind: x.kind, price, url: page.url, image: x.image || page.image,
        stockStatus: stock.status || x.stock || 'unknown',
        stockQuantity: Number.isFinite(stock.quantity) ? stock.quantity : x.stockQuantity,
        stockVerified: stock.verified === true,
        stockCheckedAt: new Date().toISOString(),
        stockCheckMethod: stock.evidence || (filterVerified ? 'retailer-stock-only-filter' : 'html'),
        vatIncluded: true, vatAdded: vatExcludedHere, vatForced: forcedVat, was: x.was
      });
      if (needsVariantPage(listing)) await acceptWithVariants(listing, page.html);
      else accept(listing);
    } catch (e) {
      job.signal?.throwIfAborted();
      errors.push({ url: pageUrl, error: e.message });
      log({ type: 'extract', done: i + 1, total: urls.length, accepted: listings.length, held: errors.length, url: pageUrl, error: e.message });
    }
    }));
  }

  job.signal?.throwIfAborted();
  await fillMissingFilamentColours(listings, job.signal);
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

module.exports = {
  jobLimits, pageWeight, runWebsiteJob, paginationMisses, oosPagingStop, listingFromHarvest, normalizeFilamentListing, fillMissingFilamentColours, shouldAddVat, shouldScrollPage, needsVariantPage, variantListings, listingsFromOptions };
