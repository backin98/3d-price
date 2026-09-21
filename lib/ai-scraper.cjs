// Self-hosted product extractor: fetch (Playwright if installed) → strip DOM → local Gemma JSON.
// Never invents a price: Gemma output is kept only when that number appears on the page.

const { parseMoney, pickPrice, withVat } = require('./parse-money.cjs');
const { extractIdentity, readStockFromHtml } = require('./harvest.js');
const { discoverInStockFilter } = require('./harvest-guards.cjs');
const { ask, setEndpoint } = require('../scripts/local-qwen.cjs');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const EXTRACT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['product_title', 'raw_price', 'currency', 'full_price', 'detected_language', 'translated_title_en', 'availability'],
  properties: {
    product_title: { type: 'string' },
    raw_price: {},
    currency: { type: 'string' },
    full_price: {},
    detected_language: { type: 'string' },
    translated_title_en: { type: 'string' },
    availability: { type: 'boolean' }
  }
};

function stripDom(html) {
  return String(html || '')
    .replace(/<(script|style|noscript|svg|iframe|footer|nav|header)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 12000);
}

function detectCurrency(text) {
  const t = String(text || '');
  if (/₺|\bTRY\b|\bTL\b|\bTÜRK LİRASI\b/i.test(t)) return 'TRY';
  if (/€|\bEUR\b/.test(t)) return 'EUR';
  if (/£|\bGBP\b/.test(t)) return 'GBP';
  if (/\$|\bUSD\b|\bUS\$/.test(t)) return 'USD';
  return 'TRY';
}

function priceOnPage(html, amount) {
  if (!Number.isFinite(amount) || amount <= 0) return false;
  const text = stripDom(html);
  const n = parseMoney(amount);
  if (!n) return false;
  const variants = new Set([
    n.toFixed(2).replace('.', ','),
    n.toFixed(2)
  ]);
  if (n >= 100) variants.add(String(Math.round(n)));
  const dotted = Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  if (n >= 1000) {
    variants.add(dotted);
    variants.add(dotted + ',00');
  }
  return [...variants].some((v) => v.length >= 3 && text.includes(v));
}

const PRODUCT_COUNT_JS = `document.querySelectorAll('.product-item,.product-card,[data-product-id],li.product,article.product,.card-product,.product-listing').length`;

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    if (!signal) return;
    const onAbort = () => { clearTimeout(t); reject(signal.reason || Error('Stopped')); };
    if (signal.aborted) return onAbort();
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function handleInfiniteScroll(page, opts = {}) {
  const maxScrolls = Number(opts.maxScrolls) > 0 ? Number(opts.maxScrolls) : 15;
  const pauseMs = Number(opts.pauseMs) > 0 ? Number(opts.pauseMs) : 2000;
  const signal = opts.signal;
  let previousHeight = Number(await page.evaluate('document.body.scrollHeight')) || 0;
  let previousCount = Number(await page.evaluate(PRODUCT_COUNT_JS)) || 0;
  let stable = 0;
  let attempts = 0;
  while (attempts < maxScrolls) {
    if (signal && signal.aborted) throw (signal.reason || Error('Stopped'));
    attempts += 1;
    try {
      await page.evaluate(`(() => {
        const step = Math.max(window.innerHeight || 800, 600);
        window.scrollBy(0, step);
        const nodes = document.querySelectorAll('.product-item,.product-card,[data-product-id],li.product,article.product,.card-product');
        const last = nodes[nodes.length - 1];
        if (last && last.scrollIntoView) last.scrollIntoView({ block: 'end' });
        window.scrollTo(0, document.body.scrollHeight);
      })()`);
    } catch (err) {
      return { attempts, productCount: previousCount, height: previousHeight, error: err.message || 'scroll evaluate failed' };
    }
    if (page.mouse && typeof page.mouse.wheel === 'function') {
      try { await page.mouse.wheel(0, 1400); } catch { /* wheel is optional */ }
    }
    await sleep(pauseMs, signal);
    const height = Number(await page.evaluate('document.body.scrollHeight')) || previousHeight;
    const count = Number(await page.evaluate(PRODUCT_COUNT_JS)) || previousCount;
    if (height <= previousHeight && count <= previousCount) {
      stable += 1;
      if (stable >= 2) break;
    } else {
      stable = 0;
    }
    previousHeight = Math.max(previousHeight, height);
    previousCount = Math.max(previousCount, count);
  }
  return { attempts, productCount: previousCount, height: previousHeight };
}

