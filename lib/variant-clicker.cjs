"use strict";

// Colour options a person has to click. Some shops (Filament Marketim, on Qukasoft) draw the options with
// script and change the price, stock and photo only when an option is clicked, so the page HTML holds no
// list of colours to read (lib/product-variants.cjs). This opens the product page in Chromium, finds the
// option group, clicks each option, and reads what the page shows after each click: the option's name,
// the price, whether it can be added to the cart, the main photo and the URL.
//
//   clickThroughOptions(url, { signal, maxOptions, timeoutMs }) →
//     { variants: [{ label, price, priceText, stock, image, url }], groups: [{ name, size }], note }
//
// Only for live runs: a replayed run (SCRAPE_REPLAY_DIR) has no page to click and returns nothing.

const { parseMoney } = require("./parse-money.cjs");

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

const slug = (s) => String(s || "").toLocaleLowerCase("tr").normalize("NFD").replace(/\p{M}/gu, "").replace(/ı/g, "i")
  .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

// Runs in the page. Marks the best option group's controls with data-3dp-opt and describes them.
function findOptionGroups() {
  const GROUP = /variant|varyant|secenek|seçenek|swatch|renk|colou?r|option|attribute|ozellik|özellik/i;
  const COLOUR = /renk|colou?r|ton\b/i;
  const AWAY = /related|benzer|recommend|oneri|öneri|similar|footer|header|menu|navbar|breadcrumb|cart-?list|sepet|comment|yorum|review|tab-?nav|social|share|paylas|filter|filtre|showcase|vitrin|slider-products|product-list|cross/i;
  const QTY = /qty|quantity|adet|miktar|amount|count|taksit|installment|kargo|shipping|il\b|ilce|city|country|sort|sirala/i;
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && st.visibility !== "hidden" && st.display !== "none";
  };
  const away = (el) => {
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      if (/^(header|footer|nav)$/i.test(n.tagName)) return true;
      if (AWAY.test((n.className && n.className.baseVal != null ? n.className.baseVal : n.className || "") + " " + (n.id || ""))) return true;
    }
    return false;
  };
  const labelOf = (el) => {
    const img = el.querySelector && el.querySelector("img");
    const inner = el.querySelector && el.querySelector("[title], [data-title], [aria-label], [data-tooltip]");
    const bits = [el.getAttribute("title"), el.getAttribute("aria-label"), el.getAttribute("data-name"), el.getAttribute("data-title"), el.getAttribute("data-value-name"), el.getAttribute("data-original-title"), el.getAttribute("data-bs-original-title"), el.getAttribute("data-tooltip"), el.getAttribute("data-color"), el.getAttribute("data-renk"), el.getAttribute("data-variant-name"), el.getAttribute("data-text"), (el.innerText || el.textContent || "").trim(), img && (img.getAttribute("alt") || img.getAttribute("title")), inner && (inner.getAttribute("title") || inner.getAttribute("data-title") || inner.getAttribute("aria-label") || inner.getAttribute("data-tooltip")), el.getAttribute("data-value")];
    return (bits.find((b) => b && String(b).trim() && String(b).trim().length < 80) || "").replace(/\s+/g, " ").trim();
  };
  const ctxText = (el) => {
    const own = (el.getAttribute("name") || "") + " " + (el.id || "") + " " + (el.className && el.className.baseVal != null ? el.className.baseVal : el.className || "") + " " + (el.getAttribute("aria-label") || "") + " " + (el.getAttribute("data-name") || "");
    const lab = el.id && document.querySelector("label[for='" + CSS.escape(el.id) + "']");
    let prev = "";
    for (let n = el, i = 0; n && i < 3 && !prev; n = n.parentElement, i++) {
      const p = n.previousElementSibling;
      if (p) prev = (p.innerText || "").slice(0, 60);
    }
    return own + " " + (lab ? lab.innerText : "") + " " + prev;
  };
  const groups = [];
  // 1. Dropdowns.
  for (const sel of document.querySelectorAll("select")) {
    if (away(sel) || QTY.test(ctxText(sel))) continue;
    const opts = [...sel.options].filter((o) => o.value && o.value !== "0" && o.value !== "-1" && !/^(se[cç]iniz|se[cç]im|choose|select|l[uü]tfen)/i.test((o.text || "").trim()));
    if (opts.length < 2) continue;
    const ctx = ctxText(sel);
    if (!GROUP.test(ctx) && !COLOUR.test(ctx) && !opts.some((o) => /siyah|beyaz|black|white|kırmızı|red|mavi|blue/i.test(o.text))) continue;
    groups.push({ kind: "select", el: sel, name: ctx.trim().slice(0, 80), colour: COLOUR.test(ctx), items: opts.map((o) => ({ label: (o.text || "").replace(/\s*\((?:stokta yok|tükendi|tukendi|out of stock)\)\s*$/i, "").trim(), value: o.value, gone: o.disabled || /stokta yok|tükendi|tukendi|out of stock/i.test(o.text) })) });
  }
  // 2. Buttons, swatches, links and radios inside an option-like block.
  const CLICK = "a, button, label, li, input[type=radio], [role=radio], [role=option], [data-value], [data-id], [data-variant], [data-option], span[class*=swatch], div[class*=swatch], span[class*=item], div[class*=item]";
  const seen = new Set();
  for (const box of document.querySelectorAll("div, ul, ol, section, fieldset, dl")) {
    const cls = (box.className && box.className.baseVal != null ? box.className.baseVal : box.className || "") + " " + (box.id || "") + " " + (box.getAttribute("data-name") || "") + " " + (box.getAttribute("data-type") || "");
    if (!GROUP.test(cls) || away(box) || seen.has(box)) continue;
    // The innermost row of choices: direct-ish clickables that are siblings of one another.
    const all = [...box.querySelectorAll(CLICK)].filter((el) => visible(el) && !away(el));
    const byParent = new Map();
    for (const el of all) {
      if (el.tagName === "INPUT" && el.type === "radio") { const k = el.name || el.parentElement; if (!byParent.has(k)) byParent.set(k, []); byParent.get(k).push(el); continue; }
      // A wrapper around a visible choice is not the choice; a label around a hidden radio is.
      if (el.querySelector && [...el.querySelectorAll(CLICK.replace(/, span\[class\*=item\], div\[class\*=item\]/, ""))].some((c) => visible(c))) continue;
      const k = el.parentElement;
      if (!byParent.has(k)) byParent.set(k, []);
      byParent.get(k).push(el);
    }
    for (const [, els] of byParent) {
      const items = els.map((el) => ({ el, label: el.tagName === "INPUT" ? (labelOf(el) || (el.id && document.querySelector("label[for='" + CSS.escape(el.id) + "']") || {}).innerText || el.value || "") : labelOf(el) }))
        .filter((x) => !/^(\+|-|sepete|add|satın|buy|favori|compare|karşılaştır|paylaş|share|\d+)$/i.test(x.label));
      // Colour swatches often carry no text at all: their name is read from the page after the click.
      const named = items.filter((x) => x.label);
      const labels = new Set(named.map((x) => x.label.toLowerCase()));
      const swatchy = items.length >= 2 && items.every((x) => { const r = x.el.getBoundingClientRect(); return r.width <= 90 && r.height <= 90; });
      if (items.length < 2 || items.length > 60 || (named.length < items.length && !swatchy) || labels.size < named.length * 0.8) continue;
      // Size the area: product option rows sit near the price and the add-to-cart button, not page-wide.
      if (items.some((x) => /^https?:/.test(x.label))) continue;
      seen.add(box);
      groups.push({
        kind: "click", name: cls.trim().slice(0, 80), colour: COLOUR.test(cls + " " + ctxText(box)),
        items: items.map((x) => ({ el: x.el, label: x.label, gone: !!(x.el.disabled || x.el.getAttribute("aria-disabled") === "true" || /disabled|passive|pasif|out-?of-?stock|tukendi|tükendi|stoksuz|sold/i.test((x.el.className && x.el.className.baseVal != null ? x.el.className.baseVal : x.el.className || "") + " " + (x.el.parentElement && x.el.parentElement.className || ""))) }))
      });
    }
  }
  // Colour first, then the biggest.
  groups.sort((a, b) => (b.colour - a.colour) || (b.items.length - a.items.length));
  const best = groups[0];
  if (best) {
    if (best.kind === "select") best.el.setAttribute("data-3dp-sel", "1");
    else best.items.forEach((it, i) => it.el.setAttribute("data-3dp-opt", String(i)));
  }
  return {
    groups: groups.map((g) => ({ name: g.name, size: g.items.length, kind: g.kind })),
    best: best ? { kind: best.kind, items: best.items.map((it) => ({ label: it.label, value: it.value, gone: it.gone })) } : null
  };
}

