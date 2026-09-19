// Money, parsed once, for every shop. Two jobs:
//
//   parseMoney(raw)  one well-formed amount -> number, or null. Strict on purpose: a string
//                    holding anything but a single amount (a discount badge, two prices, a
//                    model number) is not a price and must never be guessed at. The Rhino bug
//                    was exactly this: "%21 46.236,14 TL" had its digits glued into 2.146.236,14.
//   pickMoney(text)  find the one amount inside a chunk of page text: currency attached, not a
//                    badge, not an installment or shipping threshold, and when a smaller price
//                    follows a bigger one the smaller is the sale price.
//
// Currency travels with the amount; nothing defaults to $ and nothing is silently relabelled.
// Everything here uses regex literals: a string-built pattern once lost a backslash and turned
// "\s" into a literal "s", which silently broke the currency group.

const CURRENCY_WORDS = { tl: 'TRY', try: 'TRY', '₺': 'TRY', usd: 'USD', $: 'USD', eur: 'EUR', '€': 'EUR', gbp: 'GBP', '£': 'GBP', chf: 'CHF' };
const SCAN = /(?<lead>TL|TRY|USD|EUR|GBP|CHF|[$€£₺])?\s*(?<num>\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+[.,]\d{1,2}|\d+)\s*(?<trail>TL|TRY|USD|EUR|GBP|CHF|[$€£₺])?/gi;
const ANY_CURRENCY = /TL|TRY|USD|EUR|GBP|CHF|[$€£₺]/gi;
const CURRENCY_EXACT = /^(?:TL|TRY|USD|EUR|GBP|CHF|[$€£₺])$/i;

// Above this, a price is not believed for consumer hardware: 2.146.236,14 TL and 9.133.172,77 TL
// are page glitches, not FDM printers. Tune here, nowhere else. (AT1000 at 600.000,00 TL is real.)
const MAX_PRICE = { TRY: 700000, USD: 20000, EUR: 20000, GBP: 20000, CHF: 20000 };
// An offer this many times over its own row's other offers is a parse failure, not a bargain.
const OUTLIER_RATIO = 10;
// Installments, shipping thresholds and promo text: never the price of the product itself.
// Words are ASCII because they are matched against folded text (see foldTr).
const CONTEXT_JUNK = /taksit|aylik|kargo|cargo|shipping|teslimat|ucretsiz|bedava|uzeri|ustu|sepet\s*alti|minimum|min\.|hediye|puan|kupon/;

// Turkish pages shout: "2500 TL ÜZERİ ALIŞVERİŞTE KARGO ÜCRETSİZ" is a shipping threshold, not
// a price. Fold before matching words, the way the rest of the repo reads Turkish.
const foldTr = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ı/g, 'i');

function currencyOf(word) {
  const raw = String(word || '').trim();
  if (!raw || !CURRENCY_EXACT.test(raw)) return '';
  return CURRENCY_WORDS[raw.toLowerCase()] || '';
}

// "2.146,24" / "2,146.24" / "46.236,14" / "2146" / "12.5" -> number, treating the LAST separator
// as the decimal and the others as grouping. Never drops digits.
function toAmount(numberStr) {
  const s = String(numberStr || '');
  const hasDot = s.includes('.');
  const hasComma = s.includes(',');
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (hasDot && hasComma) {
    const decimalIsComma = lastComma > lastDot;
    const head = decimalIsComma ? s.slice(0, lastComma).replace(/\./g, '') : s.slice(0, lastDot).replace(/,/g, '');
    const tail = decimalIsComma ? s.slice(lastComma + 1) : s.slice(lastDot + 1);
    return Number(head + '.' + tail);
  }
  if (hasComma) {
    const parts = s.split(',');
    const tail = parts[parts.length - 1];
    const grouped = parts.slice(1, -1).every((g) => g.length === 3) && parts[0].length <= 3;
    // A lone comma with two digits after it is the decimal; otherwise commas group thousands.
    if (tail.length === 2 && (parts.length === 2 || grouped)) return Number(parts.slice(0, -1).join('') + '.' + tail);
    return Number(parts.join(''));
  }
  if (hasDot) {
    const parts = s.split('.');
    const tail = parts[parts.length - 1];
    if (parts.length > 2) return Number(parts.join('')); // 1.234.567 groups thousands
    if (tail.length === 3 && parts[0].length <= 3) return Number(parts.join('')); // 1.234 -> 1234
    return Number(s); // 12.5 / 12.50 are decimals
  }
  return Number(s);
}

