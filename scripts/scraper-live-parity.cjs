const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { fetchHtml, shutdownBrowser } = require('../lib/ai-scraper.cjs');
const { extractProductPage, readStockFromHtml } = require('../lib/harvest.js');

const urls = process.argv.slice(2);
if (urls.length !== 3) throw new Error('Pass exactly 3 product URLs');

const record = (html, url) => ({
  extracted: extractProductPage(html, url, /filament/i.test(url) ? 'filament' : 'printer'),
  stock: readStockFromHtml(html)
});

(async () => {
  try {
    for (const url of urls) {
      const a = performance.now();
      const beforeHtml = await fetchHtml(url, null, { scroll: false, blockResources: false });
      const b = performance.now();
      const afterHtml = await fetchHtml(url, null, { scroll: false, blockResources: true });
      const c = performance.now();
      assert.deepEqual(record(afterHtml, url), record(beforeHtml, url), url + ' changed extraction or stock');
      console.log(JSON.stringify({ url, beforeMs: Math.round(b - a), afterMs: Math.round(c - b), identical: true }));
    }
  } finally {
    await shutdownBrowser();
  }
})().catch((err) => { console.error(err); process.exitCode = 1; });
