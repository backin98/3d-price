#!/usr/bin/env node
"use strict";

// Every enabled shop, printer and filament categories separately, against the LIVE shops. Run it on
// your PC (the worker's Playwright does the browsing, exactly like a real shop run):
//
//   node scripts/shop-report.cjs                          # every shop, each category twice
//   node scripts/shop-report.cjs --shop rhino,robolink    # only these shops (id or name)
//   node scripts/shop-report.cjs --once --sample 8        # one pass, 8 product pages checked per category
//   node scripts/shop-report.cjs --replay work/shop-report/<time>/pages   # again, offline, from saved pages
//
// Writes work/shop-report/<time>/report.md — paste that back — plus report.json (everything) and pages/
// (every page the runs read; replay them later with SCRAPE_REPLAY_DIR=<that folder>).
// Nothing is published and your own store is not touched: the runs use a copy of work/local-store on a
// local host of their own, like scripts/e2e-local-run.cjs.
//
// Per category it reports: listings found vs. what the category page itself shows (and the count the
// shop prints, when it prints one); what was held out as another category (parts, modules, lasers);
// prices (full VAT-inclusive price, not an installment), stock and images, checked against a random
// sample of live product pages; filament polymer / type / colour / weight / diameter; what the matcher
// did with each listing; and what changed between the two passes.

const fs = require("node:fs");
const path = require("node:path");
const { ROOT, hostOf, startStack, runShop, kindForCategory } = require("./local-stack.cjs");

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
const STAMP = new Date().toISOString().replace(/[:.]/g, "-");
const OUT = path.resolve(option("--out", path.join(ROOT, "work", "shop-report", STAMP)));
const PAGES = path.join(OUT, "pages");
const SAMPLE = Math.max(0, Number(option("--sample", 5)) || 0);
const MINUTES = Math.max(5, Number(option("--minutes", 30)) || 30);
const ONLY = String(option("--shop", "")).toLowerCase().split(",").map((s) => s.trim()).filter(Boolean);
const PASSES = flag("--once") ? 1 : 2;
const SEED = Number(option("--seed", Date.now() % 1e9));
const REPLAY = option("--replay", "") ? path.resolve(option("--replay", "")) : "";

// Pages the report itself opens (the spot checks) land in the same archive as the runs' pages; with
// --replay every page comes from that folder instead and nothing goes online.
if (REPLAY) process.env.SCRAPE_REPLAY_DIR = REPLAY;
else process.env.SCRAPE_RECORD_DIR = PAGES;
const archive = require("../lib/page-archive.cjs");
const { fetchHtml, shutdownBrowser } = require("../lib/ai-scraper.cjs");
const { harvestCategory } = require("../lib/harvest.js");
const { classifyProductType } = require("../lib/product-type.cjs");
const { identity, conflicts } = require("../lib/product-match.cjs");

