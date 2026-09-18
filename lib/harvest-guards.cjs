// Shop-agnostic Collect guards. Apply before Magellan on every retailer.

function fold(s) {
  return String(s || '').toLocaleLowerCase('tr')
    .replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ç/g, 'c')
    .replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ö/g, 'o');
}

function isTemplateUrl(url) {
  const s = String(url || '');
  if (/\{\{|\}\}|%7B%7B|%7D%7D/i.test(s)) return true;
  try {
    const path = new URL(s, 'https://example.invalid').pathname.toLowerCase();
    if (/(?:^|\/)(?:\{\{)?(?:url|producturl|product_url)(?:\}\})?(?:\/|$)/i.test(path)) return true;
  } catch { /* ignore */ }
  return false;
}

function isListingUrl(url, categoryUrl) {
  const s = String(url || '');
  let u;
  try { u = new URL(s, categoryUrl || 'https://example.invalid'); } catch { return false; }
  const path = u.pathname.replace(/\/+$/, '').toLowerCase();
  const last = path.split('/').filter(Boolean).pop() || '';
  if (/anasayfa/i.test(last)) return true;
  if (categoryUrl) {
    try {
      const c = new URL(categoryUrl);
      if (u.origin === c.origin && path === c.pathname.replace(/\/+$/, '').toLowerCase()) return true;
    } catch { /* ignore */ }
  }
  if (/[?&](ps|pg|sayfa|page|tp)=\d+/i.test(u.search) && /yazicilar|filament|kategori|collections|urunler|markalar/i.test(path)) return true;
  return false;
}

function detectCurrency(html) {
  const h = String(html || '');
  const attr = (h.match(/data-currency=["']([^"']+)/i) || [])[1];
  if (attr) {
    const a = attr.toUpperCase();
    if (a === 'USD' || a === 'EUR' || a === 'TRY' || a === 'TL' || a === 'GBP') return a === 'TL' ? 'TRY' : a;
  }
  if (/€|\bEUR\b/.test(h)) return 'EUR';
  if (/(?:\$|USD|US\$)/.test(h) && !/₺|\bTL\b|\bTRY\b/.test(h)) return 'USD';
  if (/£|\bGBP\b/.test(h)) return 'GBP';
  if (/₺|\bTL\b|\bTRY\b/.test(h)) return 'TRY';
  return 'TRY';
}

function isJunkAmount(n, context) {
  if (!Number.isFinite(n) || n <= 0) return true;
  if (n === 1) return true;
  const t = fold(context);
  if ((n === 2500 || n === 119) && /kargo|uzeri|ucretsiz|aras kargo/.test(t)) return true;
  if (/2500\s*tl\s*uzeri|2\.500\s*tl\s*uzeri/.test(t) && n === 2500) return true;
  return false;
}

function canonicalizeCategoryUrl(url) {
  return String(url || '').replace(/\/3d-printers\/?(\?|$)/i, '/3d-yazicilar$1');
}

const { IN_STOCK_FILTER_LABEL, foldStock } = require('./tr-lexicon.cjs');

function discoverInStockFilter(html, pageUrl) {
  const raw = String(html || '');
  const anchors = [...raw.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)];
  for (const m of anchors) {
    const attrs = m[1] || '';
    const inner = String(m[2] || '').replace(/<[^>]+>/g, ' ');
    const title = ((attrs.match(/title=["']([^"']+)/i) || [])[1] || '') + ' ' + ((attrs.match(/aria-label=["']([^"']+)/i) || [])[1] || '');
    const label = foldStock(inner + ' ' + title);
    if (!IN_STOCK_FILTER_LABEL.test(label) && !IN_STOCK_FILTER_LABEL.test(inner + ' ' + title)) continue;
    const href = (attrs.match(/href=["']([^"']+)/i) || [])[1] || '';
    if (!href || href.startsWith('javascript:') || href === '#') continue;
    try {
      return { type: 'link', href: new URL(href, pageUrl || 'https://example.invalid').href, label: inner.trim().slice(0, 80) };
    } catch { /* skip */ }
  }
  const labeled = [...raw.matchAll(/<label\b([^>]*)>([\s\S]*?)<\/label>/gi)];
  for (const m of labeled) {
    const inner = String(m[2] || '').replace(/<[^>]+>/g, ' ');
    if (!IN_STOCK_FILTER_LABEL.test(inner) && !IN_STOCK_FILTER_LABEL.test(foldStock(inner))) continue;
    const forId = ((m[1] || '').match(/\bfor=["']([^"']+)/i) || [])[1];
    return { type: 'checkbox', forId: forId || '', label: inner.trim().slice(0, 80) };
  }
  return null;
}

module.exports = {
  isTemplateUrl,
  isListingUrl,
  detectCurrency,
  isJunkAmount,
  canonicalizeCategoryUrl,
  discoverInStockFilter
};
