// Cross-language price compare: Magellan identity on translated titles, money in TRY (and USD).

const { decidePair, score } = require('./product-match.cjs');

// Fallback FX vs TRY. Updated when Frankfurter answers; never blocks ranking.
const FALLBACK_TRY = { TRY: 1, USD: 41, EUR: 48, GBP: 55 };

function detectLang(text) {
  const t = String(text || '');
  if (/[äöüß]/i.test(t) || /\b(und|mit|für|drucker)\b/i.test(t)) return 'de';
  if (/[şğıöçü]/i.test(t) || /\b(yazıcı|filament|fiyat)\b/i.test(t)) return 'tr';
  if (/\b(impresora|filamento|precio)\b/i.test(t)) return 'es';
  return 'en';
}

function toTry(amount, currency, rates) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return null;
  const code = String(currency || 'TRY').toUpperCase();
  const table = rates || FALLBACK_TRY;
  const perTry = table[code];
  if (!perTry) return null;
  return Math.round((n * perTry) * 100) / 100;
}

function toUsd(amountTry, rates) {
  const usd = (rates || FALLBACK_TRY).USD;
  if (!amountTry || !usd) return null;
  return Math.round((amountTry / usd) * 100) / 100;
}

async function loadRates() {
  try {
    const r = await fetch('https://api.frankfurter.app/latest?from=TRY', { signal: AbortSignal.timeout(4000) });
    if (!r.ok) return { ...FALLBACK_TRY };
    const j = await r.json();
    const usd = j.rates && j.rates.USD;
    const eur = j.rates && j.rates.EUR;
    const gbp = j.rates && j.rates.GBP;
    return {
      TRY: 1,
      USD: usd ? 1 / usd : FALLBACK_TRY.USD,
      EUR: eur ? 1 / eur : FALLBACK_TRY.EUR,
      GBP: gbp ? 1 / gbp : FALLBACK_TRY.GBP
    };
  } catch {
    return { ...FALLBACK_TRY };
  }
}

function asListing(x) {
  return {
    id: x.id || x.url || '',
    name: x.translated_title_en || x.product_title || x.name || '',
    originalName: x.product_title || x.name || '',
    brand: x.brand || '',
    kind: x.kind || '',
    polymer: x.polymer,
    variant: x.variant,
    color: x.color,
    weight: x.weight,
    diameter: x.diameter,
    packaging: x.packaging,
    price: x.full_price || x.price,
    currency: x.currency || 'TRY',
    url: x.url
  };
}

function compare_products(a, b) {
  const left = asListing(a);
  const right = asListing(b);
  const byEn = score(left.name, right.name);
  const byOrig = score(left.originalName, right.originalName);
  const sim = Math.max(byEn, byOrig);
  const decision = decidePair(left, { ...right, id: right.id || 'b' });
  return {
    action: decision.action,
    score: sim,
    reason: decision.reason,
    sameSku: decision.action === 'merge'
  };
}

function rankByPrice(listings, rates) {
  const fx = rates || FALLBACK_TRY;
  return (listings || [])
    .map((x) => {
      const tryPrice = toTry(x.full_price || x.price, x.currency || 'TRY', fx);
      return { ...x, price_try: tryPrice, price_usd: toUsd(tryPrice, fx) };
    })
    .filter((x) => Number.isFinite(x.price_try))
    .sort((a, b) => a.price_try - b.price_try);
}

function groupBestPrices(listings, rates) {
  const ranked = rankByPrice(listings, rates);
  const groups = [];
  for (const item of ranked) {
    const hit = groups.find((g) => compare_products(g[0], item).sameSku);
    if (hit) hit.push(item);
    else groups.push([item]);
  }
  return groups.map((g) => ({
    name: g[0].translated_title_en || g[0].name,
    cheapest: g[0],
    offers: g
  }));
}

module.exports = {
  compare_products,
  rankByPrice,
  groupBestPrices,
  toTry,
  toUsd,
  loadRates,
  detectLang,
  FALLBACK_TRY
};
