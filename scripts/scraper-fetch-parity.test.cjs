const assert = require('node:assert/strict');
const http = require('node:http');
const { fetchHtml, shutdownBrowser } = require('../lib/ai-scraper.cjs');
const { extractProductPage, readStockFromHtml } = require('../lib/harvest.js');

const samples = [
  { path: '/bambu-lab-a1-combo', kind: 'printer', name: 'Bambu Lab A1 Combo 3D Yazıcı', price: '23.688,00', image: '/a1.jpg' },
  { path: '/creality-k2-pro-combo', kind: 'printer', name: 'Creality K2 Pro Combo 3D Yazıcı', price: '52.999,00', image: '/k2.jpg' },
  { path: '/esun-pla-plus-black', kind: 'filament', name: 'eSUN PLA+ Black 1.75mm 1000g', price: '899,90', image: '/pla.jpg' }
];

let assets = 0;
const server = http.createServer((req, res) => {
  const sample = samples.find((row) => row.path === req.url);
  if (!sample) {
    assets += 1;
    res.writeHead(200, { 'content-type': req.url.endsWith('.css') ? 'text/css' : 'image/jpeg' });
    res.end(req.url.endsWith('.css') ? 'body{color:#111}' : Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    return;
  }
  const origin = `http://127.0.0.1:${server.address().port}`;
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><html><head>
    <link rel="stylesheet" href="/shop.css">
    <meta property="og:title" content="${sample.name}">
    <meta property="og:image" content="${origin}${sample.image}">
    <script type="application/ld+json">${JSON.stringify({ '@type': 'Product', name: sample.name, image: origin + sample.image, offers: { price: sample.price.replace(/\./g, '').replace(',', '.'), priceCurrency: 'TRY', availability: 'https://schema.org/InStock' } })}</script>
    </head><body><h1>${sample.name}</h1><div class="price">${sample.price} TL</div><button>Sepete Ekle</button><img src="${sample.image}"></body></html>`);
});

(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const sample of samples) {
      const url = origin + sample.path;
      const before = await fetchHtml(url, null, { scroll: false, blockResources: false });
      const after = await fetchHtml(url, null, { scroll: false, blockResources: true });
      assert.deepEqual(extractProductPage(after, url, sample.kind), extractProductPage(before, url, sample.kind), sample.path + ' extraction changed');
      assert.deepEqual(readStockFromHtml(after), readStockFromHtml(before), sample.path + ' stock changed');
    }
    assert.ok(assets >= samples.length, 'the unoptimized path loaded page assets');
    console.log('PASS: 3 product pages produced identical extraction and stock records with resource blocking.');
  } finally {
    await shutdownBrowser();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((err) => { console.error(err); process.exitCode = 1; });
