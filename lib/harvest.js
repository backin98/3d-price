"use strict";

const { fold, tokens, identity } = require("./product-match.cjs");
const { parseMoney, pickPrice, pickMoney } = require("./parse-money.cjs");
const { stockFromText, vatFromText } = require("./tr-lexicon.cjs");
const { isTemplateUrl, isListingUrl, detectCurrency, isJunkAmount } = require("./harvest-guards.cjs");
const { resolveProductImage, scrubClonedImages } = require("./resolve-product-image.cjs");

const CARD_SELECTORS = [
  ".showcase",
  ".productItem",
  ".product-item",
  ".product-card",
  ".product-listing",
  "[data-product-id]",
  "li.product",
  "article.product",
  ".card-product"
];

const PRINTER_BRANDS = [
  "kobra", "bambulab", "bambu", "qiditech", "qidi", "creality", "anycubic",
  "snapmaker", "flashforge", "elegoo", "prusa", "flsun", "artillery",
  "revopoint", "xtool", "iemai", "sovol", "kingroon", "raise3d", "ankermake",
  "twotrees", "voron"
];

const PRICE_RE = /(?:\$|€|£)?\s*[\d.,]+\s*(?:TL|₺|\$|USD|EUR|€)?/i;
const VOID = new Set(["img", "input", "br", "hr", "meta", "link", "source"]);

function turkishFold(s) {
  return fold(s);
}

function normalizeKind(kind) {
  const k = String(kind || "").toLowerCase();
  if (k === "printers" || k === "printer") return "printer";
  if (k === "filaments" || k === "filament") return "filament";
  return k || "";
}

function declaredLabel(kind) {
  const k = normalizeKind(kind);
  if (k === "printer") return "printer";
  if (k === "filament") return "filament";
  return k || "product";
}

function pathOf(url) {
  try {
    return new URL(url, "https://example.invalid").pathname.replace(/\/+$/, "").toLowerCase();
  } catch {
    return String(url || "").toLowerCase();
  }
}

function lastSegment(url) {
  return pathOf(url).split("/").filter(Boolean).pop() || "";
}

