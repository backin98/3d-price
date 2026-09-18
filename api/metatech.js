const { parseMoney } = require("../lib/parse-money.cjs");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function parseTL(raw) {
  return parseMoney(raw);
}

function pick(block, re, group) {
  const m = block.match(re);
  return m ? decodeEntities(m[group == null ? 1 : group]).trim() : "";
}

function aisleFromName(kind, name) {
  const n = name || "";
  if (/kurutucu|\bdryer\b|space\s*pi/i.test(n)) return "filament-kurutucu";
  if (
    kind !== "filament" &&
    /\bams\b|renk mod[uü]l|qidi box/i.test(n) &&
    !/combo|printer|yaz[iı]c[iı]/i.test(n)
  ) {
    return "renk-modulu";
  }
  return kind === "filament" ? "filament" : "fdm";
}

function parseMetatechCards(html, kind) {
  kind = kind || "printer";
  const chunks = html.split("mb-2 product-item").slice(1);
  const seen = new Set();
  const products = [];

  for (const chunk of chunks) {
    const href = pick(chunk, /<a href="(\/[^"]+)" class="[^"]*product-title/);
    const title = pick(chunk, /class="[^"]*product-title[^"]*"[^>]*>([^<]+)/);
    if (!href || !title) continue;
    const preorder = /[öo]n\s*sipari[sş]|pre-?order/i.test(title);
    const fromStock = /stoktan(\s*teslim)?/i.test(title);
    const soldOut =
      /class="[^"]*out-of-stock/i.test(chunk) ||
      />\s*Tükendi\s*</i.test(chunk) ||
      /gelince\s*haber/i.test(chunk);
    if (soldOut && !preorder && !fromStock) continue;
    if (
      kind === "filament" &&
      /po[sş]et|saklama|shiner|fixer|yap[iı][sş]t[iı]r[iı]c[iı]|3d\s*pen|3d\s*kalem/i.test(title)
    ) {
      continue;
    }

    const curEx = pick(chunk, /class="product-price-not-vat"[^>]*>([^<]+)/);
    const curInc = pick(chunk, /class="product-price(?![^"]*(?:not-discount|old))[^"]*"[^>]*>([^<]+)/);
    let price = parseTL(curInc) || parseTL(curEx);
    if (price == null) continue;
    const wasEx = pick(chunk, /class="product-price-not-discounted-not-vat"[^>]*>([^<]+)/);
    const wasInc = pick(chunk, /class="product-price-not-discounted"[^>]*>([^<]+)/);
    let was = parseTL(wasInc) || parseTL(wasEx);
    if (was && price && was > price) { /* keep sale as price */ }
    else if (was && price && price > was) { was = undefined; }
    price = Math.round(price * 1.2 * 100) / 100;
    if (was) was = Math.round(was * 1.2 * 100) / 100;

    const brand = pick(chunk, /class="[^"]*brand-title[^"]*"[^>]*>([^<]+)/);
    const image = pick(chunk, /data-src="(https:\/\/store\.metatechtr\.com\/[^"]+)"/);
    const id = pick(chunk, /data-id="(\d+)"/);
    const url = "https://store.metatechtr.com" + href;
    if (seen.has(url)) continue;
    seen.add(url);

    let brandName = brand || "";
    if (/^bambu$/i.test(brandName)) brandName = "Bambu Lab";
    if (/^prusa$/i.test(brandName)) brandName = "Prusa";

    products.push({
      id: "meta-" + (id || href),
      sourceId: "metatech",
      source: "Metatech",
      kind,
      aisle: aisleFromName(kind, title),
      name: title,
      brand: brandName || "Metatech",
      unit: brandName || (kind === "filament" ? "Filament" : "FDM"),
      image,
      url,
      preorder,
      currency: { code: "TRY", symbol: "TL", position: "after", decimals: 2 },
      offers: [
        {
          store: "Metatech",
          price,
          was: was && was > price ? was : undefined,
          km: null,
          url,
          preorder: preorder || undefined,
          vatIncluded: true,
          vatAdded: true
        }
      ]
    });
  }
  return products;
}

async function fetchPage(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" }
  });
  if (!res.ok) throw new Error("Metatech HTTP " + res.status);
  return res.text();
}

async function fetchPageRetry(url, tries) {
  tries = tries || 3;
  for (let i = 0; i < tries; i++) {
    try {
      return await fetchPage(url);
    } catch (e) {
      /* retry */
    }
  }
  return "";
}

function uniqByUrl(list) {
  const out = [];
  const seen = new Set();
  for (const p of list) {
    if (!p.url || seen.has(p.url)) continue;
    seen.add(p.url);
    out.push(p);
  }
  return out;
}

async function huntMetatech(source, kind) {
  const start = String(source.url || "").replace(/\/3d-printers\/?$/i, "/3d-yazicilar");
  const base = new URL(start);
  let products = [];
  let prev = 0;
  let total = 0;
  for (let ps = 8; ps <= 120; ps += 8) {
    const u = new URL(base.href);
    u.searchParams.set("ps", String(ps));
    const html = await fetchPageRetry(u.href);
    if (!html) break;
    total = Number((html.match(/Toplam\s*<span[^>]*>\s*(\d+)/i) || html.match(/Toplam[\s\S]{0,80}?(\d{2,4})\s*ürün/i) || [])[1] || total);
    products = parseMetatechCards(html, kind);
    if (products.length <= prev) break;
    prev = products.length;
    if (total && products.length >= total) break;
    if (ps >= 14 && products.length >= Math.max(total * 0.9, 30)) break;
  }
  return uniqByUrl(products);
}

module.exports = { huntMetatech, parseMetatechCards };
