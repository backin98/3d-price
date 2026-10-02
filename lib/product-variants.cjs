"use strict";

// The options a product page sells under one card: colours of one filament, mostly.
//
// Some shops (Filament Marketim among them) list one card per filament model on the category page and
// put the colours on the product page as options. A run that only reads the card gets one colourless
// listing for a whole family. This reads the options from the product page, whatever the shop runs on:
//
//   - WooCommerce   <form class="variations_form" data-product_variations="[…]">
//   - Shopify       product JSON ({"variants":[{"id","option1","price"(kuruş),"available"}]}), ?variant=<id>
//   - ikas / Next   __NEXT_DATA__ product.variants[].variantValues + productVariantTypes
//   - JSON-LD       ProductGroup.hasVariant, or a Product whose offers are one per option
//   - any page data a script assigns (Ticimax, IdeaSoft, custom): an array of objects that each carry an
//                   option label and a price, found under a variant-ish key
//   - plain HTML    a colour <select> / radio group (page price and stock for every option)
//   - colour links  each colour its own product page, linked from a colour picker: returned as links
//
// variantsFromPage(html, pageUrl, { pagePrice }) →
//   { source, variants: [{ label, url, price, was, stock, image, id }], links: [{ url, label }] }
// An empty result means the page offers no choice. Labels are the shop's own words ("Siyah", "Silk Gold
// / 1 KG"); the caller appends them to the title and lets the filament classifier read them.

const OPTION_KEY = /variant|varyant|secenek|seçenek|option|combination|kombinasyon|sku|ekSecenek|alt_?urun/i;
const ROW_LABEL_KEYS = ["public_title", "variantName", "variant_name", "optionName", "option_name", "tanim", "deger", "renk", "color", "colour", "value", "title", "name"];
const PRICE_KEYS = ["display_price", "sellPrice", "salePrice", "sale_price", "finalPrice", "final_price", "discountPrice", "discountedPrice", "satisFiyati", "indirimliFiyat", "fiyat", "price", "Price"];
const WAS_KEYS = ["display_regular_price", "compare_at_price", "compareAtPrice", "regular_price", "listPrice", "oldPrice", "piyasaFiyati"];
const STOCK_BOOL_KEYS = ["available", "is_in_stock", "isInStock", "inStock", "in_stock", "stokta", "isActive"];
const STOCK_NUM_KEYS = ["stock", "stocks", "stockCount", "stock_count", "quantity", "inventory_quantity", "stokAdedi", "stokMiktari", "max_qty"];
const ID_KEYS = ["variation_id", "variantId", "variant_id", "id", "sku"];
const COLOUR_WORD = /renk|colou?r|ton\b/i;

