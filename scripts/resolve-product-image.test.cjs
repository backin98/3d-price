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

console.log('PASS: resolveProductImage lazy attrs, srcset, og, json-ld, junk gate.');