const round2 = (n) => Math.round(n * 100) / 100;

// Every amount-looking token in a string, with what sits beside it and how much it looks like
// money: rank 2 when a currency mark is attached, +1 when it carries decimals.
function moneyTokens(text) {
  const src = String(text || '');
  const out = [];
  for (const m of src.matchAll(SCAN)) {
    const lead = m.groups.lead || '';
    const num = m.groups.num;
    const trail = m.groups.trail || '';
    const numIndex = m.index + m[0].indexOf(num);
    const tokenStart = lead ? m.index : numIndex;
    const tokenEnd = m.index + m[0].length; // the whole token, including the space in "2.146,24 TL"
    const prevChar = src[tokenStart - 1] || '';
    const nextChar = src[numIndex + num.length] || '';
    // Continuing a number we already took means it is the same amount, not a second one.
    if (/[\d.,]/.test(prevChar)) continue;
    const currency = currencyOf(trail) || currencyOf(lead);
    const decimals = /[.,]\d{1,2}$/.test(num);
    // A number glued to letters is a model name or a wattage: "K2", "3D", "10W".
    if (!currency && !decimals && (/[A-Za-z]/.test(prevChar) || /[A-Za-z]/.test(nextChar))) continue;
    const amount = toAmount(num);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const before = src.slice(Math.max(0, tokenStart - 3), tokenStart);
    out.push({
      raw: (lead ? lead + ' ' : '') + num + (trail ? ' ' + trail : ''),
      number: num,
      amount: round2(amount),
      currency,
      decimals,
      rank: (currency ? 2 : 0) + (decimals ? 1 : 0),
      index: tokenStart,
      start: tokenStart,
      end: tokenEnd,
      // "%21 46.236,14" — a badge before a price is the glue trap.
      badge: /%\s*$/.test(foldTr(before)) || /\b(?:x|adet)\s*$/.test(foldTr(before)),
      // A short window: "4.858,65 TL 'den başlayan taksitlerle" is an installment, but the
      // sale price that happens to sit before it is not.
      after: foldTr(src.slice(numIndex + num.length + (trail ? trail.length + 1 : 0), numIndex + num.length + 26))
    });
  }
  return out;
}

// One amount, nothing else. "%21 46.236,14 TL", "58.526,76 TL 46.236,14 TL" and "K2 Combo 100"
// are all null: not a price, and never guessed at.
function parseMoney(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? round2(raw) : null;
  const trimmed = String(raw).trim();
  const tokens = moneyTokens(trimmed);
  if (tokens.length !== 1) return null;
  const only = tokens[0];
  if (only.start !== 0 || only.end !== trimmed.length) return null;
  return only.amount;
}

// Which currency a chunk of page text is written in, by counting the marks it uses.
function detectCurrency(text) {
  const counts = new Map();
  for (const m of String(text || '').matchAll(ANY_CURRENCY)) {
    const c = currencyOf(m[0]);
    if (c) counts.set(c, (counts.get(c) || 0) + 1);
  }
  let best = '';
  let n = 0;
  for (const [c, k] of counts) if (k > n) { best = c; n = k; }
  return best;
}

const isSuspectAmount = (amount, currency) => {
  const max = MAX_PRICE[String(currency || '').toUpperCase()];
  return max != null && Number.isFinite(amount) && amount > max;
};

// The one amount in a chunk of text. Money-looking tokens beat bare digits, the sale price beats
// the list price, installments and shipping thresholds and discount badges are ignored.
function pickMoney(text, ctx = {}) {
  const src = String(text || '');
  const pageCurrency = ctx.currency || detectCurrency(src);
  const candidates = moneyTokens(src)
    .filter((t) => !t.badge)
    .filter((t) => !CONTEXT_JUNK.test(t.after))
    // Only money-looking numbers: a currency mark or decimals. A lone integer in a title is a
    // model number far more often than a price, and inventing one is worse than holding.
    .filter((t) => t.rank >= 1)
    .sort((a, b) => b.rank - a.rank || a.index - b.index);
  if (!candidates.length) return null;
  let chosen = candidates[0];
  // Same quality, close by, 50-100% of the first: that is the sale price, not a second product.
  const rival = candidates.slice(1).find((t) =>
    t.rank >= chosen.rank && Math.abs(t.index - chosen.index) <= 140 && t.amount < chosen.amount && t.amount >= chosen.amount * 0.5
  );
  let was;
  if (rival) { was = chosen.amount; chosen = rival; }
  const currency = chosen.currency || pageCurrency || '';
  return { amount: chosen.amount, currency, raw: chosen.raw, was, suspect: isSuspectAmount(chosen.amount, currency) };
}

