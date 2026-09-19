// Search, once, for the whole site. Four rules:
//
//   1. Fold Turkish and drop words that identify nothing ("3d", "yazıcı", "fiyat"), so
//      "yazici" finds "Yazıcı" and "K2 PLUS COMBO 3D YAZICI" is just the tokens k2/plus/combo.
//   2. A token matches the row's own words, or an offer's scraped title / shop / URL — the row
//      name alone is not enough (a branched row may be named from a slug).
//   3. Rank: name matches beat offer matches, and the earlier the token sits in the name the
//      better. Exact queries come first.
//   4. Recall: a query with extra words must not hide the family. "k2 pro" still shows the
//      K2 Plus, ranked below the rows that really say "pro" — strict filtering lost it, and
//      that is the bug this file exists to prevent.
//
// Browsers cannot require this file, so public/js/app.js and public/admin/admin.js mirror it.

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

const words = (text) => fold(String(text || '')).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

// One edit apart, for typos on words long enough that a coincidence is unlikely.
function near(a, b) {
  if (a === b) return true;
  if (a.length < 4 || b.length < 4 || Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    // Two neighbouring letters swapped is one mistake to a person: "plsu" for "plus".
    if (a[i] === b[j + 1] && a[i + 1] === b[j]) { edits++; i += 2; j += 2; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

const tokenHits = (token, list) =>
  list.some((w) => w === token || w.startsWith(token) || near(w, token));

// Everything a shopper could search by: the row, and every offer's own words.
function searchHaystack(product) {
  const offers = product && product.offers ? product.offers : [];
  return [
    product && product.name,
    product && product.brand,
    product && product.polymer,
    product && product.variant,
    product && product.color,
    product && product.unit,
    product && product.aisle,
    ...offers.flatMap((o) => [o.store, o.sourceTitle, String(o.url || '').split('/').filter(Boolean).pop()])
  ].filter(Boolean).join(' ');
}

const nameOf = (product) => String((product && (product.name || product.title)) || '');

// 0 = no. 30 = some words matched ("related" — shown, ranked last). 60 = every word matched
// somewhere. 80-100 = every word matched in the name itself, best when it starts there.
function searchScore(product, query) {
  const wanted = searchTokens(query);
  if (!wanted.length) return { score: 1, matched: 0, total: 0, inName: 0, exact: false };
  const name = nameOf(product);
  const nameWords = words(name);
  const hayWords = words(searchHaystack(product));
  const inName = wanted.filter((t) => tokenHits(t, nameWords)).length;
  const anywhere = wanted.filter((t) => tokenHits(t, hayWords)).length;
  const foldedName = fold(name);
  const foldedQuery = fold(query).trim();
  const exact = foldedName === foldedQuery || nameWords.join(' ') === wanted.join(' ');
  if (exact) return { score: 100, matched: wanted.length, total: wanted.length, inName, exact: true };
  if (inName === wanted.length) {
    // Prefer rows where the first word of the query appears early in the name.
    const first = nameWords.indexOf(wanted[0]);
    const boost = first === 0 ? 8 : first > 0 && first <= 2 ? 4 : 0;
    return { score: 80 + boost, matched: inName, total: wanted.length, inName, exact: false };
  }
  if (anywhere === wanted.length) return { score: 60, matched: anywhere, total: wanted.length, inName, exact: false };
  // Related: at least half the words (and never just one of many) are there.
  const enough = anywhere >= Math.max(1, Math.ceil(wanted.length / 2));
  if (enough && anywhere > 0) return { score: 30 + anywhere, matched: anywhere, total: wanted.length, inName, exact: false };
  return { score: 0, matched: anywhere, total: wanted.length, inName, exact: false };
}

// Strict: every word must be present somewhere. This is what the API and the admin use, so a
// cleanup search stays precise. A query of nothing but filler words ("3d yazıcı") is a category
// request, not a filter, so it matches everything.
function matchesSearch(product, query) {
  const s = searchScore(product, query);
  if (s.total === 0) return true;
  return s.score >= 60;
}

// Ranked with recall: what the storefront shows. Related rows are included, below the matches.
function rankSearch(list, query) {
  return (list || [])
    .map((p) => ({ p, s: searchScore(p, query) }))
    .filter(({ s }) => s.score > 0)
    .sort((a, b) => b.s.score - a.s.score || String(nameOf(a.p)).localeCompare(String(nameOf(b.p))))
    .map(({ p }) => p);
}

const filterSearch = (list, query) => (list || []).filter((p) => matchesSearch(p, query));

module.exports = { searchTokens, searchHaystack, searchScore, matchesSearch, filterSearch, rankSearch, SEARCH_STOP };