// --- small helpers ---------------------------------------------------------------------------------
function rng(seed) { // mulberry32: the sample is random but can be drawn again with --seed
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const random = rng(SEED);
const sample = (list, n) => { const pool = list.slice(); const out = []; while (pool.length && out.length < n) out.push(pool.splice(Math.floor(random() * pool.length), 1)[0]); return out; };
const trNumber = (s) => { const t = String(s || "").replace(/\s/g, ""); if (!t) return NaN; if (/,\d{1,2}$/.test(t)) return Number(t.replace(/\./g, "").replace(",", ".")); if (/\.\d{3}(\D|$)/.test(t) && !/\.\d{1,2}$/.test(t)) return Number(t.replace(/\./g, "")); return Number(t.replace(/,/g, "")); };
const money = (n) => Number.isFinite(Number(n)) ? Number(n).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " TL" : "—";
const near = (a, b, tol = 0.01) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= Math.max(1, Math.abs(b) * tol);
const median = (xs) => { const s = xs.filter(Number.isFinite).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const textOf = (html) => String(html || "").replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
const tally = (xs) => xs.reduce((m, x) => { m[x] = (m[x] || 0) + 1; return m; }, {});
const errorOf = (c) => String(c.error || "");
const heldOut = (c) => !!(c.mismatch || c.error === "category_mismatch");
const isListing = (c) => !heldOut(c) && !errorOf(c) && Number(c.price) > 0;

// What a product page says, read straight from the page (not through the scraper's own extractor).
function pageFacts(html) {
  const facts = { ldPrice: NaN, ldCurrency: "", availability: "", ldName: "", ldImage: "", metaPrice: NaN, vat: "", installments: [], title: "" };
  for (const m of String(html || "").matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let data;
    try { data = JSON.parse(m[1].trim()); } catch { continue; }
    const nodes = [].concat(data).flatMap((n) => (n && n["@graph"]) ? n["@graph"] : [n]);
    for (const n of nodes) {
      if (!n || !/Product/i.test([].concat(n["@type"] || "").join(" "))) continue;
      const offers = [].concat(n.offers || []).flatMap((o) => (o && o.offers) ? [].concat(o.offers) : [o]).filter(Boolean);
      const offer = offers[0] || {};
      const price = Number(offer.price != null ? offer.price : offer.lowPrice);
      if (!Number.isFinite(facts.ldPrice) && Number.isFinite(price)) facts.ldPrice = price;
      facts.ldCurrency = facts.ldCurrency || String(offer.priceCurrency || "");
      facts.availability = facts.availability || String(offer.availability || "").replace(/^https?:\/\/schema\.org\//i, "");
      facts.ldName = facts.ldName || String(n.name || "");
      const img = [].concat(n.image || [])[0];
      facts.ldImage = facts.ldImage || String((img && (img.url || img)) || "");
    }
  }
  const meta = String(html || "").match(/<meta[^>]+(?:property|itemprop|name)=["'](?:product:price:amount|og:price:amount|price)["'][^>]*content=["']([^"']+)["']/i);
  if (meta) facts.metaPrice = Number(String(meta[1]).replace(",", "."));
  facts.title = ((String(html || "").match(/<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)["']/i) || String(html || "").match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || "").replace(/<[^>]+>/g, "").trim();
  const text = textOf(html);
  facts.vat = /\+\s*KDV|KDV\s*hari[çc]|KDV'?\s*siz/i.test(text) ? "excluded" : /KDV\s*dahil|KDV'?\s*li\b|vergiler\s*dahil/i.test(text) ? "included" : "";
  for (const m of text.matchAll(/(\d{1,2})\s*(?:x|X|×)\s*([\d.]+,\d{2})|([\d.]+,\d{2})\s*(?:TL|₺)?\s*(?:x|X|×)\s*(\d{1,2})\s*(?:ay|taksit)?|(\d{1,2})\s*(?:ay|taksit)[^0-9]{0,12}([\d.]+,\d{2})/g)) {
    const amount = trNumber(m[2] || m[3] || m[6]);
    if (Number.isFinite(amount)) facts.installments.push(amount);
  }
  return facts;
}

// The count a category page prints about itself ("48 ürün listeleniyor", "Toplam 48 ürün", "48 products").
function statedCount(html) {
  const text = textOf(html);
  const patterns = [
    /toplam\s*(\d[\d.]*)\s*(?:adet\s*)?(?:ürün|urun|sonuç|kayıt)/i,
    /(\d[\d.]*)\s*(?:adet\s*)?(?:ürün|urun)\s*(?:bulundu|listeleniyor|listelendi|gösteriliyor|mevcut)/i,
    /(\d[\d.]*)\s*(?:sonuç|results?)\b/i,
    /(\d[\d.]*)\s*(?:products?|items?)\b/i
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      const n = Number(String(m[1]).replace(/\./g, ""));
      if (n > 0 && n < 100000) return { count: n, said: m[0].trim().slice(0, 80) };
    }
  }
  const ld = String(html || "").match(/"numberOfItems"\s*:\s*"?(\d+)/);
  return ld ? { count: Number(ld[1]), said: "numberOfItems " + ld[1] } : null;
}

const fileStem = (u) => { try { return decodeURIComponent(new URL(u).pathname.split("/").pop() || "").replace(/\.[a-z0-9]+$/i, "").replace(/[-_](?:sw\d+sh\d+|\d{2,4}x\d{0,4}|large|medium|small|thumb\w*)$/i, "").toLowerCase(); } catch { return ""; } };

async function imageLoads(url) {
  if (!/^https?:\/\//.test(String(url || ""))) return { ok: false, why: "no image" };
  try {
    const r = await fetch(url, { headers: { accept: "image/*", "user-agent": "Mozilla/5.0 3d-price shop report" }, signal: AbortSignal.timeout(20000) });
    const type = r.headers.get("content-type") || "";
    return { ok: r.ok && /^image\//i.test(type), why: r.ok ? (/^image\//i.test(type) ? "" : "not an image: " + type) : "HTTP " + r.status };
  } catch (err) {
    return { ok: false, why: err.message };
  }
}

// Pages this run read, from the archive index (runs go one at a time, so the time window is the run).
function pagesOf(job, cards) {
  const dir = REPLAY || PAGES;
  let index = {};
  try { index = JSON.parse(fs.readFileSync(path.join(dir, "index.json"), "utf8")); } catch { return { category: [], product: [] }; }
  const from = String(job.startedAt || job.createdAt || "");
  const to = String(job.finishedAt || new Date().toISOString());
  const shop = hostOf(job.url);
  const productUrls = new Set(cards.map((c) => archive.normalize(c.url)));
  const category = [];
  const product = [];
  for (const [url, entry] of Object.entries(index)) {
    if (hostOf(url) !== shop || (!REPLAY && !(entry.fetchedAt >= from && entry.fetchedAt <= to))) continue;
    if (REPLAY && !productUrls.has(url) && !url.startsWith(archive.normalize(job.url).replace(/[?#].*$/, ""))) continue;
    (productUrls.has(url) ? product : category).push({ url, file: path.join(dir, entry.file) });
  }
  return { category, product };
}

async function pageEvidence(run, job, cards) {
  const { category, product } = pagesOf(job, cards);
  const seen = new Map();
  let stated = null;
  for (const page of category) {
    let html = "";
    try { html = fs.readFileSync(page.file, "utf8"); } catch { continue; }
    stated = stated || statedCount(html);
    const all = await harvestCategory({ categoryUrl: run.url, kind: run.kind, html, inStockOnly: false }).catch(() => null);
    const buyable = await harvestCategory({ categoryUrl: run.url, kind: run.kind, html, inStockOnly: true }).catch(() => null);
    const inStock = new Set(((buyable && buyable.inScope) || []).map((p) => p.url));
    for (const p of [...((all && all.inScope) || []), ...((all && all.mismatches) || [])]) {
      seen.set(p.url, { name: p.name, inStock: inStock.has(p.url) || ((buyable && buyable.mismatches) || []).some((m) => m.url === p.url) });
    }
  }
  return { categoryPages: category.map((p) => p.url), productPagesRead: product.length, stated, onPage: seen.size, inStockOnPage: [...seen.values()].filter((v) => v.inStock).length, pageUrls: [...seen.keys()] };
}

async function spotCheck(run, job, listing) {
  const row = { name: listing.sourceTitle || listing.name, url: listing.url, runPrice: Number(listing.price), runStock: listing.stockStatus || "", image: listing.image || "" };
  let html = "";
  try {
    html = await fetchHtml(listing.url, null, { scroll: false, blockResources: true });
  } catch (err) {
    return { ...row, error: "product page did not load: " + err.message };
  }
  const f = pageFacts(html);
  const vatExcluded = job.vat === "excluded" || f.vat === "excluded";
  const pagePrice = Number.isFinite(f.ldPrice) ? f.ldPrice : f.metaPrice;
  const expected = Number.isFinite(pagePrice) ? (vatExcluded ? Math.round(pagePrice * 1.2 * 100) / 100 : pagePrice) : NaN;
  const problems = [];
  if (!Number.isFinite(pagePrice)) problems.push("page states no machine-readable price (checked by eye: see url)");
  else if (!near(row.runPrice, expected) && !near(row.runPrice, pagePrice)) problems.push("price " + money(row.runPrice) + " but the page says " + money(pagePrice) + (vatExcluded ? " + KDV = " + money(expected) : ""));
  if (f.installments.some((a) => near(row.runPrice, a, 0.005)) && !near(row.runPrice, pagePrice)) problems.push("the run price is an installment amount");
  const pageStock = /InStock|LimitedAvailability|OnlineOnly/i.test(f.availability) ? "in_stock" : /OutOfStock|SoldOut|Discontinued/i.test(f.availability) ? "out_of_stock" : /PreOrder|BackOrder/i.test(f.availability) ? "preorder" : "";
  if (pageStock && row.runStock && pageStock !== row.runStock && !(pageStock === "in_stock" && row.runStock === "dropshipping")) problems.push("stock " + row.runStock + " but the page says " + pageStock);
  const img = await imageLoads(row.image);
  if (!img.ok) problems.push("image: " + img.why);
  const stem = fileStem(row.image);
  const onPage = !!stem && (String(html).toLowerCase().includes(stem) || fileStem(f.ldImage) === stem);
  if (img.ok && !onPage) problems.push("the image is not one of this product page's pictures");
  const type = classifyProductType(f.title || f.ldName || row.name, listing.brand);
  if (type !== run.kind && type !== "other") problems.push("the product page reads as " + type + ": " + (f.title || f.ldName));
  return { ...row, pagePrice, pageVat: f.vat, pageStock: f.availability, pageTitle: f.title || f.ldName, problems };
}

function describeRun(run, res) {
  const cards = res.cards;
  const listings = cards.filter(isListing);
  const held = cards.filter(heldOut);
  const failed = cards.filter((c) => !heldOut(c) && errorOf(c));
  const prices = listings.map((c) => Number(c.price));
  const mid = median(prices);
  const decisions = tally(listings.map((c) => (c.decision && c.decision.action) || "none"));
  const types = tally(listings.map((c) => classifyProductType(c.sourceTitle || c.name, c.brand)));
  const offKind = listings.filter((c) => { const t = classifyProductType(c.sourceTitle || c.name, c.brand); return t !== run.kind && t !== "other" && run.kind !== "both"; });
  const images = tally(listings.map((c) => c.image).filter(Boolean));
  const sharedImages = Object.entries(images).filter(([, n]) => n > 1);
  const out = {
    status: res.job.status, seconds: res.seconds, error: res.job.error || "",
    cards: cards.length, listings: listings.length,
    heldOut: held.map((c) => ({ name: c.name, detected: (c.mismatch && c.mismatch.detectedType) || "", url: c.url })),
    held: listings.filter((c) => c.decision && c.decision.action === "held").map((c) => (c.sourceTitle || c.name) + (c.decision.reason ? " (" + String(c.decision.reason).slice(0, 110) + ")" : "")),
    failed: Object.entries(tally(failed.map((c) => errorOf(c).replace(/https?:\/\/\S+/g, "<url>").slice(0, 120)))).map(([why, n]) => ({ why, n, examples: failed.filter((c) => errorOf(c).replace(/https?:\/\/\S+/g, "<url>").slice(0, 120) === why).slice(0, 3).map((c) => c.url) })),
    decisions, types,
    offKind: offKind.map((c) => c.sourceTitle || c.name),
    price: { min: Math.min(...prices), median: mid, max: Math.max(...prices), low: listings.filter((c) => run.kind === "printer" && Number(c.price) < mid * 0.15).map((c) => (c.sourceTitle || c.name) + " " + money(c.price)) },
    stock: tally(listings.map((c) => c.stockStatus || "unknown")),
    noImage: listings.filter((c) => !c.image).map((c) => c.sourceTitle || c.name),
    sharedImages: sharedImages.map(([img, n]) => n + "× " + img),
    // Listings already published whose row they refresh reads as a different product (a combo on the
    // bare row, a dryer bundle on the plain machine): the run keeps your placement and says so.
    rowDoubts: listings.filter((c) => /reads as a different product/.test(String((c.decision && c.decision.reason) || ""))).map((c) => (c.sourceTitle || c.name) + " → " + (c.decision.candidateName || "") + " (" + ((String(c.decision.reason).match(/different product than this row \(([^)]*)\)/) || [])[1] || "") + ")"),
    // Merges must never cross an identity axis (combo, kit, laser W, bundle, part-for): verified live.
    badMerges: listings.filter((c) => c.decision && c.decision.action === "merge" && c.decision.candidateName).map((c) => {
      const clash = conflicts(identity({ name: c.sourceTitle || c.name, brand: c.brand, kind: c.kind || run.kind }), identity({ name: c.decision.candidateName, brand: c.brand, kind: c.kind || run.kind }));
      return clash.length ? (c.sourceTitle || c.name) + " → " + c.decision.candidateName + " (" + clash.join(", ") + ")" : "";
    }).filter(Boolean)
  };
  if (run.kind === "filament") {
    out.filament = {
      noPolymer: listings.filter((c) => !c.polymer).map((c) => c.sourceTitle || c.name),
      noColour: listings.filter((c) => !c.color && !c.multicolor).map((c) => c.sourceTitle || c.name),
      weightAssumed: listings.filter((c) => c.weightAssumed).length,
      weights: tally(listings.map((c) => c.weight || "none")),
      diameters: tally(listings.map((c) => c.diameter || "none")),
      types: tally(listings.map((c) => [c.polymer, c.variant].filter(Boolean).join(" ") || "?"))
    };
  }
  return out;
}

function compareRuns(a, b) {
  const map = (cards) => new Map(cards.filter(isListing).map((c) => [c.url, c]));
  const first = map(a.cards);
  const second = map(b.cards);
  const added = [...second.keys()].filter((u) => !first.has(u));
  const removed = [...first.keys()].filter((u) => !second.has(u));
  const priceChanged = [...first.keys()].filter((u) => second.has(u) && !near(Number(first.get(u).price), Number(second.get(u).price), 0.0001)).map((u) => (first.get(u).sourceTitle || first.get(u).name) + ": " + money(first.get(u).price) + " → " + money(second.get(u).price));
  const stockChanged = [...first.keys()].filter((u) => second.has(u) && (first.get(u).stockStatus || "") !== (second.get(u).stockStatus || "")).map((u) => (first.get(u).sourceTitle || first.get(u).name) + ": " + first.get(u).stockStatus + " → " + second.get(u).stockStatus);
  return { added, removed, priceChanged, stockChanged, stable: !added.length && !removed.length && !priceChanged.length };
}

// --- the report --------------------------------------------------------------------------------------
function markdown(results, skipped, started) {
  const L = [];
  L.push(REPLAY ? "# Shop report (replayed pages, offline)" : "# Shop report (live shops)", "");
  L.push("Run " + started + " → " + new Date().toISOString() + " · " + PASSES + " pass" + (PASSES > 1 ? "es" : "") + " · " + SAMPLE + " product pages checked per category (seed " + SEED + ")", "");
  L.push("| Shop | Category | Kind | Status | Listings | On the page (in stock) | Shop says | Held out | Failed pages | Spot checks OK | Stable |", "|---|---|---|---|---|---|---|---|---|---|---|");
  for (const r of results) {
    const d = r.passes[0];
    const spotsOk = r.spots.filter((s) => !s.error && !(s.problems || []).length).length;
    L.push(`| ${r.shop} | ${r.category} | ${r.kind} | ${d.status} | ${d.listings} | ${r.evidence.onPage} (${r.evidence.inStockOnPage}) | ${r.evidence.stated ? r.evidence.stated.count : "—"} | ${d.heldOut.length} | ${d.failed.reduce((n, f) => n + f.n, 0)} | ${r.spots.length ? spotsOk + "/" + r.spots.length : "—"} | ${r.stability ? (r.stability.stable ? "yes" : "NO") : "—"} |`);
  }
  if (skipped.length) L.push("", "Not run (enabled, but no category URL set under Shops): " + skipped.join(", "));
  for (const r of results) {
    const d = r.passes[0];
    L.push("", "## " + r.shop + " — " + r.category + " (" + r.kind + ")", "", r.url, "");
    const good = [];
    const bad = [];
    if (d.status !== "complete") bad.push("run " + d.status + (d.error ? ": " + d.error.slice(0, 200) : ""));
    else good.push("run completes in " + d.seconds + " s, " + d.listings + " listings");
    // Every buyable product on the category pages is a listing, held out as another category, or a
    // listing whose product page failed (named below). Anything else was lost on the way.
    const failedCount = d.failed.reduce((n, f) => n + f.n, 0);
    const accounted = d.listings + d.heldOut.length + failedCount;
    const gap = r.evidence.inStockOnPage - accounted;
    if (r.evidence.onPage) (Math.abs(gap) <= Math.max(1, r.evidence.inStockOnPage * 0.05) ? good : bad).push("the category page" + (r.evidence.categoryPages.length === 1 ? "" : "s (" + r.evidence.categoryPages.length + ")") + " show " + r.evidence.onPage + " products, " + r.evidence.inStockOnPage + " buyable; the run: " + d.listings + " listings + " + d.heldOut.length + " held out + " + failedCount + " failed" + (gap ? " — " + Math.abs(gap) + (gap > 0 ? " missing" : " more than the page shows") : ""));
    else bad.push("no category page was read (blocked, or the page did not load)");
    if (r.evidence.stated) L.push("Shop prints: “" + r.evidence.stated.said + "”");
    if (d.heldOut.length) good.push("held out as another category: " + d.heldOut.map((h) => h.name + (h.detected ? " (" + h.detected + ")" : "")).join("; "));
    if (d.offKind.length) bad.push("not a " + r.kind + " but listed as one: " + d.offKind.slice(0, 10).join("; "));
    if (d.held.length) bad.push(d.held.length + " held for a look on the review board: " + d.held.slice(0, 8).join("; "));
    for (const f of d.failed) bad.push(f.n + " listing" + (f.n === 1 ? "" : "s") + " failed: " + f.why + " — e.g. " + f.examples.join(" "));
    if (d.noImage.length) bad.push(d.noImage.length + " without an image: " + d.noImage.slice(0, 6).join("; "));
    if (d.sharedImages.length) bad.push("one picture on several listings (a badge or placeholder?): " + d.sharedImages.slice(0, 3).join("; "));
    if (d.price.low.length) bad.push("suspiciously low printer prices (installment?): " + d.price.low.slice(0, 5).join("; "));
    if (d.badMerges.length) bad.push("merges across an identity axis: " + d.badMerges.slice(0, 5).join("; "));
    if (d.rowDoubts.length) bad.push("published earlier on a row it does not look like (check those rows in Catalog): " + d.rowDoubts.slice(0, 8).join("; "));
    good.push("prices " + money(d.price.min) + " – " + money(d.price.max) + " (median " + money(d.price.median) + "); stock " + JSON.stringify(d.stock) + "; matcher " + JSON.stringify(d.decisions));
    if (d.filament) {
      const fl = d.filament;
      good.push("filament types " + JSON.stringify(fl.types) + "; weights " + JSON.stringify(fl.weights) + " (" + fl.weightAssumed + " assumed 1 kg); diameters " + JSON.stringify(fl.diameters));
      if (fl.noPolymer.length) bad.push("no polymer read: " + fl.noPolymer.slice(0, 8).join("; "));
      if (fl.noColour.length) bad.push(fl.noColour.length + " without a colour: " + fl.noColour.slice(0, 8).join("; "));
    }
    const spotBad = r.spots.filter((s) => s.error || (s.problems || []).length);
    if (r.spots.length) (spotBad.length ? bad : good).push("product pages checked: " + (r.spots.length - spotBad.length) + "/" + r.spots.length + " agree on price, stock, image and type");
    for (const s of spotBad) bad.push("  · " + s.name + " — " + (s.error || s.problems.join("; ")) + " — " + s.url);
    if (r.stability) {
      const st = r.stability;
      if (st.stable) good.push("second pass: same " + d.listings + " listings at the same prices");
      else bad.push("second pass differs: +" + st.added.length + " / −" + st.removed.length + " listings, " + st.priceChanged.length + " price changes" + (st.priceChanged.length ? " (" + st.priceChanged.slice(0, 3).join("; ") + ")" : "") + (st.added.length ? "; new: " + st.added.slice(0, 3).join(" ") : "") + (st.removed.length ? "; gone: " + st.removed.slice(0, 3).join(" ") : ""));
      if (st.stockChanged.length) bad.push("stock changed between passes: " + st.stockChanged.slice(0, 4).join("; "));
    }
    L.push("", ...good.map((g) => "- ✅ " + g), ...bad.map((b) => (b.startsWith("  ·") ? "  - " + b.slice(4) : "- ❌ " + b)));
  }
  L.push("", REPLAY ? "Replayed from " + REPLAY + " (offline). Full data: report.json." : "Pages read: " + path.relative(ROOT, PAGES) + " (run again offline with --replay " + path.relative(ROOT, PAGES) + "). Full data: report.json.");
  return L.join("\n") + "\n";
}

async function main() {
  fs.mkdirSync(PAGES, { recursive: true });
  const started = new Date().toISOString();
  const desk = JSON.parse(fs.readFileSync(path.join(ROOT, "work", "local-store", "desk.json"), "utf8"));
  const skipped = [];
  const runs = [];
  for (const shop of desk.shops || []) {
    if (shop.enabled === false) continue;
    if (ONLY.length && !ONLY.some((q) => [shop.id, shop.name, hostOf(shop.url)].some((v) => String(v || "").toLowerCase().includes(q)))) continue;
    const cats = (shop.categories || []).filter((c) => /^https:\/\//i.test(String(c.url || "")));
    if (!cats.length) { skipped.push(shop.name || shop.id); continue; }
    for (const cat of cats) runs.push({ shop: shop.name || shop.id, category: cat.name || "", url: cat.url, kind: kindForCategory(cat.name) });
  }
  console.log("shop report: " + runs.length + " categories on " + new Set(runs.map((r) => r.shop)).size + " shops, " + PASSES + " pass(es) → " + path.relative(ROOT, OUT));
  if (!runs.length) throw new Error("no enabled shop with a category URL" + (ONLY.length ? " matching --shop " + ONLY.join(",") : ""));

  const stack = await startStack({ out: OUT, copy: ["desk.json", "baseline.json", "catalog.json"], workerEnv: REPLAY ? { SCRAPE_REPLAY_DIR: REPLAY } : { SCRAPE_RECORD_DIR: PAGES } });
  const results = [];
  try {
    for (let pass = 0; pass < PASSES; pass++) {
      for (const run of runs) {
        const label = run.shop + " · " + run.category + (pass ? " (pass 2)" : "");
        process.stdout.write("\n" + label + " … ");
        const res = await runShop(stack.admin, run, { minutes: MINUTES });
        const desc = describeRun(run, res);
        console.log(desc.status + " in " + desc.seconds + " s: " + desc.listings + " listings, " + desc.heldOut.length + " held out, " + desc.failed.reduce((n, f) => n + f.n, 0) + " failed");
        let result = results.find((r) => r.url === run.url);
        if (!result) {
          result = { ...run, passes: [], spots: [], evidence: await pageEvidence(run, res.job, res.cards), runs: [] };
          results.push(result);
          const picks = sample(res.cards.filter(isListing), SAMPLE);
          for (const listing of picks) {
            const s = await spotCheck(run, res.job, listing);
            result.spots.push(s);
            console.log("   spot " + (s.error || (s.problems.length ? "✗ " + s.problems.join("; ") : "✓")) + " — " + s.name);
          }
        }
        result.passes.push(desc);
        result.runs.push({ jobId: res.job.id, cards: res.cards });
        if (result.runs.length === 2) result.stability = compareRuns(result.runs[0], result.runs[1]);
        fs.writeFileSync(path.join(OUT, "report.md"), markdown(results, skipped, started));
      }
    }
  } finally {
    await shutdownBrowser().catch(() => {});
    stack.stop();
  }
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify({ started, seed: SEED, passes: PASSES, skipped, results: results.map(({ runs: r, ...rest }) => ({ ...rest, cards: r.map((x) => x.cards) })) }, null, 1));
  fs.writeFileSync(path.join(OUT, "report.md"), markdown(results, skipped, started));
  console.log("\nDone. Paste this file back: " + path.join(OUT, "report.md"));
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
