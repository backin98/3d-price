const assert = require('node:assert/strict');
const { resolveProductImage, isJunkImage, scrubClonedImages } = require('../lib/resolve-product-image.cjs');

assert.equal(isJunkImage('https://cdn.example.com/loader.gif'), true);
assert.equal(isJunkImage('https://cdn.example.com/placeholder.png'), true);
assert.equal(isJunkImage('https://cdn.example.com/a1.jpg'), false);
assert.equal(isJunkImage('https://cdn.qukasoft.com/p/bambu-h2s-sw800sh800.webp'), false);
assert.equal(resolveProductImage({
  pageUrl: 'https://shop.example/p',
  cardHtml: '<img data-src="https://cdn.example.com/a.webp?revision=1&amp;width=800">'
}), 'https://cdn.example.com/a.webp?revision=1&width=800');

const lazy = resolveProductImage({
  pageUrl: 'https://www.robolinkmarket.com/filament',
  cardHtml: '<img src="https://cdn.example.com/loader.gif" data-src="/media/a1-combo.jpg">'
});
assert.equal(lazy, 'https://www.robolinkmarket.com/media/a1-combo.jpg');

const srcset = resolveProductImage({
  pageUrl: 'https://shop.example/p',
  cardHtml: '<img srcset="https://cdn.example.com/a-320.jpg 320w, https://cdn.example.com/a-800.jpg 800w">'
});
assert.equal(srcset, 'https://cdn.example.com/a-800.jpg');

assert.equal(resolveProductImage({
  pageUrl: 'https://shop.example/collection',
  cardHtml: '<img src="https://cdn.example.com/loader.gif">',
  productPageHtml: ''
}), '');
const og = resolveProductImage({
  pageUrl: 'https://shop.example/p',
  productUrl: 'https://shop.example/p',
  productPageHtml: '<meta property="og:image" content="//cdn.example.com/og.jpg">'
});
assert.equal(og, 'https://cdn.example.com/og.jpg');
const ld = resolveProductImage({
  productUrl: 'https://shop.example/p',
  productPageHtml: '<script type="application/ld+json">{"@type":"Product","image":"https://cdn.example.com/ld.jpg"}</script>'
});
assert.equal(ld, 'https://cdn.example.com/ld.jpg');
const clone = [
  { url: 'https://a/1', image: 'https://cdn.example.com/same.jpg' },
  { url: 'https://a/2', image: 'https://cdn.example.com/same.jpg' },
  { url: 'https://a/3', image: 'https://cdn.example.com/same.jpg' },
  { url: 'https://a/4', image: 'https://cdn.example.com/other.jpg' }
];
scrubClonedImages(clone);
assert.equal(clone[0].image, '');
assert.equal(clone[3].image, 'https://cdn.example.com/other.jpg');

assert.equal(resolveProductImage({ cardHtml: '<img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7">' }), '');
assert.equal(resolveProductImage({
  pageUrl: 'https://shop.example/list',
  cardHtml: '<div class="product-label top-left"><img src="/dropshipping.webp"></div><a><img data-src="/actual-printer.webp"></a>'
}), 'https://shop.example/actual-printer.webp', 'a corner overlay cannot replace the product image');
assert.equal(resolveProductImage({
  pageUrl: 'https://shop.example/list',
  cardHtml: '<a><img data-src="/only-product.webp"></a>'
}), 'https://shop.example/only-product.webp', 'ordinary single-image cards are unchanged');

// Rhino's real card markup nests the badge: <div class="card-product"><div class="card-product-inner">
// <div class="image-wrapper"><div class="product-label top-left"><img badge></div><div class="image">…
// A lazy <div>…</div> match stopped at the badge's closing tag and kept it, so every "STOKTAN TESLİM" or
// "Dropshipping" card showed the badge, and the clone scrub then blanked them all.
assert.equal(resolveProductImage({
  pageUrl: 'https://www.rhino3dprinter.com/3d-yazicilar',
  cardHtml: '<div class="card-product"><div class="card-product-inner"><div class="image-wrapper"><div class="product-label top-left"><img src="https://cdn.qukasoft.com/c/drop-6a3902cfe42b4.webp" alt="Dropshipping"></div><div class="image"><div class="carousel"><div class="carousel-item active"><a href="/photon-p1-combo-msla-3d-yazici"><img class="img-auto lazy-load" data-src="https://cdn.qukasoft.com/p/photon-p1-combo-msla-3d-yazici-36531422.webp" src="data:image/gif;base64,R0lGODlhAQABAJEAAAAAAP"></a></div></div></div></div></div></div>'
}), 'https://cdn.qukasoft.com/p/photon-p1-combo-msla-3d-yazici-36531422.webp', 'a nested badge cannot replace the product image');
assert.equal(resolveProductImage({
  pageUrl: 'https://shop.example/list',
  cardHtml: '<div class="card"><div class="badge-wrap"><img src="/only-photo.webp"></div></div>'
}), 'https://shop.example/only-photo.webp', 'a card whose only picture sits in a label container keeps it');

// Every listing on the saved shop pages gets its own product photo: none blank, none shared.
(async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { harvestCategory } = require('../lib/harvest.js');
  const pages = [
    ['rhino-3d-yazicilar.html', 'https://www.rhino3dprinter.com/3d-yazicilar', 'printer'],
    ['rhino-filament-cesitleri.html', 'https://www.rhino3dprinter.com/filament-cesitleri', 'filament'],
    ['teknomarket-fdm-yazicilar.html', 'https://www.3dteknomarket.com/collections/fdm-yazicilar', 'printer']
  ];
  for (const [file, categoryUrl, kind] of pages) {
    const html = fs.readFileSync(path.join(__dirname, 'fixtures', 'pages', file), 'utf8');
    const got = await harvestCategory({ categoryUrl, kind, html, inStockOnly: false });
    const all = [...got.inScope, ...got.mismatches];
    assert.deepEqual(all.filter((p) => !p.image).map((p) => p.name), [], file + ': every listing has an image');
    const seen = new Map();
    for (const p of all) seen.set(p.image, (seen.get(p.image) || 0) + 1);
    assert.deepEqual([...seen].filter(([, n]) => n > 1).map(([img]) => img), [], file + ': no two listings share a picture (a badge is not a photo)');
  }
  console.log('PASS: resolveProductImage lazy attrs, srcset, og, json-ld, junk gate; nested badges never win; every saved-page listing has its own photo.');
})().catch((err) => { console.error(err); process.exitCode = 1; });
