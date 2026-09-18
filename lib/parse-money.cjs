function parseMoney(raw) {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number") return Number.isFinite(raw) && raw > 0 ? Math.round(raw * 100) / 100 : null;
  let s = String(raw).replace(/[^\d.,]/g, "");
  if (!s) return null;
  const comma = s.lastIndexOf(",");
  const dot = s.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) {
    s = comma > dot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (comma >= 0) {
    const frac = s.length - comma - 1;
    s = frac === 3 && /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, "") : s.replace(",", ".");
  } else if (dot >= 0) {
    const parts = s.split(".");
    if (parts.length > 2) s = parts.join("");
    else if (parts[1].length === 3 && parts[0].length <= 3) s = parts.join("");
  }
  const v = Number(s);
  return Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : null;
}

function withVat(price, vat) {
  if (!Number.isFinite(price) || price <= 0) return price;
  if (vat === "excluded") return Math.round(price * 1.2 * 100) / 100;
  return price;
}

function pickPrice(html, fallback) {
  const h = String(html || "");
  const saleRe = /class="[^"]*(?:sale-price|yeni-fiyat|indirimli(?:-fiyat)?|current-price|product-price(?![^"]*(?:not-discount|old)))[^"]*"[^>]*>\s*([^<]{1,48})/i;
  const saleM = h.match(saleRe);
  const sale = parseMoney(saleM && saleM[1]);
  const afterSale = saleM ? h.slice(saleM.index + saleM[0].length, saleM.index + saleM[0].length + 160) : "";
  const plusVat = /\+\s*KDV/i.test(afterSale);
  const old = parseMoney((h.match(/<(?:del|s|strike)\b[^>]*>\s*([^<]{1,48})/i) || [])[1])
    || parseMoney((h.match(/class="[^"]*(?:list-price|eski-fiyat|old-price|compare-at|not-discounted)[^"]*"[^>]*>\s*([^<]{1,48})/i) || [])[1]);
  let price = sale || parseMoney(fallback);
  let was = old;
  if (price && was && price > was) {
    const t = price;
    price = was;
    was = t;
  }
  if (sale && old && fallback != null && Math.abs((parseMoney(fallback) || 0) - old) < 0.05 && Math.abs(sale - old) > 1) price = sale;
  return { price, was: was && price && was > price ? was : undefined, plusVat };
}

module.exports = { parseMoney, withVat, pickPrice };