const decodeEntities = (s) => String(s || "")
  .replace(/&quot;/g, '"').replace(/&#0?34;/g, '"').replace(/&#0?39;|&apos;/g, "'")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#x2F;/gi, "/").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
  .replace(/&amp;/g, "&");
const stripTags = (s) => decodeEntities(String(s || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const attr = (attrs, name) => {
  const m = String(attrs || "").match(new RegExp("\\b" + name + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)')", "i"));
  return m ? decodeEntities(m[1] != null ? m[1] : m[2]) : "";
};
const slug = (s) => String(s || "").toLocaleLowerCase("tr").normalize("NFD").replace(/\p{M}/gu, "").replace(/ı/g, "i")
  .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
const isObj = (x) => x && typeof x === "object" && !Array.isArray(x);

// "1.299,90" / "1299.90" / 1299.9 → 1299.9
function money(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : NaN;
  const t = String(v == null ? "" : v).replace(/[^\d.,-]/g, "");
  if (!t) return NaN;
  if (/,\d{1,2}$/.test(t)) return Number(t.replace(/\./g, "").replace(",", "."));
  if (/\.\d{3}(?:[.,]|$)/.test(t) && !/\.\d{1,2}$/.test(t)) return Number(t.replace(/[.,]/g, ""));
  return Number(t.replace(/,/g, ""));
}

// Shopify JSON speaks kuruş (89990 = 899,90 TL). When the page price is known, a value that is 100× it is
// read in kuruş; without one, an integer on a Shopify page is.
function amount(v, ctx) {
  let n = money(v);
  if (!Number.isFinite(n) || n <= 0) return NaN;
  const page = Number(ctx && ctx.pagePrice);
  if (page > 0) {
    const asKurus = n / 100;
    if (Math.abs(asKurus - page) / page < 0.6 && Math.abs(n - page) / page > 5) n = asKurus;
  } else if (ctx && ctx.kurus && Number.isInteger(n) && typeof v === "number") {
    n = n / 100;
  }
  return Math.round(n * 100) / 100;
}

function absolute(u, base) {
  try { return new URL(decodeEntities(u), base).href; } catch { return ""; }
}

// A variant URL that is its own: the shop's when it gives one, else the page with ?variant=<id or label>.
function variantUrl(base, key, value) {
  try {
    const u = new URL(base);
    u.hash = "";
    u.searchParams.set(key, value);
    return u.href;
  } catch { return ""; }
}

// --- JSON found on the page --------------------------------------------------------------------------
// Every JSON value the page carries: <script type="application/json">, __NEXT_DATA__, and objects or
// arrays a script assigns (var x = {...}; window.x = [...]). Bracket matching is string-aware, and only
// what JSON.parse accepts is kept, so a JS object literal with functions is skipped, not guessed at.
function balanced(text, at) {
  const open = text[at];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let quote = "";
  for (let i = at; i < text.length && i - at < 3000000; i++) {
    const c = text[i];
    if (quote) {
      if (c === "\\") { i++; continue; }
      if (c === quote) quote = "";
      continue;
    }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") {
      depth--;
      if (depth === 0) return c === close ? text.slice(at, i + 1) : "";
    }
  }
  return "";
}

function pageJson(html) {
  const out = [];
  const tryParse = (s) => { try { const v = JSON.parse(s); if (v && typeof v === "object") out.push(v); } catch { /* not JSON */ } };
  for (const m of String(html || "").matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const type = attr(m[1], "type").toLowerCase();
    const body = m[2].trim();
    if (!body || type === "application/ld+json") continue;
    if (type === "application/json" || /^[{[]/.test(body) && type !== "text/template") { tryParse(body); continue; }
    for (const a of body.matchAll(/(?:^|[;\s,(])(?:var|let|const)?\s*(?:window\.)?[\w$.\[\]'"]+\s*=\s*(?=[{[])/g)) {
      const start = a.index + a[0].length;
      const chunk = balanced(body, start);
      if (chunk && chunk.length > 20) tryParse(chunk);
    }
    for (const a of body.matchAll(/JSON\.parse\(\s*(['"])((?:\\.|(?!\1).)*)\1\s*\)/g)) {
      try { tryParse(JSON.parse('"' + a[2].replace(/\\'/g, "'").replace(/(^|[^\\])"/g, '$1\\"') + '"')); } catch { /* skip */ }
    }
  }
  return out;
}

function jsonLd(html) {
  const out = [];
  for (const m of String(html || "").matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(m[1].trim());
      for (const n of [].concat(data)) out.push(...(n && n["@graph"] ? [].concat(n["@graph"]) : [n]));
    } catch { /* skip */ }
  }
  return out.filter(isObj);
}

// The label of one option row, from whichever shape the platform uses.
function rowLabel(row, typeNames) {
  const opts = [row.option1, row.option2, row.option3].filter((x) => x != null && x !== "" && x !== "Default Title");
  if (row.public_title && row.public_title !== "Default Title") return String(row.public_title);
  if (opts.length) return opts.join(" / ");
  if (Array.isArray(row.variantValues) && row.variantValues.length) {
    const names = row.variantValues.map((v) => (isObj(v) ? v.variantValueName || v.valueName || v.name || v.value || (typeNames && typeNames.get(String(v.variantValueId || v.valueId || v.id))) : v)).filter(Boolean);
    if (names.length) return names.join(" / ");
  }
  for (const key of ["selectedOptions", "options", "optionValues", "values", "ekSecenekList", "secenekler"]) {
    if (Array.isArray(row[key]) && row[key].length && row[key].every((o) => isObj(o) || typeof o === "string")) {
      // {tanim: "Renk", deger: "Lacivert"}: the type name comes first in some shapes, the value is what sells.
      const names = row[key].map((o) => (isObj(o) ? o.value || o.deger || o.valueName || o.label || o.name || o.tanim : o)).filter((x) => typeof x === "string" && x);
      if (names.length) return names.join(" / ");
    }
  }
  if (isObj(row.attributes)) {
    const vals = Object.values(row.attributes).filter((x) => typeof x === "string" && x);
    if (vals.length) return vals.join(" / ");
  }
  for (const key of ROW_LABEL_KEYS) {
    const v = row[key];
    if (typeof v === "string" && v.trim() && v !== "Default Title") return v.trim();
    if (isObj(v) && typeof (v.name || v.value) === "string") return v.name || v.value;
  }
  return "";
}

function rowPrice(row, ctx) {
  for (const key of PRICE_KEYS) {
    const v = row[key];
    if (v == null) continue;
    if (isObj(v)) { const n = amount(v.amount != null ? v.amount : v.value != null ? v.value : v.sellPrice, ctx); if (n > 0) return n; continue; }
    const n = amount(v, ctx);
    if (n > 0) return n;
  }
  if (Array.isArray(row.prices) && row.prices[0]) {
    const p = row.prices[0];
    const n = amount(p.discountPrice || p.sellPrice || p.price, ctx);
    if (n > 0) return n;
  }
  if (isObj(row.offers)) return amount(row.offers.price || row.offers.lowPrice, ctx);
  return NaN;
}

function rowWas(row, ctx, price) {
  for (const key of WAS_KEYS) {
    const n = amount(row[key], ctx);
    if (n > price) return n;
  }
  if (Array.isArray(row.prices) && row.prices[0] && row.prices[0].discountPrice) {
    const n = amount(row.prices[0].sellPrice, ctx);
    if (n > price) return n;
  }
  return undefined;
}

function rowStock(row) {
  for (const key of STOCK_BOOL_KEYS) {
    if (typeof row[key] === "boolean") {
      if (key === "isActive" && row[key] === true) continue; // active is not "in stock"
      return row[key] ? "in_stock" : "out_of_stock";
    }
  }
  for (const key of STOCK_NUM_KEYS) {
    const v = row[key];
    if (typeof v === "number" || (typeof v === "string" && /^\d+$/.test(v))) return Number(v) > 0 ? "in_stock" : "out_of_stock";
    if (Array.isArray(v) && v[0] && Number.isFinite(Number(v[0].stockCount))) return Number(v[0].stockCount) > 0 ? "in_stock" : "out_of_stock";
  }
  const avail = String(row.availability || (isObj(row.offers) && row.offers.availability) || "");
  if (/InStock|LimitedAvailability|OnlineOnly/i.test(avail)) return "in_stock";
  if (/OutOfStock|SoldOut|Discontinued/i.test(avail)) return "out_of_stock";
  if (/PreOrder|BackOrder/i.test(avail)) return "preorder";
  return "";
}

function rowImage(row, base) {
  const pick = (v) => {
    if (!v) return "";
    if (typeof v === "string") return /\.(?:jpe?g|png|webp|avif|gif)(?:[?#]|$)|\/image|cdn/i.test(v) ? absolute(v, base) : "";
    if (isObj(v)) return pick(v.full_src || v.src || v.url || v.imageUrl || v.originalSrc);
    return "";
  };
  return pick(row.featured_image) || pick(row.image) || pick(row.featuredImage) || pick(Array.isArray(row.images) ? row.images[0] : row.images) || "";
}

// Arrays of option rows anywhere in a JSON value. A row is an object with a label and a price; the array
// sits under a variant-ish key or its rows carry option-ish fields, so a "related products" list (rows
// with their own names and prices) does not pass for colours.
function optionArrays(root) {
  const found = [];
  const seen = new Set();
  let budget = 60000;
  const walk = (node, key, parent, depth) => {
    if (!node || typeof node !== "object" || depth > 14 || budget-- <= 0 || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      const rows = node.filter(isObj);
      if (rows.length && rows.length === node.length) {
        const optionish = rows.filter((r) => r.option1 != null || r.public_title != null || Array.isArray(r.variantValues) || isObj(r.attributes) || r.variation_id != null || Array.isArray(r.selectedOptions) || Array.isArray(r.ekSecenekList)).length;
        if (OPTION_KEY.test(key || "") || optionish === rows.length) found.push({ key, rows, parent });
      }
      node.forEach((x) => walk(x, key, parent, depth + 1));
      return;
    }
    for (const [k, v] of Object.entries(node)) walk(v, k, node, depth + 1);
  };
  walk(root, "", null, 0);
  return found;
}

// ikas: the variant value ids name their values in productVariantTypes.
function typeNamesOf(parent) {
  const map = new Map();
  for (const key of ["productVariantTypes", "variantTypes", "variant_types"]) {
    for (const t of (parent && Array.isArray(parent[key]) ? parent[key] : [])) {
      const type = t.variantType || t;
      for (const v of type.values || type.variantValues || []) if (v && v.id != null) map.set(String(v.id), v.name || v.value);
    }
  }
  return map;
}

function fromJson(html, base, ctx) {
  let best = null;
  for (const root of pageJson(html)) {
    for (const cand of optionArrays(root)) {
      const names = typeNamesOf(cand.parent);
      const kurus = { ...ctx, kurus: ctx.kurus || cand.rows.some((r) => r.option1 !== undefined && r.available !== undefined) };
      const variants = cand.rows.map((r) => {
        const label = rowLabel(r, names);
        const price = rowPrice(r, kurus);
        const id = ID_KEYS.map((k) => r[k]).find((x) => x != null && x !== "");
        const own = typeof r.url === "string" && r.url ? absolute(r.url, base) : "";
        return {
          label: String(label || "").trim(),
          price,
          was: rowWas(r, kurus, price),
          stock: rowStock(r),
          image: rowImage(r, base),
          id: id != null ? String(id) : "",
          url: own && own !== base ? own : ""
        };
      }).filter((v) => v.label && v.price > 0);
      const labels = new Set(variants.map((v) => v.label.toLocaleLowerCase("tr")));
      // Options are distinct labels of one product; at least two of them, or one that names a choice.
      if (variants.length < 2 || labels.size < variants.length * 0.8) continue;
      // The fullest copy wins: Shopify pages carry the variants twice, once with price only (analytics)
      // and once with stock and pictures.
      const detail = variants.filter((v) => v.stock).length + variants.filter((v) => v.image).length;
      const score = variants.length * 2 + (OPTION_KEY.test(cand.key || "") ? 5 : 0) + detail;
      if (!best || score > best.score) best = { score, variants, source: "json:" + (cand.key || "array") };
    }
  }
  return best;
}

function fromWoo(html, base, ctx) {
  const form = String(html || "").match(/<form\b[^>]*data-product_variations=(["'])([\s\S]*?)\1[^>]*>/i);
  if (!form) return null;
  let rows;
  try { rows = JSON.parse(decodeEntities(form[2])); } catch { return null; }
  if (!Array.isArray(rows) || !rows.length) return null;
  // Attribute slugs → the words the shop shows ("siyah" → "Siyah") from the matching <select>.
  const labels = new Map();
  for (const sel of String(html).matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)) {
    const name = attr(sel[1], "name") || attr(sel[1], "data-attribute_name");
    for (const o of sel[2].matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)) {
      const value = attr(o[1], "value");
      if (name && value) labels.set(name + "=" + value, stripTags(o[2]));
    }
  }
  const variants = rows.map((r) => {
    const attrs = isObj(r.attributes) ? r.attributes : {};
    const parts = Object.entries(attrs).filter(([, v]) => v);
    const label = parts.map(([k, v]) => labels.get(k + "=" + v) || String(v).replace(/-/g, " ")).join(" / ");
    let url = base;
    for (const [k, v] of parts) url = variantUrl(url, k, v);
    const price = amount(r.display_price, ctx);
    return {
      label, price,
      was: amount(r.display_regular_price, ctx) > price ? amount(r.display_regular_price, ctx) : undefined,
      stock: r.is_in_stock === false ? "out_of_stock" : r.is_in_stock === true ? "in_stock" : "",
      image: rowImage(r, base),
      id: String(r.variation_id || ""),
      url: parts.length ? url : ""
    };
  }).filter((v) => v.label && v.price > 0);
  return variants.length ? { variants, source: "woocommerce" } : null;
}

function fromJsonLd(html, base, ctx) {
  for (const n of jsonLd(html)) {
    const type = [].concat(n["@type"] || "").join(" ");
    if (/ProductGroup/i.test(type) && Array.isArray(n.hasVariant) && n.hasVariant.length > 1) {
      const variants = n.hasVariant.filter(isObj).map((p) => {
        const offer = [].concat(p.offers || [])[0] || {};
        const label = [p.color, p.size, p.material, p.pattern].filter(Boolean).join(" / ") || String(p.name || "").replace(String(n.name || ""), "").replace(/^[\s\-–|/]+/, "").trim() || p.name;
        return { label, price: amount(offer.price || offer.lowPrice, ctx), stock: rowStock({ availability: offer.availability }), image: rowImage({ image: [].concat(p.image || [])[0] }, base), id: String(p.sku || p.productID || ""), url: offer.url || p.url ? absolute(offer.url || p.url, base) : "" };
      }).filter((v) => v.label && v.price > 0);
      if (variants.length > 1) return { variants, source: "json-ld:ProductGroup" };
    }
    if (/Product/i.test(type)) {
      const offers = [].concat(n.offers || []).flatMap((o) => (o && Array.isArray(o.offers) ? o.offers : [o])).filter(isObj);
      if (offers.length < 2) continue;
      const variants = offers.map((o) => ({
        label: String(o.name || (o.itemOffered && (o.itemOffered.color || o.itemOffered.name)) || o.sku || "").replace(String(n.name || ""), "").replace(/^[\s\-–|/]+/, "").trim(),
        price: amount(o.price || o.lowPrice, ctx), stock: rowStock({ availability: o.availability }), image: "", id: String(o.sku || ""), url: o.url ? absolute(o.url, base) : ""
      })).filter((v) => v.label && v.price > 0);
      if (variants.length > 1 && new Set(variants.map((v) => v.label)).size === variants.length) return { variants, source: "json-ld:offers" };
    }
  }
  return null;
}

// Plain HTML: a colour <select> or radio group. The page's price and stock are every option's.
function fromControls(html, base, ctx) {
  const out = [];
  const h = String(html || "");
  for (const sel of h.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)) {
    const near = h.slice(Math.max(0, sel.index - 300), sel.index);
    const named = [attr(sel[1], "name"), attr(sel[1], "id"), attr(sel[1], "class"), attr(sel[1], "aria-label"), attr(sel[1], "data-name"), stripTags(near).slice(-60)].join(" ");
    if (!COLOUR_WORD.test(named)) continue;
    for (const o of sel[2].matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)) {
      const label = stripTags(o[2]).replace(/\s*\((?:stokta yok|tükendi|out of stock)\)\s*$/i, "").trim();
      const value = attr(o[1], "value");
      if (!label || !value || /^(?:se[cç]iniz|se[cç]im yap[ıi]n|choose|select)/i.test(label) || value === "0") continue;
      const gone = /disabled/i.test(o[1]) || /stokta yok|tükendi|out of stock/i.test(o[2]);
      out.push({ label, price: Number(ctx.pagePrice) || NaN, stock: gone ? "out_of_stock" : "", image: "", id: value, url: "" });
    }
    if (out.length) return { variants: out, source: "select" };
  }
  const radios = [...h.matchAll(/<input\b([^>]*type=["']radio["'][^>]*)>/gi)].filter((m) => COLOUR_WORD.test(attr(m[1], "name")));
  for (const m of radios) {
    const id = attr(m[1], "id");
    const lab = id && h.match(new RegExp("<label\\b[^>]*for=[\"']" + id.replace(/[^\w-]/g, "") + "[\"'][^>]*>([\\s\\S]*?)<\\/label>", "i"));
    const label = (lab && stripTags(lab[1])) || attr(m[1], "data-value") || attr(m[1], "title") || attr(m[1], "value");
    if (label) out.push({ label, price: Number(ctx.pagePrice) || NaN, stock: /disabled/i.test(m[1]) ? "out_of_stock" : "", image: "", id: attr(m[1], "value") || label, url: "" });
  }
  return out.length > 1 ? { variants: out, source: "radio" } : null;
}

// Each colour its own product page, linked from a colour picker block.
function colourLinks(html, base) {
  const h = String(html || "");
  let site = "";
  let here = "";
  try { const u = new URL(base); site = u.hostname.replace(/^www\./, ""); here = u.origin + u.pathname.replace(/\/+$/, ""); } catch { return []; }
  const links = new Map();
  const blocks = /<(div|ul|section|nav)\b([^>]*(?:renk|colou?r|variant|varyant|secenek|swatch)[^>]*)>/gi;
  for (const b of h.matchAll(blocks)) {
    if (!/class|id|data-/i.test(b[2])) continue;
    // The block's own content, nesting followed: a "related products" list after it is not a colour.
    const tag = b[1].toLowerCase();
    const re = new RegExp("<(/?)" + tag + "\\b[^>]*>", "gi");
    re.lastIndex = b.index + b[0].length;
    let depth = 1;
    let end = h.length;
    for (let m; depth && (m = re.exec(h)) && m.index - b.index < 20000;) {
      depth += m[1] ? -1 : 1;
      if (!depth) end = m.index;
    }
    const inner = h.slice(b.index + b[0].length, Math.min(end, b.index + 20000));
    for (const a of inner.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
      const href = absolute(attr(a[1], "href"), base);
      let u;
      try { u = new URL(href); } catch { continue; }
      if (u.hostname.replace(/^www\./, "") !== site || (u.origin + u.pathname.replace(/\/+$/, "")) === here || u.pathname.split("/").filter(Boolean).length === 0) continue;
      const label = stripTags(a[2]) || attr(a[1], "title") || attr(a[1], "aria-label") || attr(a[1], "data-name") || (a[2].match(/alt=["']([^"']+)/i) || [])[1] || "";
      if (!links.has(u.href)) links.set(u.href, { url: u.href, label: decodeEntities(label).trim() });
    }
  }
  return [...links.values()].slice(0, 120);
}

function variantsFromPage(html, pageUrl, opts = {}) {
  const ctx = { pagePrice: Number(opts.pagePrice) || 0 };
  const found = fromWoo(html, pageUrl, ctx) || fromJsonLd(html, pageUrl, ctx) || fromJson(html, pageUrl, ctx) || fromControls(html, pageUrl, ctx);
  const variants = (found ? found.variants : []).map((v) => ({
    ...v,
    url: v.url && v.url !== pageUrl ? v.url : variantUrl(pageUrl, "variant", v.id || slug(v.label))
  }));
  // Two options must never share a URL: same shop + same URL is one offer.
  const seen = new Set();
  const unique = variants.filter((v) => v.url && !seen.has(v.url) && seen.add(v.url));
  return { source: found ? found.source : "", variants: unique, links: unique.length ? [] : colourLinks(html, pageUrl) };
}

module.exports = { variantsFromPage, money, pageJson };
