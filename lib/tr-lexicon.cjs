// Turkish shop phrases. Grow this when a model hallucinates a translation.
// Stoktan Teslim = ships from stock = in stock. Tükendi = sold out.

const STOCK_RULES = [
  [/[oö]n\s*sipari[sş]|pre-?order/i, 'preorder'],
  [/dropshipping/i, 'dropshipping'],
  [/stoktan\s*teslim|sepete\s*ekle|add\s*to\s*cart|\bin stock\b/i, 'in_stock'],
  [/t[uü]kendi|stokta yok|sold out|out of stock|gelince\s*haber|t[uü]kenmi[sş]/i, 'out_of_stock'],
  [/\bstokta\b/i, 'in_stock']
];

function isBuyableStock(status) {
  return status !== 'out_of_stock';
}

// Labels for listing "in stock only" controls — match visible text, never invent URLs.
const IN_STOCK_FILTER_LABEL = /sadece\s*stok|stoktakiler|stokta\s*olan|in\s*stock|available\s*only|var\s*olan|stokta(?!\s*yok)/i;

const VAT_INCLUDED = /kdv\s*dahil|vergiler\s*dahil/i;
const VAT_EXCLUDED = /kdv\s*hari[cç]|\+\s*kdv|kdv\s*ilave/i;

function foldStock(raw) {
  return String(raw || '').toLocaleLowerCase('tr')
    .replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ç/g, 'c')
    .replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ö/g, 'o');
}

function stockFromText(raw) {
  const orig = String(raw || '');
  const t = foldStock(orig);
  if (!t) return 'unknown';
  const preorder = /[oö]n\s*sipari[sş]|pre-?order/i.test(orig) || /on siparis|preorder/.test(t);
  const cart = /sepete\s*ekle|add\s*to\s*cart|addtocart/i.test(orig);
  if (preorder) return 'preorder';
  if (cart) return 'in_stock';
  for (const [re, status] of STOCK_RULES) {
    if (re.test(t) || re.test(orig)) return status;
  }
  return 'unknown';
}

function vatFromText(raw) {
  const s = String(raw || '');
  if (VAT_INCLUDED.test(s)) return 'included';
  if (VAT_EXCLUDED.test(s)) return 'excluded';
  return 'unknown';
}

module.exports = { STOCK_RULES, VAT_INCLUDED, VAT_EXCLUDED, IN_STOCK_FILTER_LABEL, stockFromText, vatFromText, foldStock, isBuyableStock };
