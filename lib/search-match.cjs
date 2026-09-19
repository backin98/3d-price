// Search, once. Three things were wrong with the old "is the whole query inside the name?"
// check, all visible on a branched row named "creality k2 plus combo" from a URL slug:
//
//   * a family query ("Creality K2 Plus Combo 3D Yazıcı") is longer than the name, so it never
//     matched even though the row plainly is that product;
//   * the offers' scraped titles and URLs were not searched at all, so nothing recovered it;
//   * Turkish was not folded, so "yazici" never matched "Yazıcı".
//
// Now: fold, drop words that carry no product meaning, and require every remaining token to
// appear somewhere in the row OR its offers. Client code mirrors this in public/js/app.js and
// public/admin/admin.js (browsers cannot require this file).

const { fold } = require('./product-match.cjs');

// Words that appear on nearly every listing and so identify nothing.
const SEARCH_STOP = new Set([
  '3d', 'yazici', 'printer', 'fiyat', 'fiyati', 'inceleme', 'yorum', 'stok', 'stoktan', 'stokta',
  've', 'ile', 'the', 'and', 'with', 'for', 'adet', 'urun', 'urunu', 'model', 'makine', 'makinesi',
  'kutu', 'hediyeli', 'indirimli', 'kampanya', 'yeni', 'new', 'sifir', 'orijinal', 'tl', 'try'
]);

const searchTokens = (query) =>
  fold(String(query || ''))
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t && !SEARCH_STOP.has(t));

// Everything a shopper could plausibly search by: the row, and every offer's own words.
function searchHaystack(product) {
  const offers = product && product.offers ? product.offers : [];
  const parts = [
    product && product.name,
    product && product.brand,
    product && product.polymer,
    product && product.variant,
    product && product.color,
    product && product.unit,
    product && product.aisle,
    ...offers.flatMap((o) => [o.store, o.sourceTitle, String(o.url || '').split('/').filter(Boolean).pop()])
  ];
  return fold(parts.filter(Boolean).join(' '));
}

function matchesSearch(product, query) {
  const wanted = searchTokens(query);
  if (!wanted.length) return true;
  const hay = searchHaystack(product);
  return wanted.every((t) => hay.includes(t));
}

const filterSearch = (list, query) => (list || []).filter((p) => matchesSearch(p, query));

module.exports = { searchTokens, searchHaystack, matchesSearch, filterSearch, SEARCH_STOP };