// Runs in the page: what it shows now for the product (price text, cart state, main photo).
function readShown() {
  const visible = (el) => { const r = el.getBoundingClientRect(); const st = getComputedStyle(el); return r.width > 0 && r.height > 0 && st.visibility !== "hidden" && st.display !== "none"; };
  const AWAY = /related|benzer|recommend|similar|footer|header|menu|cart-?list|showcase|vitrin|product-list|cross/i;
  const away = (el) => { for (let n = el; n && n !== document.body; n = n.parentElement) { if (/^(header|footer|nav)$/i.test(n.tagName) || AWAY.test(String(n.className || "") + " " + (n.id || ""))) return true; } return false; };
  const priceEls = [...document.querySelectorAll("[class*=price], [class*=fiyat], [id*=price], [id*=fiyat], [itemprop=price]")]
    .filter((el) => visible(el) && !away(el) && !el.closest("del, s, strike") && !/old|eski|list|market|piyasa|strike|before|discount-rate|indirim-orani|taksit|installment/i.test(String(el.className || "") + " " + (el.id || "")) && /\d/.test(el.innerText || ""));
  // The innermost price element first (no price inside it), in reading order.
  const prices = priceEls.filter((el) => !priceEls.some((o) => o !== el && el.contains(o)));
  const priceText = prices.map((el) => (el.innerText || "").replace(/\s+/g, " ").trim()).find((t) => /\d/.test(t) && t.length < 40) || "";
  const buttons = [...document.querySelectorAll("button, a, input[type=submit], input[type=button]")].filter((b) => visible(b) && !away(b) && /sepete\s*ekle|sepete\s*at|add\s*to\s*cart|hemen\s*al|satın\s*al|buy\s*now/i.test((b.innerText || b.value || "")));
  const cartOn = buttons.some((b) => !b.disabled && b.getAttribute("aria-disabled") !== "true" && !/disabled|passive|pasif/i.test(String(b.className || "")));
  const main = document.querySelector("main") || document.body;
  const soldOut = [...main.querySelectorAll("*")].some((el) => el.children.length === 0 && visible(el) && !away(el) && /^(t[uü]kendi|stokta\s*yok|stok\s*yok|sold\s*out|out\s*of\s*stock|gelince\s*haber\s*ver)$/i.test((el.innerText || "").trim()));
  const imgs = [...document.querySelectorAll("img")].filter((im) => visible(im) && !away(im) && (im.naturalWidth || im.width) >= 200);
  imgs.sort((a, b) => (b.width * b.height) - (a.width * a.height));
  const image = imgs[0] ? (imgs[0].currentSrc || imgs[0].src || "") : "";
  // "Renk: Siyah" / "Seçilen renk: Siyah" near the options, for swatches without a name of their own.
  let selected = "";
  for (const el of main.querySelectorAll("*")) {
    if (el.children.length > 2 || !visible(el) || away(el)) continue;
    const m = (el.innerText || "").match(/(?:se[cç]ilen\s+)?(?:renk|colou?r)\s*[:：]\s*([^\n:]{2,40})$/i);
    if (m) { selected = m[1].trim(); break; }
  }
  const h1 = document.querySelector("h1");
  return { priceText, cartSeen: buttons.length > 0, cartOn, soldOut, image: /^https?:/.test(image) ? image : "", url: location.href, selected, h1: h1 ? h1.innerText.trim() : "" };
}

