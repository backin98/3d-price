// Live stock re-check. The harvest knows how to read stock from a page (badge, "tükendi",
// sepete ekle, stok miktarı); this re-runs that reading against the product pages we already
// linked, long after the run that discovered them, so a vendor that ran out drops out of the
// comparison instead of showing a stale price forever.
const { fold } = require('./product-match.cjs');

const stripTags = (html) => String(html || '')
  .replace(/<(script|style|svg)[\s\S]*?<\/>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;|&#160;/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const OOS = /tukendi|stokta yok|sold out|out of stock|gelince haber|stoklara gelince/;
const IN = /sepete ekle|add to cart|sepeteekle|addtocart|stok durumu var|stoktan teslim/;

// Page level stock, deliberately conservative. A product page also mentions "tükendi" in
// recommendations and "ön sipariş" in menus, so only structured data or the buy box counts —
// a stray string must never take a whole vendor out of the comparison.
// A status we could actually read. "unknown"/"missing" means no answer, not a verified answer.
function isResolvedStatus(s) {
  return s === "in_stock" || s === "out_of_stock" || s === "preorder" || s === "dropshipping";
}

function readStockPage(html) {
  const raw = String(html || '');
  const structured = raw.match(/"availability"\s*:\s*"[^"]*(OutOfStock|SoldOut|PreOrder|InStock|LimitedAvailability|BackOrder|OutOfStock)/i)
    || raw.match(/itemprop=["']availability["'][^>]*?(?:href|content)=["'][^"']*(OutOfStock|InStock|PreOrder|BackOrder)/i);
  if (structured) {
    const word = String(structured[1]).toLowerCase();
    if (/outofstock|soldout/.test(word)) return { status: 'out_of_stock', verified: true, method: 'structured' };
    if (/preorder|backorder/.test(word)) return { status: 'preorder', verified: true, method: 'structured' };
    if (/instock|limitedavailability/.test(word)) return { status: 'in_stock', verified: true, method: 'structured' };
  }
  const at = (() => {
    const m = raw.match(/sepete\s*ekle|add\s*to\s*cart|sepetekle|addtocart|btn_sepet_ekle/i);
    if (m) return m.index;
    return -1;
  })();
  const price = raw.search(/\d{1,3}(?:\.\d{3})+(?:,\d{2})?\s*(?:TL|₺)/i);
  const anchor = at >= 0 ? at : price;
  if (anchor >= 0) {
    // Tight window on purpose: recommendation cards carry their own "Sepete Ekle" and their
    // own "Tükendi", and neither says anything about this product.
    const box = fold(stripTags(raw.slice(Math.max(0, anchor - 400), anchor + 400)));
    if (OOS.test(box)) return { status: 'out_of_stock', verified: true, method: 'buy-box' };
    if (IN.test(box)) return { status: 'in_stock', verified: true, method: 'buy-box' };
  }
  // No buy box found: believe "out of stock" only when the page offers no cart at all.
  const all = fold(stripTags(raw));
  if (OOS.test(all) && !IN.test(all) && !/sepet/i.test(all)) {
    return { status: 'out_of_stock', verified: true, method: 'page-no-cart' };
  }
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

async function checkOfferStock(url, { fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT, retries = RETRIES } = {}) {
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
      const read = readStockPage(html);
      // Conflicting signals mean we do not know: a page that says "sold out" in one place and
      // InStock in another is exactly the laggy-shop case, and guessing is worse than waiting.
      if (read.status === 'out_of_stock' && /"availability"\s*:\s*"[^"]*InStock/i.test(html) && read.method === 'buy-box') {
        return { status: 'unknown', quantity: null, verified: false, method: 'conflicting-signals' };
      }
      return { status: read.status, quantity: null, verified: read.verified === true, method: read.method };
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
async function refreshStock({ catalog, limit = 40, staleHours = 12, now = Date.now(), budgetMs = DEFAULT_BUDGET, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT, onProgress } = {}) {
  const planned = planStockChecks(catalog, { staleHours, now, limit: Number.MAX_SAFE_INTEGER });
  const targets = planned.targets.slice(0, Math.max(0, limit));
  const deadline = now + Math.max(1000, budgetMs);
  const summary = { stale: planned.total, planned: targets.length, checked: 0, changed: 0, outOfStock: 0, unverified: 0, skipped: 0, guarded: 0 };
  const results = [];
  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    if (Date.now() > deadline) {
      summary.skipped = targets.length - i;
      break;
    }
    const batch = targets.slice(i, i + CONCURRENCY);
    const read = await Promise.all(batch.map((t) => checkOfferStock(t.offer.url, { fetchImpl, timeoutMs })));
    batch.forEach((t, k) => {
      const r = read[k];
      const before = t.offer.stockStatus || 'unknown';
      Object.assign(t.offer, {
        stockStatus: r.status,
        stockQuantity: r.quantity === undefined ? null : r.quantity,
        stockVerified: r.verified,
        stockCheckedAt: new Date().toISOString(),
        stockCheckMethod: r.method,
        stockPolicyVersion: 3
      });
      summary.checked += 1;
      if (before !== r.status) summary.changed += 1;
      if (before !== 'out_of_stock' && r.status === 'out_of_stock') summary.outOfStock += 1;
      if (!r.verified) summary.unverified += 1;
      results.push({ url: t.offer.url, store: t.offer.store, before, after: r.status, method: r.method });
      if (onProgress) onProgress({ url: t.offer.url, before, after: r.status });
    });
  }
  // If every offer of one shop came back dead in the same pass, suspect the parser (a
  // redesign, a block page) rather than believing a whole vendor vanished. Keep it unknown.
  const perStore = new Map();
  for (const r of results) {
    const key = r.store || '';
    const row = perStore.get(key) || { dead: 0, total: 0 };
    row.total += 1;
    if (r.after === 'out_of_stock') row.dead += 1;
    perStore.set(key, row);
  }
  const suspect = new Set();
  for (const [key, row] of perStore) {
    if (row.total >= 3 && row.dead === row.total) suspect.add(key);
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

module.exports = { planStockChecks, checkOfferStock, rollupProductStock, refreshStock, readStockPage, ageHours };
