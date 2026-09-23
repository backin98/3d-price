// Live stock re-check. The harvest knows how to read stock from a page (badge, "tükendi",
// sepete ekle, stok miktarı); this re-runs that reading against the product pages we already
// linked, long after the run that discovered them, so a vendor that ran out drops out of the
// comparison instead of showing a stale price forever.
const { fold } = require('./product-match.cjs');
const { extractProductPage } = require('./harvest.js');
const { withVat } = require('./parse-money.cjs');
const { toTry } = require('./compare-products.cjs');

const stripTags = (html) => String(html || '')
  .replace(/<(script|style|svg)\b[\s\S]*?<\/\1>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;|&#160;/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const OOS = /tukendi|stokta yok|sold out|out of stock|gelince haber|stoklara gelince/;
const IN = /sepete ekle|add to cart|sepeteekle|addtocart|stok durumu var|stoktan teslim/;
const PREORDER = /on siparis(?: urunu)?|pre order|preorder|backorder/;
const PRICE = /(?:\d[\d.,]*\s*(?:TL|TRY|₺|USD|EUR|€|\$)|(?:₺|€|\$)\s*\d)/i;

// Page level stock, deliberately conservative. A product page also mentions "tükendi" in
// recommendations and "ön sipariş" in menus, so only structured data or the buy box counts —
// a stray string must never take a whole vendor out of the comparison.
// A status we could actually read. "unknown"/"missing" means no answer, not a verified answer.
function isResolvedStatus(s) {
  return s === "in_stock" || s === "out_of_stock" || s === "preorder" || s === "dropshipping";
}

function readStockPage(html, { rendered = false } = {}) {
  const raw = String(html || '');
  const buyRaw = raw.replace(/<(nav|header|footer)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(button|a)\b(?=[^>]*(?:\bdisabled\b|aria-disabled=["']?true|class=["'][^"']*\bdisabled\b))[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<input\b(?=[^>]*(?:\bdisabled\b|aria-disabled=["']?true|class=["'][^"']*\bdisabled\b))[^>]*>/gi, ' ');
  const at = buyRaw.search(/sepete\s*ekle|add\s*to\s*cart|sepetekle|addtocart|btn_sepet_ekle/i);
  if (at >= 0) {
    const box = fold(stripTags(buyRaw.slice(Math.max(0, at - 400), at + 400)));
    if (PREORDER.test(box)) return { status: 'preorder', verified: true, method: rendered ? 'rendered-preorder' : 'buy-box-preorder' };
    if (OOS.test(box)) return { status: 'out_of_stock', verified: true, method: rendered ? 'rendered-buy-box' : 'buy-box' };
    return { status: 'in_stock', verified: true, method: rendered ? 'rendered-buy-box' : 'buy-box' };
  }
  const structured = raw.match(/"availability"\s*:\s*"[^"]*(OutOfStock|SoldOut|PreOrder|InStock|LimitedAvailability|BackOrder|OutOfStock)/i)
    || raw.match(/itemprop=["']availability["'][^>]*?(?:href|content)=["'][^"']*(OutOfStock|InStock|PreOrder|BackOrder)/i);
  if (structured) {
    const word = String(structured[1]).toLowerCase();
    if (/outofstock|soldout/.test(word)) return { status: 'out_of_stock', verified: true, method: 'structured' };
    if (/preorder|backorder/.test(word)) return { status: 'preorder', verified: true, method: 'structured' };
    if (/instock|limitedavailability/.test(word)) return { status: 'in_stock', verified: true, method: 'structured' };
  }
  const all = fold(stripTags(buyRaw));
  if (OOS.test(all) && !IN.test(all) && !/sepet/i.test(all)) {
    return { status: 'out_of_stock', verified: true, method: rendered ? 'rendered-out-of-stock' : 'page-no-cart' };
  }
  // Plain HTTP cannot see a JavaScript buy box. Only the PC worker may conclude that a fully
  // rendered, priced product with no buy control is unavailable.
  if (rendered && PRICE.test(stripTags(buyRaw))) return { status: 'out_of_stock', verified: true, method: 'rendered-no-buy-control' };
  return { status: 'unknown', verified: false, method: 'no-evidence' };
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const DEFAULT_TIMEOUT = 7000;
const DEFAULT_BUDGET = 25000;
const CONCURRENCY = 4;

const rows = (catalog) => [...((catalog && catalog.products) || []), ...((catalog && catalog.filaments) || [])];

function ageHours(iso, now) {
  const at = Date.parse(iso || '');
  return Number.isFinite(at) ? (now - at) / 36e5 : Infinity;
}

// Offers whose stock we do not know the age of, or whose last check is older than staleHours.
function planStockChecks(catalog, { staleHours = 12, now = Date.now(), limit = 40, urls = null } = {}) {
  const want = urls && urls.length ? new Set(urls) : null;
  const targets = [];
  for (const product of rows(catalog)) {
    for (const offer of product.offers || []) {
      if (!offer || !offer.url) continue;
      if (want && !want.has(offer.url)) continue;
      const age = ageHours(offer.stockCheckedAt, now);
      if (age >= staleHours) targets.push({ product, offer, ageHours: age });
    }
  }
  targets.sort((a, b) => b.ageHours - a.ageHours);
  return { targets, total: targets.length, due: Math.min(targets.length, Math.max(0, limit)) };
}

// Shops are slow and sometimes answer with half a page. A fetch that failed, timed out or came
// back truncated says nothing about stock, so it must never mark an offer dead — "unknown" keeps
// the offer on the site until a real answer arrives.
const MIN_PAGE_BYTES = 2000;
const RETRIES = 2;

async function fetchPage(url, fetchImpl, timeoutMs) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    return await fetchImpl(url, {
      redirect: 'follow',
      signal: ctl.signal,
      headers: { 'User-Agent': UA, 'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.7' }
    });
  } finally {
    clearTimeout(timer);
  }
}

function readPricePage(html, url, { kind = 'printer', vatAdded = false, rates } = {}) {
  const extracted = extractProductPage(html, url, kind);
  const product = extracted && extracted.product;
  if (!product || !Number.isFinite(product.price) || product.price <= 0) return null;
  const currency = String(product.priceCurrency || 'TRY').toUpperCase();
  let price = currency === 'TRY' || currency === 'TL' ? product.price : toTry(product.price, currency, rates);
  if (!price) return null;
  if (product.vatStatus === 'excluded' || (vatAdded && product.vatStatus !== 'included')) price = withVat(price, 'excluded');
  return { price, priceSource: product.priceSource || 'page', vatStatus: product.vatStatus || 'unknown' };
}

async function checkOfferStock(url, { fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT, retries = RETRIES, renderHtml, kind, vatAdded, rates } = {}) {
  let last = 'unknown';
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 400 * attempt));
    try {
      const res = await fetchPage(url, fetchImpl, timeoutMs);
      // A delisted page is the strongest out-of-stock signal there is.
      if (res.status === 404 || res.status === 410) return { status: 'out_of_stock', quantity: null, verified: true, method: 'http-' + res.status };
      if (res.status >= 500 || res.status === 429) { last = 'http-' + res.status; continue; } // their problem: try again
      if (!res.ok) return { status: 'unknown', quantity: null, verified: false, method: 'http-' + res.status };
      const html = await res.text();
      if (String(html || '').length < MIN_PAGE_BYTES) { last = 'short-page'; continue; }
      let read = readStockPage(html);
      let price = readPricePage(html, url, { kind, vatAdded, rates });
      if (!read.verified && renderHtml) {
        try {
          const rendered = await renderHtml(url);
          read = readStockPage(rendered, { rendered: true });
          price = readPricePage(rendered, url, { kind, vatAdded, rates }) || price;
        } catch (_) { /* rendering failed: keep the safe unknown result */ }
      }
      // Conflicting signals mean we do not know: a page that says "sold out" in one place and
      // InStock in another is exactly the laggy-shop case, and guessing is worse than waiting.
      if (read.status === 'out_of_stock' && /"availability"\s*:\s*"[^"]*InStock/i.test(html) && read.method === 'buy-box') {
        return { status: 'unknown', quantity: null, verified: false, method: 'conflicting-signals', ...(price || {}) };
      }
      return { status: read.status, quantity: null, verified: read.verified === true, method: read.method, ...(price || {}) };
    } catch (err) {
      last = err && err.name === 'AbortError' ? 'timeout' : String((err && err.message) || err).slice(0, 40);
    }
  }
  return { status: 'unknown', quantity: null, verified: false, method: (last.startsWith('http') || last === 'short-page' ? last : 'error:' + last) };
}