function withVat(price, vat) {
  if (!Number.isFinite(price) || price <= 0) return price;
  if (vat === 'excluded') return Math.round(price * 1.2 * 100) / 100;
  return price;
}

// Strips the VAT a stored price already carries, so a shop's KDV policy can be flipped
// back and forth without compounding: 29155 -> 24295.83 -> 29155.
function withoutVat(price) {
  if (!Number.isFinite(price) || price <= 0) return price;
  return Math.round((price / 1.2) * 100) / 100;
}

// Product page: the sale class wins when the page names one, otherwise the same scan as a card.
function pickPrice(html, fallback, ctx = {}) {
  const h = String(html || '');
  const saleM = h.match(/class="[^"]*(?:sale-price|yeni-fiyat|indirimli(?:-fiyat)?|current-price|product-price(?![^"]*(?:not-discount|old)))[^"]*"[^>]*>([\s\S]{0,80}?)</i);
  const sale = saleM ? pickMoney(saleM[1], ctx) : null;
  const afterSale = saleM ? h.slice(saleM.index + saleM[0].length, saleM.index + saleM[0].length + 160) : '';
  const plusVat = /\+?\s*KDV/i.test(afterSale) && !/KDV\s*(?:dahil|dahildir)/i.test(afterSale);
  const old = parseMoney((h.match(/<(?:del|s|strike)\b[^>]*>\s*([^<]{1,48})/i) || [])[1])
    || parseMoney((h.match(/class="[^"]*(?:list-price|eski-fiyat|old-price|compare-at|not-discounted)[^"]*"[^>]*>\s*([^<]{1,48})/i) || [])[1]);
  let price = sale && sale.amount;
  // The sale node often sits right after the list node: pickMoney already worked out which of
  // the two is the sale, so use its "was" when the page has no del/list-price markup.
  let was = old || (sale && sale.was);
  if (price == null && fallback != null) price = parseMoney(fallback);
  if (price == null) {
    const found = pickMoney(h, ctx);
    price = found && found.amount;
  }
  // A "was" below the price means we grabbed the wrong node, not that there is a discount.
  if (price && was && price > was) {
    const t = price;
    price = was;
    was = t;
  }
  const currency = (sale && sale.currency) || ctx.currency || detectCurrency(h.slice(0, 20000));
  return { price, was: was && price && was > price ? was : undefined, plusVat, currency, suspect: isSuspectAmount(price, currency) };
}

// Marks offers whose price cannot be real: beyond the absolute cap for its currency, or wildly
// over the other shops on the same row. Suspect offers stay visible but never win best price.
function flagPriceOutliers(products, opts = {}) {
  const ratio = Number(opts.ratio) || OUTLIER_RATIO;
  // This is a Turkish price comparison site: an offer that never recorded a currency is TRY.
  const fallbackCurrency = opts.currency || "TRY";
  let flagged = 0;
  for (const p of products || []) {
    const prices = (p.offers || []).map((o) => Number(o.price)).filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
    if (!prices.length) continue;
    const median = prices[Math.floor(prices.length / 2)];
    for (const o of p.offers || []) {
      const price = Number(o.price);
      const cap = isSuspectAmount(price, o.priceCurrency || fallbackCurrency);
      const outlier = prices.length >= 3 && median > 0 && price > median * ratio;
      if (cap || outlier) {
        o.priceSuspect = cap ? 'over-cap' : 'outlier';
        flagged += 1;
      } else {
        delete o.priceSuspect;
      }
    }
  }
  return flagged;
}

module.exports = { parseMoney, withVat, withoutVat, pickPrice, pickMoney, moneyTokens, detectCurrency, toAmount, currencyOf, isSuspectAmount, flagPriceOutliers, MAX_PRICE, OUTLIER_RATIO };
