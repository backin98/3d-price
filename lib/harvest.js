"use strict";

const { fold, tokens, identity } = require("./product-match.cjs");
const { parseMoney, pickPrice, pickMoney, moneyTokens } = require("./parse-money.cjs");
const { stockFromText, vatFromText, isBuyableStock } = require("./tr-lexicon.cjs");
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
  const active = raw
    .replace(/<(button|a)\b(?=[^>]*(?:\bdisabled\b|aria-disabled=["']?true|class=["'][^"']*\bdisabled\b))[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<input\b(?=[^>]*(?:\bdisabled\b|aria-disabled=["']?true|class=["'][^"']*\bdisabled\b))[^>]*>/gi, " ");
  const t = turkishFold(stripTags(raw));
  const extra = extras && typeof extras === "object" ? extras : {};
  const quantity = stockQuantity(raw);
  const badgeStatus = mapStockStatus(extra.badge || extra.harvested || "");
  const hasCart = /sepete ekle|sepet\s*ekle|add to cart|addtocart\s*\(/i.test(active);
  const hasPrice = /(?:\d[\d.,]*\s*(?:TL|TRY|₺|USD|EUR|€|\$)|(?:₺|€|\$)\s*\d)/i.test(stripTags(raw));
  const oos = quantity === 0
    || /tukendi|stokta yok|sold out|out of stock|gelince haber/.test(t)
    || /out-of-stock/i.test(raw);
  const preorder = /on siparis|preorder|pre order/.test(t) || badgeStatus === "preorder";
  const fromStock = /stoktan teslim/.test(t);
  if (preorder && (hasCart || !raw)) {
    return { status: "preorder", quantity: null, evidence: "preorder-buy-box", verified: true };
  }
  if (oos && !fromStock) {
    return { status: "out_of_stock", quantity: quantity === 0 ? 0 : null, evidence: "page", verified: true };
  }
  if (badgeStatus === "out_of_stock") {
    return { status: "out_of_stock", quantity: null, evidence: "badge", verified: true };
  }
  if (badgeStatus === "dropshipping") {
    return { status: "dropshipping", quantity: null, evidence: "badge", verified: true };
  }
  if (hasPrice && !hasCart) return extra.deferMissingCart
    ? { status: "unknown", quantity: null, evidence: "product-page-required", verified: false }
    : { status: "out_of_stock", quantity: null, evidence: "no-add-to-cart", verified: true };
  if (extra.filterVerified === true) {
    return { status: "in_stock", quantity, evidence: "retailer-stock-only-filter", verified: true };
  }
  if (Number.isFinite(quantity) && quantity > 0) {
    return { status: "in_stock", quantity, evidence: "stok-miktari", verified: true };
  }
  if (/stok durumu\s+var/.test(t) || fromStock || /\bin stock\b/.test(t)) {
    return { status: "in_stock", quantity, evidence: "stok-durumu", verified: true };
  }
  if (hasCart) {
    return { status: "in_stock", quantity, evidence: "add-to-cart", verified: true };
  }
  if (badgeStatus === "in_stock") {
    return { status: "in_stock", quantity, evidence: "badge", verified: true };
  }
  // No buy-box cart and no in-stock evidence anywhere: the product is not buyable now. This used to
  // return "unknown", which let pages with no Sepete Ekle sit in default results and set the headline
  // price. A page we could not actually read (empty or truncated) stays unknown - that is no answer,
  // rather than an answer of no.
  if (raw.length < 400) return { status: "unknown", quantity: null, evidence: "short-html", verified: false };
  return { status: "out_of_stock", quantity: null, evidence: "no-add-to-cart", verified: true };
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
    let priced = null;
    for (let i = opens.length - 1; i >= 0; i--) {
      const o = opens[i];
      if (o.start > pos) continue;
      const block = closeElement(html, o.tag, o.start, o.end);
      if (block.end <= pos) continue;
      // Walking outwards, the first container holding the whole grid means we overshot.
      if ((block.html.match(/<a\b/gi) || []).length > DISCOVER_MAX_CARD_LINKS) break;
      if (!hasPriceText(block.inner)) continue;
      if (!priced) priced = block;
      if (/sepete ekle|sepet\s*ekle|add to cart|addtocart\s*\(/i.test(block.html)) {
        picked = block;
        break;
      }
    }
    picked ||= priced;
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
    return classes.some((c) => titleish.test(c)) && !/fiyat|price|sepet|cart|buton|button|link|stok|stock|brand|marka/i.test(classes.join(" "));
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
  const stock = readStockFromHtml(block.html, { badge, deferMissingCart: opts && opts.deferMissingCart }).status;
  if (inStockOnly && !isBuyableStock(stock)) {
    return { rejected: { url, reason: "out_of_stock", name } };
  }
  const priceInfo = cardPriceDetail(block.html);
  const price = priceInfo.price;
  if (!Number.isFinite(price) || price <= 0) {
    return { rejected: { url, reason: "no current sale price", name } };
  }
  const image = cardImage(block.html, base);
  const brand = stripTags((extractElements(block.html, (tag, attrs) => hasClass(attrs, "brand") || hasClass(attrs, "brand-title"))[0] || {}).inner || "");
  const vatStatus = vatFromText(block.html);
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
    vatStatus,
    vatExcluded: vatStatus === "excluded",
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

// Prices must never be read out of <script>/<style>/comments: the raw HTML of a modern shop is
// full of numbers (ids, quantities, inline JSON) and scanning it produced prices like "2".
function withoutScripts(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
}

// Markup with the noise gone. pickPrice reads element classes to tell a sale price from a list
// price, so it needs the tags — it must just not see the scripts.
function markupText(html) {
  return withoutScripts(html);
}

function visibleText(html) {
  return stripTags(withoutScripts(html));
}

// What the page itself declares the price to be, before any guessing. This is the reliable
// source on shops whose price only lands in the markup later, or sits outside the card.
function structuredPrice(html) {
  const ld = jsonLdProduct(html);
  if (ld) {
    const offers = Array.isArray(ld.offers) ? ld.offers : ld.offers ? [ld.offers] : [ld];
    for (const off of offers) {
      if (!off) continue;
      const amount = parseMoney(off.price != null ? off.price : off.lowPrice != null ? off.lowPrice : off.highPrice);
      if (amount) {
        const currency = String(off.priceCurrency || ld.priceCurrency || "").toUpperCase();
        return { price: amount, currency, method: "json-ld" };
      }
    }
  }
  const re = String(html || "");
  const micro = re.match(/itemprop=["']price["'][^>]*content=["']([^"']+)/i) || re.match(/content=["']([^"']+)["'][^>]*itemprop=["']price["']/i);
  if (micro) {
    const amount = parseMoney(micro[1]);
    const currency = ((re.match(/itemprop=["']priceCurrency["'][^>]*content=["']([^"']+)/i)
      || re.match(/content=["']([^"']+)["'][^>]*itemprop=["']priceCurrency["']/i) || [])[1]
      || metaContent(html, "product:price:currency") || "").toUpperCase();
    if (amount) return { price: amount, currency, method: "microdata" };
  }
  for (const prop of ["product:price:amount", "og:price:amount"]) {
    const amount = parseMoney(metaContent(html, prop));
    if (amount) return { price: amount, currency: String(metaContent(html, "product:price:currency") || "").toUpperCase(), method: "meta" };
  }
  const attr = re.match(/data-(?:price|price-value|product-price)=["']([0-9][0-9.,]*)["']/i);
  if (attr) {
    const amount = parseMoney(attr[1]);
    if (amount) return { price: amount, currency: "", method: "attribute" };
  }
  return null;
}

// A storefront's formatted product cart price is stronger evidence than list/sale labels.
// Formatted values are used deliberately: raw numeric fields may exclude VAT.
function transactionPrice(html) {
  const raw = String(html || "");
  const attr = raw.match(/data-(?:cart|basket|checkout)-(?:price|total)=["']([^"']+)["']/i);
  const values = [attr && attr[1]];
  for (const pair of raw.matchAll(/"([^"]+)"\s*:\s*"([^"]+)"/g)) {
    const key = turkishFold(pair[1]);
    if (/(sepet|cart|basket)/.test(key) && /(fiyat|price)/.test(key) && /(str|string|formatted)$/.test(key)) values.push(pair[2]);
  }
  for (const value of values) {
    const picked = pickMoney(value || "");
    if (picked) return { price: picked.amount, currency: picked.currency || "", method: "cart-price" };
  }
  return null;
}

// Some B2B storefronts print a net amount as JSON-LD/current price and a separate customer total.
// When the page labels that total as VAT included, use the exact displayed number instead of
// multiplying the net amount and introducing rounding differences.
function vatIncludedPrice(html) {
  const raw = visibleText(html);
  const hit = raw.match(/(?:KDV\s*(?:Dahil|Dahildir)|vergi(?:ler)?\s*dahil)\s*:?[\s\S]{0,180}/i);
  if (!hit) return null;
  const picked = moneyTokens(hit[0])[0];
  return picked ? { price: picked.amount, currency: picked.currency || "", method: "vat-included-price" } : null;
}

// A price below this cannot be a real product price on these shops; storing one is worse than
// storing nothing, because it wins "best price" on the storefront. Rough conversion for the
// non-TRY shops so a junk filter never rejects a legitimate $30 accessory.
const PRICE_FLOOR = { printer: 1000, filament: 60, other: 10 };
function priceFloor(kind, currency) {
  const base = PRICE_FLOOR[kind] != null ? PRICE_FLOOR[kind] : PRICE_FLOOR.other;
  const cur = String(currency || "TRY").toUpperCase();
  if (!cur || cur === "TRY") return base;
  return Math.round((base / 40) * 100) / 100; // ~40 TRY per USD/EUR, plenty of margin
}

const foldName = (v) => String(v || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

function jsonLdProduct(html) {
  const blocks = String(html || "").matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const b of blocks) {
    try {
      const j = JSON.parse(b[1]);
      const nodes = (Array.isArray(j) ? j : [j]).flatMap((n) => n && Array.isArray(n["@graph"]) ? n["@graph"] : [n]);
      const p = nodes.find((n) => /Product/i.test(String((n && n["@type"]) || "")));
      if (p) return p;
    } catch {
      /* ignore malformed JSON-LD */
    }
  }
  return null;
}

function looksLikeProductName(value, url, brand) {
  const name = foldName(value);
  if (!name || isBadgeText(value) || (brand && name === foldName(brand))) return false;
  let site = "";
  try { site = foldName(new URL(url).hostname.replace(/^www\./, "").split(".")[0]); } catch { /* no host */ }
  const siteOnly = name.split(" ").every((word) => word === site || /^(shop|magaza|store)$/.test(word));
  return !siteOnly && !/^(home|anasayfa|products?|urunler|shop|magaza|store|catalog|katalog)$/.test(name);
}

function metaContent(html, prop) {
  const re = new RegExp("<meta[^>]+(?:property|name)=[\"']" + prop + "[\"'][^>]+content=[\"']([^\"']+)", "i");
  const alt = new RegExp("<meta[^>]+content=[\"']([^\"']+)[\"'][^>]+(?:property|name)=[\"']" + prop + "[\"']", "i");
  return ((String(html || "").match(re) || String(html || "").match(alt) || [])[1] || "").trim();
}

function extractProductPage(html, url, kind) {
  const raw = String(html || "");
  const ld = jsonLdProduct(raw);
  const brandBlock = stripTags((extractElements(raw, (tag, attrs) => hasClass(attrs, "brand") || hasClass(attrs, "brand-title") || /itemprop=["']brand["']/i.test(attrs))[0] || {}).inner || "");
  const ldBrand = ld && (typeof ld.brand === "string" ? ld.brand : ld.brand && ld.brand.name);
  const brandHint = (brandBlock && !isBadgeText(brandBlock) ? brandBlock : "") || ldBrand || "";
  const ldName = ld && ld.name;
  const ogTitle = metaContent(raw, "og:title");
  const twitterTitle = metaContent(raw, "twitter:title");
  const h1 = stripTags(((extractElements(raw, (tag) => tag === "h1")[0] || {}).inner || ""));
  const socialTitle = [ogTitle, twitterTitle].find((v) => looksLikeProductName(v, url, brandHint));
  let name = (ldName || socialTitle || h1 || slugToTitle(url) || "").replace(/\s+[-–]\s*(STOKTAN|Dropshipping|ÖN SİPARİŞ).*$/i, "").trim();
  if (isBadgeText(name)) name = slugToTitle(url);
  let id = extractIdentity(name);
  const brand = brandHint || id.brand || "";
  // A page without an h1 or og:title leaves us holding the JSON-LD brand, which is how whole
  // shelves ended up named "Bambu Lab". The URL knows better than that.
  if (!name || (brand && foldName(name) === foldName(brand))) {
    name = slugToTitle(url) || name;
    id = extractIdentity(name);
  }
  const image = resolveProductImage({ productPageHtml: raw, pageUrl: url, productUrl: url }) || "";
  const detectedCurrency = detectCurrency(raw) || "";
  const includedTotal = vatIncludedPrice(raw);
  const transaction = transactionPrice(raw);
  const structured = structuredPrice(raw);
  // No PRICE_RE "hint": that regex is loose enough to match the "1" inside "A1", and pickPrice
  // trusts a fallback over its own reading — so a fallback made junk the headline price. It
  // scans the text by itself anyway.
  const fromText = pickPrice(markupText(raw), null, { currency: detectedCurrency });
  // Two sources, one price. The declared price is authoritative when only it is believable (the
  // card text is often script-rendered, which is how a "2 TL" got published). When both are
  // believable and one is ~20% above the other, they are the KDV-exclusive and KDV-inclusive
  // pair the shop prints side by side: the customer pays the higher one.
  const floor = priceFloor(kind, (structured && structured.currency) || detectedCurrency);
  const believable = [];
  if (includedTotal && includedTotal.price >= priceFloor(kind, includedTotal.currency || detectedCurrency)) believable.push({ price: includedTotal.price, currency: includedTotal.currency || detectedCurrency, raw: String(includedTotal.price), was: undefined, source: includedTotal.method });
  if (transaction && transaction.price >= priceFloor(kind, transaction.currency || detectedCurrency)) believable.push({ price: transaction.price, currency: transaction.currency || detectedCurrency, raw: String(transaction.price), was: undefined, source: transaction.method });
  if (structured && structured.price >= priceFloor(kind, structured.currency)) believable.push({ price: structured.price, currency: structured.currency || detectedCurrency, raw: String(structured.price), was: undefined, source: structured.method });
  if (fromText && fromText.price >= priceFloor(kind, fromText.currency || detectedCurrency)) believable.push({ ...fromText, source: "page-text" });
  let picked = believable[0];
  if (includedTotal && believable.some((c) => c.source === "vat-included-price")) {
    picked = believable.find((c) => c.source === "vat-included-price");
  } else if (transaction && believable.some((c) => c.source === "cart-price")) {
    picked = believable.find((c) => c.source === "cart-price");
  } else if (believable.length > 1) {
    const sorted = believable.slice().sort((a, b) => b.price - a.price);
    const pair = sorted[1].price > 0 && sorted[0].price / sorted[1].price <= 1.25;
    picked = pair ? sorted[0] : believable.find((c) => c.source !== "page-text") || sorted[0];
  }
  // Nothing believable at all: report it instead of publishing a number we do not trust.
  if (!picked) {
    const rejected = (structured && structured.price) || (fromText && fromText.price) || null;
    return {
      incomplete: { url, name, brand, kind: classifyProductType(name, brand), price: null, priceRejected: rejected, priceCurrency: detectedCurrency || "TRY", image, vatStatus: vatFromText(raw) },
      reason: rejected
        ? "incomplete: implausible price " + rejected + " (below the floor for a " + kind + ")"
        : "incomplete: no price on the page"
    };
  }
  const detectedType = classifyProductType(name, brand);
  const declaredType = declaredLabel(kind);
  const stock = readStockFromHtml(raw);
  const vatStatus = vatFromText(raw);
  const product = {
    url,
    name,
    brand,
    kind: detectedType,
    price: picked.price,
    was: picked.was,
    priceSource: picked.source || "page-text",
    priceCurrency: picked.currency || detectedCurrency || "TRY",
    plusVat: picked.plusVat === true,
    vatStatus,
    vatIncluded: vatStatus === "included" ? true : vatStatus === "excluded" ? false : undefined,
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
  // Junk that slipped through every other guard is refused here rather than published: a 2 TL
  // "printer" would be the best price on the whole site.
  if (product.price < priceFloor(product.kind, product.currency || product.priceCurrency)) {
    return { incomplete: { ...product, priceRejected: product.price }, reason: "implausible price " + product.price + " (below the " + product.kind + " floor)" };
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
    const deferMissingCart = list.length > 1 && !list.some((card) => /sepete ekle|sepet\s*ekle|add to cart|addtocart\s*\(/i.test(card.html));
    for (const card of list) {
      if (inScope.length >= cap) break;
      const parsed = parseCard(card, base, kind, categoryUrl, { inStockOnly, deferMissingCart });
      const url = (parsed.product || parsed.mismatch || parsed.rejected || {}).url;
      if (url && seen.has(url)) continue;
      if (url) seen.add(url);
      if (parsed.rejected) rejected.push(parsed.rejected);
      else if (parsed.mismatch) mismatches.push(parsed.mismatch);
      else if (parsed.product) inScope.push(parsed.product);
    }
  };
  parseAll(cards);
  // If selectors only caught a couple of wrappers, still merge the page's own
  // product-link cluster (ASP.NET / unknown grids). Skip only when selectors
  // already found at least as many in-scope cards.
  let discovery = null;
  const found = discoverCards(pageHtml);
  if (found.length > inScope.length) {
    const best = discoverProductLinks(pageHtml)[0];
    discovery = { pattern: best ? best.key : "", cards: found.length, links: best ? best.size : 0 };
    parseAll(found);
  }
  scrubClonedImages(inScope);
  const warning = !cards.length && !discovery ? "no product grid on this URL (use a listing/collection page, not the homepage)" : "";
  return { inScope, mismatches, rejected, warning, discovery };
}

module.exports = {
  structuredPrice,
  transactionPrice,
  vatIncludedPrice,
  visibleText,
  markupText,
  priceFloor,
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