// Product level view: a product is only dead when every vendor is, and alive as soon as one is.
function rollupProductStock(product, now) {
  const offers = product.offers || [];
  const statuses = offers.map((o) => o.stockStatus || 'unknown');
  if (offers.length && statuses.every((s) => s === 'out_of_stock')) product.stockStatus = 'out_of_stock';
  else if (statuses.includes('in_stock')) product.stockStatus = 'in_stock';
  else if (statuses.some((s) => s === 'preorder')) product.stockStatus = 'preorder';
  else if (statuses.some((s) => s === 'dropshipping')) product.stockStatus = 'dropshipping';
  else product.stockStatus = offers.length ? 'unknown' : product.stockStatus;
  const inStock = offers.find((o) => o.stockStatus === 'in_stock');
  // Verified means the flag AND a resolved status. Checking the flag alone stamped every offer with
  // stockStatus 'unknown' as verified: 186 of them in the live catalogue, which made the flag useless
  // as a buyability signal. 'unknown' is the absence of an answer, not an answer.
  product.stockVerified = offers.length > 0 && offers.every((o) => o.stockVerified === true && isResolvedStatus(o.stockStatus));
  product.stockCheckedAt = new Date(now).toISOString();
  product.stockCheckMethod = (inStock || offers[0] || {}).stockCheckMethod || 'page';
  return product;
}