async function applyInStockFilterOnPage(page) {
  const countUrun = async () => page.evaluate(`document.querySelectorAll('a[href*="/urun/"], a[href*="/products/"]').length`);
  const before = await countUrun();
  const phrases = ['Sadece Stoktakiler', 'Sadece stokta', 'Stokta olanlar', 'In stock only'];
  for (const phrase of phrases) {
    try {
      const loc = page.getByText(phrase, { exact: true });
      if (!(await loc.count())) continue;
      await loc.first().click({ timeout: 2500 });
      await sleep(900);
      const after = await countUrun();
      if (after === 0 && before > 0) {
        await page.goBack({ waitUntil: 'domcontentloaded', timeout: 8000 }).catch(() => {});
        return null;
      }
      return { type: 'click', label: phrase };
    } catch { /* next phrase */ }
  }
  return null;
}

async function fetchHtml(url, signal, opts = {}) {
  const scroll = opts.scroll !== false;
  let playwright;
  try { playwright = require('playwright'); } catch { playwright = null; }
  if (playwright && playwright.chromium) {
    const browser = await playwright.chromium.launch({
      headless: true,
      args: ['--disable-blink-features=AutomationControlled', '--no-sandbox']
    });
    const onAbort = () => { browser.close().catch(() => {}); };
    if (signal) {
      if (signal.aborted) throw (signal.reason || Error('Stopped'));
      signal.addEventListener('abort', onAbort, { once: true });
    }
    try {
      const page = await browser.newPage({
        userAgent: UA,
        locale: 'tr-TR',
        extraHTTPHeaders: { 'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.7' }
      });
      try {
        console.log('goto', url);
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
        console.log('goto done', url);
      } catch (err) {
        console.log('goto failed', url, err.message);
        throw err;
      }
      try {
        await page.waitForSelector('.product-item, .product-card, .card-product, li.product, article.product, h1', { timeout: 8000 });
      } catch { /* keep going */ }
      // Do not click shop "Sadece Stoktakiler" filters: they also hide
      // add-to-cart preorder items. We drop true Tükendi in harvest instead.
      if (scroll) {
        await handleInfiniteScroll(page, {
          maxScrolls: opts.maxScrolls || 8,
          pauseMs: opts.pauseMs || 800,
          signal
        });
      }
      return await page.content();
    } finally {
      if (signal) signal.removeEventListener('abort', onAbort);
      await browser.close().catch(() => {});
    }
  }
  const res = await fetch(url, {
    redirect: 'follow',
    headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8' },
    signal: signal ? AbortSignal.any([AbortSignal.timeout(25000), signal]) : AbortSignal.timeout(25000)
  });
  if (!res.ok) throw Error('Fetch HTTP ' + res.status);
  let html = await res.text();
  if (opts.discoverStock) {
    const found = discoverInStockFilter(html, url);
    if (found && found.type === 'link' && found.href && found.href !== url) {
      const filtered = await fetchHtml(found.href, signal, { ...opts, discoverStock: false });
      const n = (filtered.match(/\/urun\/|\/products\//g) || []).length;
      const orig = (html.match(/\/urun\/|\/products\//g) || []).length;
      if (n === 0 && orig > 0) return html;
      return filtered;
    }
  }
  return html;
}

function listingPageUrls(url, html) {
  const raw = String(html || '');
  const base = new URL(url);
  const totals = [
    ...raw.matchAll(/Toplam\s*<span[^>]*>\s*(\d+)/gi),
    ...raw.matchAll(/Toplam[\s\S]{0,80}?(\d{2,4})\s*ürün/gi)
  ].map((x) => Number(x[1])).filter((n) => n > 0);
  const total = totals.length ? Math.max(...totals) : 0;
  const itemCount = (raw.match(/mb-2 product-item/g) || []).length
    || (raw.match(/class="[^"]*product-item/g) || []).length;
  const tsoft = /metatechtr/i.test(base.hostname) || /mb-2 product-item/.test(raw);
  if (tsoft && total > itemCount && itemCount > 0) {
    const cur = Number(base.searchParams.get('ps') || itemCount);
    const nextPs = Math.min(Math.max(total, 14), Math.max(cur, itemCount) + 8);
    if (nextPs > cur) {
      const n = new URL(base.href);
      n.searchParams.delete('pg');
      n.searchParams.set('ps', String(nextPs));
      return [n.href];
    }
    return [];
  }
  let max = 1;
  const re = /[?&](sayfa|page|tp|pg)=(\d+)/gi;
  let m;
  while ((m = re.exec(raw))) max = Math.max(max, Number(m[2]) || 1);
  if (total > 8 && !tsoft) max = Math.max(max, Math.ceil(total / 24));
  max = Math.min(max, 40);
  const key = /[?&]sayfa=/i.test(raw) ? 'sayfa' : /[?&]tp=/i.test(raw) ? 'tp' : /[?&]page=/i.test(raw) ? 'page' : 'pg';
  const out = [];
  for (let i = 2; i <= max; i++) {
    const next = new URL(base.href);
    next.searchParams.set(key, String(i));
    out.push(next.href);
  }
  return out;
}

async function fetchListingHtml(url, signal, opts = {}) {
  const first = await fetchHtml(url, signal, { scroll: true, maxScrolls: opts.maxScrolls || 15, pauseMs: opts.pauseMs || 2000 });
  const extras = listingPageUrls(url, first);
  const parts = [first];
  for (const next of extras) {
    try {
      parts.push(await fetchHtml(next, signal, { scroll: true, maxScrolls: 3, pauseMs: 800 }));
    } catch { /* one extra page failing still keeps the rest */ }
  }
  return parts.join('\n');
}

function listingFromExtract(url, html, gem, jobKind) {
  const picked = pickPrice(html, gem && gem.raw_price);
  let price = picked.price || parseMoney(gem && gem.full_price) || parseMoney(gem && gem.raw_price);
  if (!price || !priceOnPage(html, price)) throw Error('Price evidence validation failed');
  const currency = detectCurrency(html + ' ' + (gem && gem.currency || ''));
  if (picked.plusVat) price = withVat(price, 'excluded');
  const name = String((gem && gem.product_title) || '').replace(/\s+[-–]\s*(STOKTAN|Dropshipping|ÖN SİPARİŞ).*$/i, '').trim();
  if (!name) throw Error('Incomplete deterministic product evidence');
  const id = extractIdentity(name);
  const stock = readStockFromHtml(html);
  const available = stock.verified
    ? stock.status !== 'out_of_stock'
    : gem && gem.availability === false ? false : stock.status !== 'out_of_stock';
  return {
    url,
    name,
    brand: id.brand || '',
    kind: jobKind === 'filament' || jobKind === 'printer' ? jobKind : (id.kind || 'printer'),
    price,
    currency,
    raw_price: gem.raw_price,
    full_price: price,
    detected_language: String((gem && gem.detected_language) || 'tr').slice(0, 8).toLowerCase(),
    translated_title_en: String((gem && gem.translated_title_en) || name).slice(0, 300),
    availability: available,
    image: ((html.match(/property=["']og:image["'][^>]+content=["']([^"']+)/i) || html.match(/content=["']([^"']+)["'][^>]+property=["']og:image["']/i) || [])[1] || ''),
    polymer: id.polymer || '',
    variant: id.variant || '',
    color: id.color || '',
    weight: id.weight || '',
    diameter: id.diameter || '',
    packaging: id.packaging || '',
    stockStatus: available ? (stock.status || 'in_stock') : 'out_of_stock',
    vatIncluded: true,
    was: picked.was,
    extractor: 'gemma'
  };
}

async function scrapeProduct(url, opts = {}) {
  const html = opts.html || await fetchHtml(url, opts.signal, { scroll: opts.scroll === true, maxScrolls: opts.maxScrolls || 3 });
  const text = stripDom(html);
  if (text.length < 40) throw Error('Page text too thin to extract');
  if (opts.endpoint) setEndpoint(opts.endpoint);
  const gem = await ask('scrape-product', {
    instruction: 'Extract the MAIN product title and the current total selling price number as printed. Ignore monthly installments, Havale, struck list prices, and related products. Stoktan Teslim means IN STOCK. Tükendi means sold out. Do not invent a price that is not in the page text. Availability is optional; the parser will decide stock from badges.',
    url,
    text
  }, EXTRACT_SCHEMA, opts.dir || require('node:path').join(__dirname, '..', 'data', 'qwen-url-jobs', 'scrape'), opts.signal);
  return listingFromExtract(url, html, gem, opts.kind);
}

module.exports = {
  stripDom,
  fetchHtml,
  fetchListingHtml,
  listingPageUrls,
  handleInfiniteScroll,
  detectCurrency,
  priceOnPage,
  listingFromExtract,
  scrapeProduct,
  EXTRACT_SCHEMA
};
