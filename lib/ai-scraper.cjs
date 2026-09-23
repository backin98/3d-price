// Self-hosted product extractor: fetch (Playwright if installed) → strip DOM → local Gemma JSON.
// Never invents a price: Gemma output is kept only when that number appears on the page.

const { parseMoney, pickPrice, withVat } = require('./parse-money.cjs');
const { extractIdentity, readStockFromHtml } = require('./harvest.js');
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
      let loadedMore = false;
      try {
        loadedMore = await page.evaluate(`(() => {
          const nodes = [...document.querySelectorAll('a, button')];
          const el = nodes.find((n) => {
            const t = ((n.getAttribute('aria-label') || '') + ' ' + (n.textContent || '')).toLowerCase();
            return /daha fazla|load more|daha fazla ürün/.test(t) && n.offsetParent;
          });
          if (!el) return false;
          el.click();
          return true;
        })()`) === true;
      } catch { loadedMore = false; }
      if (loadedMore) {
        stable = 0;
        await sleep(pauseMs, signal);
        continue;
      }
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

// One Chromium for the whole worker process. Opening a browser per product page
// was most of the wait after the first category page, and it did not change what we read.
let sharedBrowser = null;
let sharedLaunch = null;

async function browserFor(signal) {
  if (signal && signal.aborted) throw (signal.reason || Error('Stopped'));
  if (sharedBrowser && sharedBrowser.isConnected()) return sharedBrowser;
  if (!sharedLaunch) {
    sharedLaunch = (async () => {
      let playwright;
      try { playwright = require('playwright'); } catch { playwright = null; }
      if (!playwright || !playwright.chromium) throw Error('no playwright');
      const browser = await playwright.chromium.launch({
        headless: true,
        args: ['--disable-blink-features=AutomationControlled', '--no-sandbox']
      });
      sharedBrowser = browser;
      return browser;
    })().finally(() => { sharedLaunch = null; });
  }
  return sharedLaunch;
}

function needsDeeperScroll(url, html) {
  return listingPageUrls(url, html).length === 0;
}

async function fetchHtml(url, signal, opts = {}) {
  const scroll = opts.scroll !== false;
  let browser = null;
  try { browser = await browserFor(signal); } catch { browser = null; }
  if (browser) {
    const context = await browser.newContext({
      userAgent: UA,
      locale: 'tr-TR',
      extraHTTPHeaders: { 'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.7' }
    });
    const onAbort = () => { context.close().catch(() => {}); };
    if (signal) {
      if (signal.aborted) throw (signal.reason || Error('Stopped'));
      signal.addEventListener('abort', onAbort, { once: true });
    }
    try {
      const page = await context.newPage();
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
      if (opts.waitForStock) {
        await page.waitForFunction(() => /sepete\s*ekle|add\s*to\s*cart|ön\s*sipariş|pre-?order|tükendi|stokta\s*yok|out\s*of\s*stock/i.test(document.body?.innerText || ''), null, { timeout: 8000 }).catch(() => {});
        await sleep(400, signal);
      }
      // Do not click shop "Sadece Stoktakiler" filters: they also hide
      // add-to-cart preorder items. We drop true Tükendi in harvest instead.
      if (scroll) {
        await handleInfiniteScroll(page, {
          maxScrolls: opts.maxScrolls || 8,
          pauseMs: opts.pauseMs || 800,
          signal
        });
        // Some category pages have no page 2. They only reveal more products as you scroll.
        if (opts.extendIfNoPager) {
          const soFar = await page.content();
          if (needsDeeperScroll(url, soFar)) {
            const more = await handleInfiniteScroll(page, {
              maxScrolls: opts.extraScrolls || 28,
              pauseMs: opts.pauseMs || 800,
              signal
            });
            if (typeof opts.onNote === 'function') {
              opts.onNote('No second page — kept scrolling this category (' + (more.productCount || 0) + ' product cards visible).');
            }
          }
        }
      }
      return await page.content();
    } finally {
      if (signal) signal.removeEventListener('abort', onAbort);
      await context.close().catch(() => {});
    }
  }
  const res = await fetch(url, {
    redirect: 'follow',
    headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8' },
    signal: signal ? AbortSignal.any([AbortSignal.timeout(25000), signal]) : AbortSignal.timeout(25000)
  });
  if (!res.ok) throw Error('Fetch HTTP ' + res.status);
  return res.text();
}

function sameListingUrl(a, b) {
  try { return new URL(a).href === new URL(b).href; } catch { return a === b; }
}

const PAGE_KEYS = ["sayfa", "page", "paged", "pg", "tp", "p"];

function inferPagePattern(page1, page2) {
  let a;
  let b;
  try { a = new URL(page1); b = new URL(page2); } catch { return null; }
  if (a.origin !== b.origin || a.href === b.href) return null;
  for (const key of PAGE_KEYS) {
    const hasA = a.searchParams.has(key);
    const hasB = b.searchParams.has(key);
    if (!hasB) continue;
    const va = hasA ? Number(a.searchParams.get(key)) : 1;
    const vb = Number(b.searchParams.get(key));
    if (!Number.isFinite(va) || !Number.isFinite(vb) || va === vb) continue;
    const step = vb - va;
    if (!step) continue;
    return { type: "query", key, start: va, step, href: b.href };
  }
  const parsePath = (p) => {
    const named = String(p || "").match(/^(.*\/)(page|sayfa)\/(\d+)\/?$/i);
    if (named) return { prefix: named[1], word: named[2], n: Number(named[3]) };
    const tail = String(p || "").match(/^(.*\/)(\d+)\/?$/);
    if (tail) return { prefix: tail[1], word: "", n: Number(tail[2]) };
    return null;
  };
  const pa = parsePath(a.pathname);
  const pb = parsePath(b.pathname);
  if (pb && Number.isFinite(pb.n)) {
    const start = pa && Number.isFinite(pa.n) ? pa.n : (pb.n >= 2 ? pb.n - 1 : 1);
    const step = pb.n - start;
    if (step) return { type: "path", prefix: pb.prefix, word: pb.word, start, step, search: b.search, origin: b.origin };
  }
  return null;
}