function isLikelyProductUrl(url, kind, name, categoryUrl) {
  let href = String(url || "");
  if (!href || href.startsWith("javascript:") || href.startsWith("#")) return false;
  if (isTemplateUrl(href)) return false;
  if (isListingUrl(href, categoryUrl)) return false;
  let u;
  try { u = new URL(href, "https://example.invalid"); } catch { return false; }
  const path = u.pathname.toLowerCase();
  const last = lastSegment(href);
  if (/\/(kategori|category|collections|vendors|hakkimizda|about|garanti|warranty|iletisim|contact|blog|haber|destek|sss|faq)\b/.test(path)) return false;
  if (/\b(hakkinda|garantisi)\b/.test(path)) return false;
  if (/^(filament|filamentler|filament-cesitleri|3d-yazicilar|yazicilar|urunler|markalar)$/i.test(last)) return false;
  if (/-(turkiye|cesitleri|markalari|markalarimiz)$/i.test(last)) return false;
  const declared = normalizeKind(kind);
  if (declared === "printer") {
    if (/(?:^|-)(filamentleri|kurutuculari|elektronik|kaynaklari|baglanti|elemanlari)(?:-\d+)?$/i.test(last)) return false;
    if (/^(3d-)?yazicilar$|^filamentler$|^urunler$/i.test(last)) return false;
  }
  if (/\/(products?|urun)\//i.test(path)) return true;
  if (declared === "printer") {
    const printerish = /(?:3d-)?(?:yaz[iı]c[iı]|print(?:er|e-r))/i.test(last);
    const brand = PRINTER_BRANDS.some((b) => last.includes(b));
    if (printerish || brand) return true;
    const depth = path.split("/").filter(Boolean).length;
    if (depth === 1 && last.length >= 6) {
      if (/\d/.test(last) || /combo|carbon|kobra|ender|ams/i.test(last)) return true;
      if (name && classifyProductType(name) === "printer") return true;
    }
    return false;
  }
  return true;
}

function slugToTitle(url) {
  let last = lastSegment(url).replace(/\.(html?|php)$/i, "").replace(/[-_]+/g, " ").trim();
  if (!last) return "";
  const titled = last.split(/\s+/).map((w) => {
    const lower = w.toLocaleLowerCase("tr");
    if (lower === "3d") return "3D";
    if (/^\d/.test(w)) return w.toUpperCase();
    return w.charAt(0).toLocaleUpperCase("tr") + w.slice(1);
  }).join(" ");
  return titled
    .replace(/\b3d yazici\b/gi, "3D Yazıcı")
    .replace(/\b3d printer\b/gi, "3D Printer");
}

function mapStockStatus(raw) {
  return stockFromText(raw);
}

function stockQuantity(html) {
  const raw = String(html || "");
  const folded = turkishFold(stripTags(raw));
  const m = folded.match(/stok miktari\s+(\d+)/) || raw.match(/stok\s*miktar[ıi]\s*[:=]?\s*(\d+)/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function readStockFromHtml(html, extras) {
  const raw = String(html || "");
  const t = turkishFold(stripTags(raw));
  const extra = extras && typeof extras === "object" ? extras : {};
  const quantity = stockQuantity(raw);
  const badgeStatus = mapStockStatus(extra.badge || extra.harvested || "");
  const oos = quantity === 0
    || /tukendi|stokta yok|sold out|out of stock|gelince haber/.test(t)
    || /out-of-stock/i.test(raw);
  const preorder = /on siparis|preorder|pre order/.test(t) || badgeStatus === "preorder";
  const fromStock = /stoktan teslim/.test(t);
  if (oos && !preorder && !fromStock) {
    return { status: "out_of_stock", quantity: quantity === 0 ? 0 : null, evidence: "page", verified: true };
  }
  if (badgeStatus === "out_of_stock") {
    return { status: "out_of_stock", quantity: null, evidence: "badge", verified: true };
  }
  if (badgeStatus === "dropshipping") {
    return { status: "dropshipping", quantity: null, evidence: "badge", verified: true };
  }
  if (badgeStatus === "preorder" || preorder) {
    return { status: "preorder", quantity: null, evidence: "badge", verified: true };
  }
  if (extra.filterVerified === true) {
    return { status: "in_stock", quantity, evidence: "retailer-stock-only-filter", verified: true };
  }
  if (Number.isFinite(quantity) && quantity > 0) {
    return { status: "in_stock", quantity, evidence: "stok-miktari", verified: true };
  }
  if (/stok durumu\s+var/.test(t) || fromStock || /\bin stock\b/.test(t)) {
    return { status: "in_stock", quantity, evidence: "stok-durumu", verified: true };
  }
  if (/sepete ekle|add to cart|addtocart\s*\(/i.test(raw)) {
    return { status: "in_stock", quantity, evidence: "add-to-cart", verified: true };
  }
  if (badgeStatus === "in_stock") {
    return { status: "in_stock", quantity, evidence: "badge", verified: true };
  }
  return { status: "unknown", quantity: null, evidence: "", verified: false };
}

function normalizeOfferPrice(raw) {
  return parseMoney(raw);
}

function classifyProductType(name, extra) {
  const t = turkishFold((name || "") + " " + (extra || ""));
  if (!t) return "other";
  const isPrinterWord = /\b(yazici|printer|kobra|ender|msla|fdm)\b/.test(t);
  if (/\b(kurutucu|dryer|elektronik|baglanti|eleman|kaynak|parca|yedek|aksesuar|renk\s*modul)/.test(t) && !isPrinterWord) return "accessory";
  if (/\b(tarayici|scanner)\b/.test(t) && !isPrinterWord) return "scanner";
  if (/\b(filamentleri|filament)\b/.test(t) && !isPrinterWord) return "filament";
  if (/\b(recine|resin)\b/.test(t) && !/\b(yazici|printer|photon|msla|sla)\b/.test(t)) return "resin";
  if (isPrinterWord || /\bsla\b/.test(t)) return "printer";
  if (PRINTER_BRANDS.some((b) => t.includes(b))) return "printer";
  if (/\b(pla|petg|abs|asa|tpu)\b/.test(t)) return "filament";
  return "other";
}

function extractIdentity(title) {
  const name = String(title || "");
  const id = identity({ name, brand: "", kind: classifyProductType(name, "") });
  const folded = turkishFold(name);
  const brand = PRINTER_BRANDS.map((b) => (b === "bambu" ? "bambu lab" : b === "qidi" ? "qidi" : b))
    .find((b) => folded.includes(b.replace(/\s+/g, " "))) || id.brand || "";
  const modelTokens = tokens(name).filter((t) => t !== turkishFold(brand) && !PRINTER_BRANDS.includes(t));
  return { ...id, brand, modelTokens };
}

function needsLlm(product) {
  const id = extractIdentity(product && product.name);
  return !id.brand || !id.modelTokens.length;
}

function attr(tag, name) {
  const re = new RegExp(name + "\\s*=\\s*([\"'])([\\s\\S]*?)\\1", "i");
  const m = String(tag || "").match(re);
  return m ? m[2] : "";
}

function classList(attrs) {
  return attr("x " + attrs, "class").toLowerCase().split(/\s+/).filter(Boolean);
}

function hasClass(attrs, name) {
  return classList(attrs).includes(String(name).toLowerCase());
}

function classContains(attrs, needle) {
  return classList(attrs).some((c) => c.includes(String(needle).toLowerCase()));
}

function stripTags(html) {
  return String(html || "")
    .replace(/<(script|style|svg)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function isBadgeText(s) {
  const t = turkishFold(s);
  return /dropshipping|on siparis|stoktan teslim|tukendi|stokta yok|sold out|preorder/.test(t);
}

function closeElement(html, tag, start, innerStart) {
  if (VOID.has(tag)) return { start, end: innerStart, inner: "", html: html.slice(start, innerStart) };
  const re = new RegExp("<(/?)(" + tag + ")\\b[^>]*>", "gi");
  re.lastIndex = innerStart;
  let depth = 1;
  let m;
  while ((m = re.exec(html))) {
    if (m[1] === "/") {
      depth -= 1;
      if (depth === 0) {
        const end = m.index + m[0].length;
        return { start, end, inner: html.slice(innerStart, m.index), html: html.slice(start, end) };
      }
    } else if (!VOID.has(tag)) {
      depth += 1;
    }
  }
  return { start, end: html.length, inner: html.slice(innerStart), html: html.slice(start) };
}

function extractElements(html, matchFn) {
  const out = [];
  const re = /<([a-z][a-z0-9]*)\b([^>]*)>/gi;
  let m;
  while ((m = re.exec(html))) {
    const tag = m[1].toLowerCase();
    const attrs = m[2] || "";
    if (!matchFn(tag, attrs)) continue;
    const block = closeElement(html, tag, m.index, re.lastIndex);
    out.push(block);
    re.lastIndex = block.end;
  }
  return out;
}

function outermost(blocks) {
  return blocks.filter((b, i) => !blocks.some((o, j) => j !== i && o.start <= b.start && o.end >= b.end && (o.end - o.start) > (b.end - b.start)));
}

function selectorMatch(selector) {
  const s = String(selector || "");
  if (s === "[data-product-id]") return (tag, attrs) => /data-product-id\s*=/i.test(attrs);
  if (s === "li.product") return (tag, attrs) => tag === "li" && hasClass(attrs, "product");
  if (s === "article.product") return (tag, attrs) => tag === "article" && hasClass(attrs, "product");
  if (s.startsWith(".")) {
    const name = s.slice(1);
    return (tag, attrs) => hasClass(attrs, name);
  }
  return () => false;
}

function fallbackProductish(tag, attrs) {
  if (!classContains(attrs, "product") && !classContains(attrs, "urun")) return false;
  const cls = classList(attrs).join(" ");
  if (/(inner|content|label|reviews|carousel|price|image|title|wrapper)/.test(cls) && !hasClass(attrs, "card-product") && !hasClass(attrs, "product-item") && !hasClass(attrs, "product-card")) return false;
  return true;
}

const CONTAINER_TAGS = new Set(["div", "li", "ul", "ol", "article", "section", "td", "tr", "table", "a", "form", "main"]);
const DISCOVER_MIN_LINKS = 3;      // a shape needs this many distinct URLs to be a grid
const DISCOVER_MAX_CARD_LINKS = 4; // a card holds its product link plus chrome, not a whole grid
const CATEGORY_TAIL = /(?:^|[-_])(k|ka|kat|kategori|kategorisi|c|cat|category|collection|koleksiyon|marka|brand|sayfa|page)[-_]?\d+$/i;
const HAS_PRICE = /\d{1,3}(?:\.\d{3})+(?:,\d{2})?|\d+[.,]\d{2}\s*(?:TL|₺|tl)|\d+\s*(?:TL|₺)/;

const hasPriceText = (html) => HAS_PRICE.test(stripTags(html));

// Same detail page under a different product id: "/slug-u122733", "/slug-p-99",
// "/UrunDetay.aspx?urunID=12". Returns the shape ("1|" = one path segment, no folder)
// or "" when the URL cannot be a product detail page.
function shapeKey(href) {
  const s = String(href || "").trim();
  if (!s || /^(javascript:|#|mailto:|tel:|data:)/i.test(s)) return "";
  let u;
  try { u = new URL(s, "https://shape.invalid"); } catch { return ""; }
  const segs = u.pathname.split("/").filter(Boolean);
  if (!segs.length) return "";
  const last = segs[segs.length - 1];
  const idParams = [...u.searchParams.entries()].filter(([, v]) => /^\d{2,}$/.test(v)).map(([k]) => k.toLowerCase()).sort();
  if (idParams.length) return "q|" + segs.slice(0, -1).join("/").toLowerCase() + "/" + last.toLowerCase() + "?" + idParams.join(",");
  if (!/\d{3,}$/.test(last)) return "";          // no id-ish tail: nav, filters, category pages
  if (CATEGORY_TAIL.test(last)) return "";       // -ka434, -k12, -kategori-3
  return segs.length + "|" + segs.slice(0, -1).join("/").toLowerCase();
}

// Group the page's anchors by shape and keep the groups that look like a product grid:
// enough distinct URLs, and a price printed next to most of them. No shop names, no
// platform list — a storefront we have never seen is discovered the same way.
function discoverProductLinks(html, opts = {}) {
  const min = Math.max(2, Number(opts.min) || DISCOVER_MIN_LINKS);
  const page = String(html || "");
  const groups = new Map();
  for (const m of page.matchAll(/<a\b([^>]*)>/gi)) {
    const href = attr("a " + (m[1] || ""), "href");
    const key = shapeKey(href);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ href: href.trim(), pos: m.index });
  }
  const out = [];
  for (const [key, items] of groups) {
    const uniq = [...new Map(items.map((i) => [i.href, i])).values()];
    if (uniq.length < min) continue;
    // A card's price can sit well before its link (ASP.NET repeaters emit price, then
    // link, then buttons), so look at the whole neighbourhood of the anchor.
    const priced = uniq.filter((i) => hasPriceText(page.slice(Math.max(0, i.pos - 2500), i.pos + 1500))).length;
    if (priced < Math.max(2, Math.ceil(uniq.length * 0.6))) continue;
    out.push({ key, items: uniq, priced, size: uniq.length });
  }
  return out.sort((a, b) => b.size - a.size || b.priced - a.priced);
}

// The card for a discovered link: the innermost container that holds the link and a
// price, and is still small enough to be one card rather than the grid.
function discoverCards(html) {
  const group = discoverProductLinks(html)[0];
  if (!group) return [];
  // Note: extractElements() skips the inside of every block it accepts, which is right
  // for selectors and wrong here — we need the *innermost* container, so walk the opening
  // tags of the page ourselves, nearest-first, until a price comes into scope.
  const opens = [...html.matchAll(/<(a|li|ul|ol|div|article|section|td|tr|table|form)\b[^>]*>/gi)]
    .map((m) => ({ tag: m[1].toLowerCase(), start: m.index, end: m.index + m[0].length }));
  const cards = [];
  const seen = new Set();
  for (const { pos } of group.items) {
    let picked = null;
    for (let i = opens.length - 1; i >= 0; i--) {
      const o = opens[i];
      if (o.start > pos) continue;
      const block = closeElement(html, o.tag, o.start, o.end);
      if (block.end <= pos) continue;
      // Walking outwards, the first container holding the whole grid means we overshot.
      if ((block.html.match(/<a\b/gi) || []).length > DISCOVER_MAX_CARD_LINKS) break;
      if (!hasPriceText(block.inner)) continue;
      picked = block;
      break;
    }
    if (picked && !seen.has(picked.start)) {
      seen.add(picked.start);
      cards.push(picked);
    }
  }
  return cards;
}

function extractCards(html) {
  for (const sel of CARD_SELECTORS) {
    const found = outermost(extractElements(html, selectorMatch(sel)));
    if (found.length) return found;
  }
  return outermost(extractElements(html, fallbackProductish));
}

function absUrl(href, base) {
  try { return new URL(href, base).href; } catch { return ""; }
}

function primaryHref(cardHtml, base, kind) {
  const links = [...cardHtml.matchAll(/<a\b([^>]*)>/gi)];
  const ranked = [];
  for (const m of links) {
    const attrs = m[1] || "";
    const href = attr("a " + attrs, "href");
    if (!href || /^(javascript:|#)/i.test(href)) continue;
    if (/carousel-control|btn-minus|btn-plus|favorite/i.test(attrs)) continue;
    if (/\/(collections|vendors|pages|cart|account|blogs|search)\b/i.test(href)) continue;
    const resolved = absUrl(href, base);
    if (!resolved) continue;
    const productPath = /\/(products?|urun)\//i.test(href) || /\/(products?|urun)\//i.test(resolved);
    const cls = classList(attrs);
    const titleLink = cls.includes("product-title") || cls.includes("product-card__title") || cls.includes("c-p-i-link");
    if (!productPath && !titleLink && !isLikelyProductUrl(resolved, kind || "printer")) continue;
    const title = attr("a " + attrs, "title");
    const score = (productPath ? 0 : 2) + (cls.includes("c-p-i-link") || cls.includes("product-card__title") ? 0 : 1) + (title && !isBadgeText(title) ? 0 : 1);
    ranked.push({ href: resolved, score, title });
  }
  ranked.sort((a, b) => a.score - b.score);
  return ranked[0] || null;
}

function firstText(cardHtml, names) {
  const want = new Set(names.map((n) => n.replace(/^\./, "").toLowerCase()));
  // Class names differ per platform (lblUrunBaslik, productCardTitle, …). Match the words
  // that mean "title" in the market's languages instead of an exact list.
  const titleish = /(?:^|[-_])(baslik|başlık|title|name|ad|adi|isim)(?:$|[-_])/i;
  const blocks = extractElements(cardHtml, (tag, attrs) => {
    if (want.has(tag)) return true;
    const classes = classList(attrs);
    if (classes.some((c) => want.has(c))) return true;
    return classes.some((c) => titleish.test(c)) && !/fiyat|price|sepet|cart|buton|button|link|stok|stock/i.test(classes.join(" "));
  });
  for (const b of blocks) {
    const text = stripTags(b.inner);
    if (text && !isBadgeText(text)) return text;
  }
  const itemprop = cardHtml.match(/itemprop=["']name["'][^>]*>([\s\S]*?)<\//i);
  if (itemprop) {
    const text = stripTags(itemprop[1]);
    if (text && !isBadgeText(text)) return text;
  }
  return "";
}

function cardName(cardHtml, href) {
  const fromDom = firstText(cardHtml, ["h2", "h3", "title", "product-title", "product-name", "urun-adi", "product-card__title", "showcase-title"]);
  if (fromDom) return fromDom.replace(/\s+[-–]\s*(STOKTAN|Dropshipping|ÖN SİPARİŞ).*$/i, "").trim();
  const link = primaryHref(cardHtml, href);
  if (link && link.title && !isBadgeText(link.title)) return link.title.trim();
  return slugToTitle(href);
}

function cardBadge(cardHtml) {
  const label = extractElements(cardHtml, (tag, attrs) =>
    hasClass(attrs, "badge") || hasClass(attrs, "label") || hasClass(attrs, "product-label")
    || hasClass(attrs, "stock-badge") || hasClass(attrs, "stok-durumu")
  );
  for (const b of label) {
    const alt = (b.html.match(/alt=["']([^"']+)["']/i) || [])[1]
      || (b.html.match(/title=["']([^"']+)["']/i) || [])[1]
      || stripTags(b.inner);
    if (alt && isBadgeText(alt)) return alt;
  }
  const folded = turkishFold(stripTags(cardHtml));
  const m = folded.match(/dropshipping|on siparis|stoktan teslim|tukendi|stokta yok|sold out|preorder/);
  return m ? m[0] : "";
}

// Same extraction, but it also says which currency it read and whether the number is believable
// at all, so an offer can carry that to the storefront instead of pretending.
function cardPriceDetail(cardHtml) {
  const price = cardPriceNumber(cardHtml);
  if (price == null) return { price: null, currency: "", suspect: false, raw: "" };
  const currency = detectCurrency(cardHtml);
  return { price, currency, suspect: require("./parse-money.cjs").isSuspectAmount(price, currency), raw: String(price) };
}

function cardPrice(cardHtml) {
  return cardPriceNumber(cardHtml);
}

function cardPriceNumber(cardHtml) {
  const withoutOld = String(cardHtml || "")
    .replace(/<(?:del|s|strike)\b[^>]*>[\s\S]*?<\/(?:del|s|strike)>/gi, " ")
    .replace(/class="[^"]*(?:list-price|eski-fiyat|old-price|compare-at|not-discounted)[^"]*"[^>]*>[^<]{0,48}/gi, " ");
  const blocks = extractElements(withoutOld, (tag, attrs) =>
    hasClass(attrs, "sale-price") || hasClass(attrs, "yeni-fiyat") || hasClass(attrs, "indirimli")
    || hasClass(attrs, "current-price") || hasClass(attrs, "fiyat") || hasClass(attrs, "showcase-price-new")
    // "fiyat"/"tutar" mean price/amount: lblFiyat, divFiyat2, urunFiyati, sepetTutar on
    // platforms that name nothing in English. Old/strikethrough prices are stripped above.
    || (classContains(attrs, "fiyat") && !/eski|old|liste|list|indirim|filter|kargo|cargo/i.test(attrs))
    || (classContains(attrs, "tutar") && !/eski|old|toplam|kargo|cargo/i.test(attrs))
    || (classContains(attrs, "price") && !/not-discount|old-price|list-price|filter/i.test(attrs))
    || /itemprop=["']price["']/i.test(attrs)
  );
  const ctx = stripTags(cardHtml);
  for (const b of blocks) {
    // A price block often holds the discount badge and both prices: pick the one amount out of
    // it instead of handing the whole string to the parser (that is how %21 + 46.236,14 became
    // 2.146.236,14).
    const inner = stripTags(b.inner);
    const picked = pickMoney(inner, { currency: detectCurrency(cardHtml) });
    const n = picked ? picked.amount : null;
    if (n && !isJunkAmount(n, ctx)) return n;
  }
  const text = stripTags(withoutOld);
  // Unknown markup: believe a number that carries a currency before believing the first
  // number in the card — a model name like "Widget Pro 100 3D Yazıcı" is not a price.
  const picked = pickMoney(text, { currency: detectCurrency(cardHtml) });
  if (picked && !isJunkAmount(picked.amount, ctx)) return picked.amount;
  return null;
}

function cardImage(cardHtml, base) {
  return resolveProductImage({ cardHtml, pageUrl: base }) || "";
}

function parseCard(block, base, kind, categoryUrl, opts) {
  const inStockOnly = !opts || opts.inStockOnly !== false;
  const hrefInfo = primaryHref(block.html, base, kind);
  const url = hrefInfo ? hrefInfo.href : "";
  if (!url) return { rejected: { url: "", reason: "card has no product link" } };
  const name = cardName(block.html, url);
  if (!isLikelyProductUrl(url, kind, name, categoryUrl)) {
    return { rejected: { url, reason: "url is not a product detail page for " + declaredLabel(kind) } };
  }
  const badge = cardBadge(block.html);
  const stock = mapStockStatus(badge) !== "unknown" ? mapStockStatus(badge) : mapStockStatus(block.html);
  if (inStockOnly && stock === "out_of_stock") {
    return { rejected: { url, reason: "out_of_stock", name } };
  }
  const priceInfo = cardPriceDetail(block.html);
  const price = priceInfo.price;
  if (!Number.isFinite(price) || price <= 0) {
    return { rejected: { url, reason: "no current sale price", name } };
  }
  const image = cardImage(block.html, base);
  const brand = stripTags((extractElements(block.html, (tag, attrs) => hasClass(attrs, "brand") || hasClass(attrs, "brand-title"))[0] || {}).inner || "");
  const detectedType = classifyProductType(name, brand);
  const declaredType = declaredLabel(kind);
  const product = {
    url,
    name,
    brand: brand && !isBadgeText(brand) ? brand : (extractIdentity(name).brand || ""),
    kind: detectedType,
    price,
    currency: priceInfo.currency || detectCurrency(block.html),
    // A price that could not be real travels with the offer as a flag: the storefront keeps it
    // visible but never lets it win "best price", and the admin shows why.
    priceSuspect: priceInfo.suspect === true,
    vatExcluded: vatFromText(block.html) === "excluded",
    image,
    stock,
    stockBadge: badge || "",
    identity: extractIdentity(name)
  };
  if (declaredType === "printer" || declaredType === "filament") {
    if (detectedType === "other" || detectedType === declaredType) product.kind = declaredType;
  }
  if (declaredType && declaredType !== "both" && product.kind !== declaredType && detectedType !== "other") {
    return {
      mismatch: {
        url,
        name: product.name,
        image: product.image,
        price: product.price,
        stock: product.stock,
        detectedType,
        declaredType,
        reason: "category_mismatch"
      }
    };
  }
  return { product };
}

function jsonLdProduct(html) {
  const blocks = String(html || "").matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const b of blocks) {
    try {
      const j = JSON.parse(b[1]);
      const nodes = Array.isArray(j) ? j : j["@graph"] ? j["@graph"] : [j];
      const p = nodes.find((n) => /Product/i.test(String((n && n["@type"]) || "")));
      if (p) return p;
    } catch {
      /* ignore malformed JSON-LD */
    }
  }
  return null;
}

function metaContent(html, prop) {
  const re = new RegExp("<meta[^>]+(?:property|name)=[\"']" + prop + "[\"'][^>]+content=[\"']([^\"']+)", "i");
  const alt = new RegExp("<meta[^>]+content=[\"']([^\"']+)[\"'][^>]+(?:property|name)=[\"']" + prop + "[\"']", "i");
  return ((String(html || "").match(re) || String(html || "").match(alt) || [])[1] || "").trim();
}

function extractProductPage(html, url, kind) {
  const raw = String(html || "");
  const ld = jsonLdProduct(raw);
  const ogTitle = metaContent(raw, "og:title");
  const fromDom = firstText(raw, ["h1", "product-title", "product-name"]);
  const ldName = ld && (ld.name || (ld.brand && ld.brand.name));
  let name = (fromDom || ogTitle || ldName || slugToTitle(url) || "").replace(/\s+[-–]\s*(STOKTAN|Dropshipping|ÖN SİPARİŞ).*$/i, "").trim();
  if (isBadgeText(name)) name = slugToTitle(url);
  const brandBlock = stripTags((extractElements(raw, (tag, attrs) => hasClass(attrs, "brand") || hasClass(attrs, "brand-title") || /itemprop=["']brand["']/i.test(attrs))[0] || {}).inner || "");
  const id = extractIdentity(name);
  const brand = (brandBlock && !isBadgeText(brandBlock) ? brandBlock : "") || (ld && (typeof ld.brand === "string" ? ld.brand : ld.brand && ld.brand.name)) || id.brand || "";
  const image = resolveProductImage({ productPageHtml: raw, pageUrl: url, productUrl: url }) || "";
  const fallback = (stripTags(raw).match(PRICE_RE) || [])[0];
  const picked = pickPrice(raw, fallback);
  const detectedType = classifyProductType(name, brand);
  const declaredType = declaredLabel(kind);
  const stock = readStockFromHtml(raw);
  const vatIncluded = vatFromText(raw) !== "excluded";
  const product = {
    url,
    name,
    brand,
    kind: detectedType,
    price: picked.price,
    was: picked.was,
    plusVat: picked.plusVat === true,
    vatIncluded,
    image,
    stock: stock.status || "unknown",
    stockBadge: "",
    stockQuantity: Number.isFinite(stock.quantity) ? stock.quantity : null,
    stockEvidence: stock.evidence || "",
    stockVerified: stock.verified === true,
    identity: id
  };
  if (!product.brand) {
    product.brand = String(product.name || "").trim().split(/\s+/).find((w) => w.length > 1 && !/^(3d|the|a|an)$/i.test(w)) || "";
  }
  if (!product.name || !Number.isFinite(product.price) || product.price <= 0) {
    return { incomplete: product, reason: "incomplete deterministic product evidence" };
  }
  if (!product.brand) {
    return { incomplete: product, reason: "missing brand evidence" };
  }
  if (declaredType && declaredType !== "both" && detectedType !== declaredType && detectedType !== "other") {
    return {
      mismatch: {
        url,
        name: product.name,
        image: product.image,
        price: product.price,
        stock: product.stock,
        detectedType,
        declaredType,
        reason: "category_mismatch"
      }
    };
  }
  if (declaredType === "printer" || declaredType === "filament") product.kind = declaredType;
  return { product };
}

function fromUrls(urls, kind, maxProducts) {
  const inScope = [];
  const mismatches = [];
  const rejected = [];
  for (const url of urls || []) {
    if (inScope.length >= maxProducts) break;
    if (!isLikelyProductUrl(url, kind)) {
      rejected.push({ url, reason: "url is not a product detail page for " + declaredLabel(kind) });
      continue;
    }
    const name = slugToTitle(url);
    const detectedType = classifyProductType(name, "");
    const declaredType = declaredLabel(kind);
    if (declaredType && declaredType !== "both" && detectedType !== declaredType) {
      mismatches.push({ url, name, image: "", price: null, stock: "unknown", detectedType, declaredType, reason: "category_mismatch" });
      continue;
    }
    inScope.push({
      url,
      name,
      brand: extractIdentity(name).brand || "",
      kind: detectedType,
      price: null,
      image: "",
      stock: "unknown",
      stockBadge: "",
      identity: extractIdentity(name)
    });
  }
  return { inScope, mismatches, rejected };
}

async function harvestCategory({ categoryUrl, kind, maxProducts = 400, html, urls, fetchImpl, inStockOnly = true } = {}) {
  const cap = Math.max(1, Number(maxProducts) || 400);
  if (Array.isArray(urls) && urls.length && html == null) {
    return fromUrls(urls, kind, cap);
  }
  let pageHtml = html;
  const base = categoryUrl || "https://example.invalid/";
  if (pageHtml == null) {
    if (!categoryUrl) throw new Error("harvestCategory needs categoryUrl or html");
    const fetchFn = fetchImpl || fetch;
    const res = await fetchFn(categoryUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
        "Accept-Language": "tr-TR,tr;q=0.9,en;q=0.7"
      },
      redirect: "follow"
    });
    if (!res.ok) throw new Error("HTTP " + res.status + " " + categoryUrl);
    pageHtml = await res.text();
  }

  const cards = extractCards(pageHtml);
  const inScope = [];
  const mismatches = [];
  const rejected = [];
  const seen = new Set();
  const parseAll = (list) => {
    for (const card of list) {
      if (inScope.length >= cap) break;
      const parsed = parseCard(card, base, kind, categoryUrl, { inStockOnly });
      const url = (parsed.product || parsed.mismatch || parsed.rejected || {}).url;
      if (url && seen.has(url)) continue;
      if (url) seen.add(url);
      if (parsed.rejected) rejected.push(parsed.rejected);
      else if (parsed.mismatch) mismatches.push(parsed.mismatch);
      else if (parsed.product) inScope.push(parsed.product);
    }
  };
  parseAll(cards);
  // Unknown storefront: the known card selectors matched nothing usable, so discover the
  // product grid from the page's own links and try again. Same DOM, no shop-specific code.
  let discovery = null;
  if (!inScope.length) {
    const found = discoverCards(pageHtml);
    if (found.length) {
      const best = discoverProductLinks(pageHtml)[0];
      discovery = { pattern: best ? best.key : "", cards: found.length, links: best ? best.size : 0 };
      parseAll(found);
    }
  }
  scrubClonedImages(inScope);
  const warning = !cards.length && !discovery ? "no product grid on this URL (use a listing/collection page, not the homepage)" : "";
  return { inScope, mismatches, rejected, warning, discovery };
}

module.exports = {
  CARD_SELECTORS,
  extractCards,
  discoverCards,
  discoverProductLinks,
  shapeKey,
  harvestCategory,
  isLikelyProductUrl,
  isTemplateUrl,
  isListingUrl,
  detectCurrency,
  isJunkAmount,
  slugToTitle,
  mapStockStatus,
  readStockFromHtml,
  classifyProductType,
  extractIdentity,
  extractProductPage,
  cardPrice,
  cardPriceDetail,
  needsLlm,
  turkishFold,
  normalizeOfferPrice
};