// Checks up to `limit` stale offers, stopping early if the time budget runs out. Mutates the
// catalog it is given and reports what changed.
async function refreshStock({ catalog, limit = 40, staleHours = 12, now = Date.now(), budgetMs = DEFAULT_BUDGET, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT, renderHtml, onProgress, rates } = {}) {
  const planned = planStockChecks(catalog, { staleHours, now, limit: Number.MAX_SAFE_INTEGER });
  const targets = planned.targets.slice(0, Math.max(0, limit));
  const deadline = now + Math.max(1000, budgetMs);
  const summary = { stale: planned.total, planned: targets.length, checked: 0, changed: 0, repriced: 0, outOfStock: 0, unverified: 0, skipped: 0, guarded: 0 };
  const results = [];
  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    if (Date.now() > deadline) {
      summary.skipped = targets.length - i;
      break;
    }
    const batch = targets.slice(i, i + CONCURRENCY);
    const read = await Promise.all(batch.map((t) => checkOfferStock(t.offer.url, { fetchImpl, timeoutMs, renderHtml, kind: t.product.kind, vatAdded: t.offer.vatAdded === true, rates })));
    batch.forEach((t, k) => {
      const r = read[k];
      const before = t.offer.stockStatus || 'unknown';
      const beforePrice = Number(t.offer.price);
      Object.assign(t.offer, {
        stockStatus: r.status,
        stockQuantity: r.quantity === undefined ? null : r.quantity,
        stockVerified: r.verified,
        stockCheckedAt: new Date().toISOString(),
        stockCheckMethod: r.method,
        stockPolicyVersion: 3
      });
      if (Number.isFinite(r.price) && r.price > 0) {
        t.offer.price = r.price;
        t.offer.priceSource = r.priceSource;
        t.offer.priceCheckedAt = new Date().toISOString();
        if (beforePrice !== r.price) summary.repriced += 1;
      }
      summary.checked += 1;
      if (before !== r.status) summary.changed += 1;
      if (before !== 'out_of_stock' && r.status === 'out_of_stock') summary.outOfStock += 1;
      if (!r.verified) summary.unverified += 1;
      results.push({ url: t.offer.url, store: t.offer.store, before, after: r.status, verified: r.verified === true, checkedAt: t.offer.stockCheckedAt, method: r.method, beforePrice, price: r.price, priceSource: r.priceSource, priceCheckedAt: t.offer.priceCheckedAt });
      if (onProgress) onProgress({ url: t.offer.url, before, after: r.status });
    });
  }
  // If every offer of one shop came back dead in the same pass, suspect the parser (a
  // redesign, a block page) rather than believing a whole vendor vanished. Keep it unknown.
  const perStore = new Map();
  for (const r of results) {
    const key = r.store || '';
    const row = perStore.get(key) || { dead: 0, renderedDead: 0, total: 0 };
    row.total += 1;
    if (r.after === 'out_of_stock') {
      row.dead += 1;
      if (/^rendered-|^http-/.test(r.method || '')) row.renderedDead += 1;
    }
    perStore.set(key, row);
  }
  const suspect = new Set();
  for (const [key, row] of perStore) {
    if (row.total >= 3 && row.dead === row.total && row.renderedDead === 0) suspect.add(key);
  }
  if (suspect.size) {
    for (const t of targets) {
      if (!suspect.has(t.offer.store || '')) continue;
      if (t.offer.stockStatus !== 'out_of_stock') continue;
      t.offer.stockStatus = 'unknown';
      t.offer.stockVerified = false;
      t.offer.stockCheckMethod = 'guard:whole-shop';
      summary.guarded += 1;
      const r = results.find((x) => x.url === t.offer.url);
      if (r) { r.after = 'unknown'; r.method = 'guard:whole-shop'; }
    }
  }
  const touched = new Set(results.map((r) => r.url));
  for (const product of rows(catalog)) {
    if ((product.offers || []).some((o) => touched.has(o.url))) rollupProductStock(product, now);
  }
  return { catalog, summary, results };
}

module.exports = { planStockChecks, checkOfferStock, rollupProductStock, refreshStock, readStockPage, readPricePage, ageHours };
