#!/usr/bin/env node
"use strict";

// What a shop run would read as the colours of one product page, without running the shop:
//
//   npm run probe-colours -- https://www.filamentmarketim.com/elas-pla-pro-filament
//
// Prints the colours found in the page itself, then by clicking the options in Chromium, and saves the
// page (as fetched, and as the browser drew it) to work/variant-debug/ so it can be sent back for a look.

const fs = require("node:fs");
const path = require("node:path");
const { fetchHtml, shutdownBrowser } = require("../lib/ai-scraper.cjs");
const { variantsFromPage } = require("../lib/product-variants.cjs");
const { clickThroughOptions } = require("../lib/variant-clicker.cjs");
const { extractProductPage } = require("../lib/harvest.js");

const url = process.argv[2];
if (!/^https:\/\//.test(String(url || ""))) {
  console.error("usage: npm run probe-colours -- https://shop.example/product-page");
  process.exit(2);
}

(async () => {
  const dir = path.join(__dirname, "..", "work", "variant-debug");
  fs.mkdirSync(dir, { recursive: true });
  const stem = new URL(url).hostname.replace(/^www\./, "") + "-" + new URL(url).pathname.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 80);

  console.log("Product page: " + url);
  const html = await fetchHtml(url, null, { scroll: false, blockResources: true, discoverStock: false });
  fs.writeFileSync(path.join(dir, stem + ".fetched.html"), html);
  const page = extractProductPage(html, url, "filament");
  const x = page.product || page.incomplete || {};
  console.log("Title: " + (x.name || "?") + " · price " + (x.price || "?") + " · " + (page.reason || "complete"));

  const inPage = variantsFromPage(html, url, { pagePrice: Number(x.price) || 0 });
  console.log("\n1. Options in the page HTML" + (inPage.source ? " (" + inPage.source + ")" : "") + ": " + inPage.variants.length);
  for (const v of inPage.variants) console.log("   " + v.label + " · " + v.price + " · " + (v.stock || "?") + " · " + v.url);
  if (inPage.links.length) {
    console.log("   colour pages linked: " + inPage.links.length);
    for (const l of inPage.links) console.log("   " + (l.label || "(no name)") + " · " + l.url);
  }

  const clicked = await clickThroughOptions(url, { keepHtml: true, timeoutMs: 180000 });
  console.log("\n2. By clicking the options: " + clicked.variants.length + (clicked.note ? " (" + clicked.note + ")" : ""));
  if (clicked.groups.length) console.log("   option blocks seen: " + clicked.groups.map((g) => g.kind + " '" + g.name + "' ×" + g.size).join(", "));
  for (const v of clicked.variants) console.log("   " + v.label + " · " + (v.price || v.priceText || "?") + " · " + (v.stock || "?") + (v.url ? " · " + v.url : ""));
  if (clicked.html) {
    fs.writeFileSync(path.join(dir, stem + ".rendered.html"), clicked.html);
    const drawn = variantsFromPage(clicked.html, url, { pagePrice: Number(x.price) || 0 });
    if (drawn.variants.length || drawn.links.length) console.log("   in the page as drawn: " + drawn.variants.length + " options, " + drawn.links.length + " colour pages");
  }

  const total = inPage.variants.length + inPage.links.length + clicked.variants.length;
  console.log("\n" + (total ? "A shop run would split this product into its colours." : "No colours found. Send back the files in " + path.relative(process.cwd(), dir) + " named " + stem + ".*"));
  await shutdownBrowser();
})().catch(async (err) => { console.error(err); await shutdownBrowser().catch(() => {}); process.exitCode = 1; });