function pageUrlAt(pattern, pageIndex, page1Url) {
  if (!pattern || pageIndex < 1) return null;
  if (pageIndex === 1 && page1Url) return page1Url;
  const n = pattern.start + (pageIndex - 1) * pattern.step;
  if (pattern.type === "query") {
    const u = new URL(pattern.href);
    u.searchParams.set(pattern.key, String(n));
    return u.href;
  }
  const mid = pattern.word ? pattern.word + "/" + n : String(n);
  return pattern.origin + pattern.prefix + mid + "/" + (pattern.search || "");
}

function pageNumberFromUrl(pattern, url, page1Url) {
  if (!pattern || !url) return null;
  if (page1Url && sameListingUrl(url, page1Url)) return 1;
  const u = new URL(url, pattern.href || pattern.origin);
  if (pattern.type === "query") {
    if (!u.searchParams.has(pattern.key)) return 1;
    const val = Number(u.searchParams.get(pattern.key));
    if (!Number.isFinite(val)) return null;
    return Math.round((val - pattern.start) / pattern.step) + 1;
  }
  const re = pattern.word ? new RegExp((pattern.word || "page") + "/(\\d+)", "i") : /\/(\d+)\/?$/;
  const m = u.pathname.match(re);
  if (!m) return 1;
  return Math.round((Number(m[1]) - pattern.start) / pattern.step) + 1;
}

function nextPageUrl(pattern, currentUrl, page1Url) {
  const idx = pageNumberFromUrl(pattern, currentUrl, page1Url);
  if (!idx || idx >= 40) return null;
  const next = pageUrlAt(pattern, idx + 1, page1Url);
  if (!next || sameListingUrl(next, currentUrl)) return null;
  return next;
}

function listingPageUrls(url, html) {
  const raw = String(html || '');
  const base = new URL(url);
  const out = [];
  const add = (href) => {
    try {
      const n = new URL(href, base);
      if (n.origin !== base.origin) return;
      n.hash = "";
      if (sameListingUrl(n.href, base.href) || out.includes(n.href)) return;
      out.push(n.href);
    } catch { /* ignore bad href */ }
  };

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

  for (const m of raw.matchAll(/<(?:link|a)\b[^>]*rel=["']next["'][^>]*>/gi)) {
    const href = m[0].match(/href=["']([^"']+)/i);
    if (href) add(href[1]);
  }
  for (const m of raw.matchAll(/<a\b([^>]*)>([\s\S]{0,160}?)<\/a>/gi)) {
    const label = String(m[2] || "").replace(/<[^>]+>/g, " ");
    if (!/\bsonraki\b|\bnext\b|daha fazla|ileri|›|»|&gt;&gt;/i.test(label) && !/\brel=["']next["']/i.test(m[1] || "")) continue;
    const href = String(m[1] || "").match(/href=["']([^"']+)/i);
    if (href && !/^javascript:/i.test(href[1]) && href[1] !== "#") add(href[1]);
  }

  const PARAMS = ["sayfa", "page", "paged", "pg", "tp", "p"];
  let max = 1;
  const re = /[?&](sayfa|page|paged|pg|tp|p)=(\d+)/gi;
  let m;
  while ((m = re.exec(raw))) max = Math.max(max, Number(m[2]) || 1);
  const pathPages = [...raw.matchAll(/\/(?:page|sayfa)\/(\d+)/gi)].map((x) => Number(x[1])).filter((n) => n > 0);
  if (pathPages.length) max = Math.max(max, ...pathPages);
  if (total > 8 && !tsoft) max = Math.max(max, Math.ceil(total / 24));
  max = Math.min(max, 40);
  const key = PARAMS.find((k) => new RegExp("[?&]" + k + "=", "i").test(raw) || base.searchParams.has(k)) || "";
  const current = Number((key && base.searchParams.get(key)) || (base.pathname.match(/\/(?:page|sayfa)\/(\d+)/i) || [])[1] || 1) || 1;
  if (key) {
    const start = Math.max(2, current + 1);
    const until = Math.max(max, current);
    for (let i = start; i <= until && i <= 40; i++) {
      const next = new URL(base.href);
      next.searchParams.set(key, String(i));
      add(next.href);
      if (i >= current + 8) break;
    }
  } else if (/\/(?:page|sayfa)\/\d+/i.test(raw + base.pathname)) {
    const prefix = base.pathname.replace(/\/(?:page|sayfa)\/\d+\/?$/i, "/") || "/";
    const word = /sayfa/i.test(base.pathname + raw) ? "sayfa" : "page";
    add(new URL(prefix.replace(/\/+$/, "") + "/" + word + "/" + (current + 1) + "/", base).href);
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
  inferPagePattern,
  nextPageUrl,
  pageUrlAt,
  handleInfiniteScroll,
  needsDeeperScroll,
  detectCurrency,
  priceOnPage,
  listingFromExtract,
  scrapeProduct,
  EXTRACT_SCHEMA
};
