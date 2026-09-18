#!/usr/bin/env node
// Local Gemma scraper. Long jobs stay on this PC — Netlify only stores the result.
//
//   node scripts/scraper.cjs https://shop.example/product
//   node scripts/scraper.cjs --compare a.json b.json
//
// Needs the local worker/LLM at http://127.0.0.1:1235 (google/gemma-4-e4b).
// Optional JS rendering: npm i playwright && npx playwright install chromium

const fs = require('node:fs');
const path = require('node:path');
const { scrapeProduct } = require('../lib/ai-scraper.cjs');
const { compare_products, rankByPrice, loadRates, toTry } = require('../lib/compare-products.cjs');
const { record } = require('../lib/price-history.cjs');
const { setEndpoint } = require('./local-qwen.cjs');

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--compare') {
    const a = JSON.parse(fs.readFileSync(args[1], 'utf8'));
    const b = JSON.parse(fs.readFileSync(args[2], 'utf8'));
    console.log(JSON.stringify(compare_products(a, b), null, 2));
    return;
  }
  const url = args.find((a) => /^https:\/\//i.test(a));
  if (!url) {
    console.error('Usage: node scripts/scraper.cjs https://example.com/product');
    process.exit(1);
  }
  setEndpoint(process.env.LOCAL_AI_URL || 'http://127.0.0.1:1235');
  const listing = await scrapeProduct(url, {
    kind: /filament/i.test(url) ? 'filament' : 'printer',
    dir: path.join(__dirname, '..', 'data', 'qwen-url-jobs', 'scrape-cli')
  });
  const rates = await loadRates();
  listing.price_try = toTry(listing.price, listing.currency, rates);
  record(listing);
  const ranked = rankByPrice([listing], rates);
  console.log(JSON.stringify(ranked[0] || listing, null, 2));
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