async function clickThroughOptions(url, opts = {}) {
  if (process.env.SCRAPE_REPLAY_DIR) return { variants: [], groups: [], note: "replay: no page to click" };
  let playwright;
  try { playwright = require("playwright"); } catch { return { variants: [], groups: [], note: "no browser (playwright)" }; }
  const signal = opts.signal;
  const maxOptions = opts.maxOptions || 40;
  const deadline = Date.now() + (opts.timeoutMs || 90000);
  const browser = opts.browser || await playwright.chromium.launch({ headless: true, args: ["--disable-blink-features=AutomationControlled", "--no-sandbox"] });
  const context = await browser.newContext({ userAgent: UA, locale: "tr-TR", extraHTTPHeaders: { "Accept-Language": "tr-TR,tr;q=0.9,en;q=0.7" } });
  const onAbort = () => { context.close().catch(() => {}); };
  if (signal) signal.addEventListener("abort", onAbort, { once: true });
  try {
    const page = await context.newPage();
    await page.route("**/*", (route) => {
      const type = route.request().resourceType();
      const target = route.request().url();
      if (["font", "media"].includes(type) || /(?:google-analytics|googletagmanager|doubleclick|facebook\.net|hotjar|clarity\.ms)/i.test(target)) return route.abort();
      return route.continue();
    });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
    // Options drawn by script can arrive after load.
    let found = await page.evaluate(findOptionGroups);
    for (let i = 0; !found.best && i < 4; i++) {
      await page.waitForTimeout(800);
      found = await page.evaluate(findOptionGroups);
    }
    if (!found.best) return { variants: [], groups: found.groups, note: "no option group on the page", html: opts.keepHtml ? await page.content().catch(() => undefined) : undefined };
    const variants = [];
    const firstShown = await page.evaluate(readShown);
    const items = found.best.items.slice(0, maxOptions);
    for (let i = 0; i < items.length && Date.now() < deadline; i++) {
      if (signal && signal.aborted) break;
      const it = items[i];
      const before = await page.evaluate(readShown);
      try {
        if (found.best.kind === "select") {
          await page.selectOption("[data-3dp-sel]", it.value);
        } else {
          const el = page.locator('[data-3dp-opt="' + i + '"]').first();
          // A link to another page is followed like a click would.
          const href = await el.getAttribute("href").catch(() => null);
          if (href && !/^(#|javascript:)/i.test(href) && new URL(href, page.url()).pathname !== new URL(page.url()).pathname) {
            const sub = await context.newPage();
            await sub.goto(new URL(href, page.url()).href, { waitUntil: "domcontentloaded", timeout: 30000 });
            await sub.waitForLoadState("networkidle", { timeout: 6000 }).catch(() => {});
            const shown = await sub.evaluate(readShown);
            await sub.close();
            variants.push(asVariant(it, shown, url, firstShown));
            continue;
          }
          await el.click({ timeout: 4000, force: true });
        }
      } catch (err) {
        continue;
      }
      // Wait for the page to answer the click: a new price, picture, URL or cart state.
      const t0 = Date.now();
      let shown = before;
      while (Date.now() - t0 < 3500) {
        await page.waitForTimeout(250);
        shown = await page.evaluate(readShown);
        if (shown.priceText !== before.priceText || shown.image !== before.image || shown.url !== before.url || shown.cartOn !== before.cartOn) break;
      }
      await page.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => {});
      shown = await page.evaluate(readShown);
      // A click that navigated: the option list belongs to the old page; find it again on the new one.
      if (shown.url.split("?")[0] !== url.split("?")[0] && found.best.kind !== "select") {
        variants.push(asVariant(it, shown, url, firstShown));
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.waitForLoadState("networkidle", { timeout: 6000 }).catch(() => {});
        found = await page.evaluate(findOptionGroups);
        if (!found.best) break;
        continue;
      }
      variants.push(asVariant(it, shown, url, firstShown));
    }
    const kept = variants.filter((v) => v.label);
    return { variants: kept, groups: found.groups, note: kept.length ? "" : "options found but none could be named", html: kept.length || !opts.keepHtml ? undefined : await page.content().catch(() => undefined) };
  } finally {
    if (signal) signal.removeEventListener("abort", onAbort);
    await context.close().catch(() => {});
    if (!opts.browser) await browser.close().catch(() => {});
  }
}

function asVariant(item, shown, base, before) {
  const price = parseMoney(shown.priceText) || NaN;
  // A swatch without a name: the page says it ("Renk: Siyah"), or the title grows by it.
  let label = item.label;
  if (!label) {
    const h0 = (before && before.h1) || "";
    const grown = shown.h1 && h0 && shown.h1 !== h0 && shown.h1.startsWith(h0) ? shown.h1.slice(h0.length).replace(/^[\s\-–|/,]+/, "").trim() : "";
    label = shown.selected || grown || (shown.h1 && shown.h1 !== h0 ? shown.h1 : "");
  }
  let own = "";
  try {
    const u = new URL(shown.url);
    const b = new URL(base);
    if (u.href !== b.href && u.hostname === b.hostname) own = u.href;
  } catch { /* keep "" */ }
  return {
    label,
    price,
    priceText: shown.priceText,
    // No recognisable cart button at all: say nothing, the page's own stock stands.
    stock: item.gone || shown.soldOut || (shown.cartSeen && !shown.cartOn) ? "out_of_stock" : shown.cartOn ? "in_stock" : "",
    image: shown.image,
    url: own
  };
}

module.exports = { clickThroughOptions, findOptionGroups, readShown, slug };
