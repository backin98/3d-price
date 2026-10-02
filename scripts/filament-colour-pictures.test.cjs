// Same photo on every colour (user report, Filament Marketim): colours that each have their own page
// (elas-pla-pro-filament-siyah-5101) carry the product's main photo as og:image on every page, and the
// options read from one page share the page photo. Each colour gets a picture of its own: one named after
// the colour, else the picture only its own page has. Related products and the logo are never it.
const assert = require('node:assert/strict');
const { pagePictures, ownColourPictures } = require('../lib/product-variants.cjs');

const FM = 'https://www.filamentmarketim.com';
const page = (colour, n) => `<!doctype html><html><head><meta property="og:image" content="${FM}/Uploads/UrunResimleri/buyuk/elas-pla-pro-filament-ana.jpg"></head><body>
<header><img src="/Uploads/logo.png" alt="Filament Marketim"></header>
<div class="product-images"><div class="swiper-slide"><a href="/Uploads/UrunResimleri/buyuk/elas-pla-pro-filament-ana.jpg" data-fancybox="g"><img src="/Uploads/UrunResimleri/kucuk/elas-pla-pro-filament-ana.jpg" alt="Elas PLA Pro Filament"></a></div>
<div class="swiper-slide"><a href="/Uploads/UrunResimleri/buyuk/elas-pla-pro-filament-${n}.jpg" data-fancybox="g"><img data-src="/Uploads/UrunResimleri/kucuk/elas-pla-pro-filament-${n}.jpg" alt="Elas PLA Pro Filament ${colour}"></a></div></div>
<h1>Elas PLA Pro Filament ${colour}</h1>
<div class="related-products"><img src="/Uploads/UrunResimleri/kucuk/porima-pla.jpg"><img src="/Uploads/UrunResimleri/kucuk/sunlu-pla.jpg"></div>
<footer><img src="/Uploads/odeme-iyzico.png"></footer></body></html>`;

const pics = pagePictures(page('Siyah', '7a1f'), FM + '/elas-pla-pro-filament-siyah-5101');
assert.ok(pics.includes(FM + '/Uploads/UrunResimleri/buyuk/elas-pla-pro-filament-7a1f.jpg'), 'the zoom link');
assert.ok(pics.includes(FM + '/Uploads/UrunResimleri/kucuk/elas-pla-pro-filament-7a1f.jpg'), 'the lazy picture');
assert.ok(!pics.some((u) => /logo|odeme/.test(u)), 'no logo or payment badge');

// Numbered photos (no colour word): the picture only this colour's page has.
const shared = FM + '/Uploads/UrunResimleri/buyuk/elas-pla-pro-filament-ana.jpg';
const colourPages = [['Siyah', '7a1f', 5101], ['Beyaz', '9c3e', 5102], ['Lacivert', '2b8d', 5103]].map(([c, n, id]) => ({
  listing: { url: FM + '/elas-pla-pro-filament-' + c.toLowerCase() + '-' + id, image: shared, colorName: c }, html: page(c, n), words: [c.toLowerCase()]
}));
assert.equal(ownColourPictures(colourPages), 3);
assert.deepEqual(colourPages.map((p) => p.listing.image.replace(FM, '')), ['/Uploads/UrunResimleri/buyuk/elas-pla-pro-filament-7a1f.jpg', '/Uploads/UrunResimleri/buyuk/elas-pla-pro-filament-9c3e.jpg', '/Uploads/UrunResimleri/buyuk/elas-pla-pro-filament-2b8d.jpg'],
  'each colour its own page\'s photo, not the shared main photo or a related product');

// Options read from one page (one HTML for all): the photos named after the colours.
const one = `<div class="thumbs"><img src="/img/porima-pla-main.jpg"><img src="/img/porima-pla-siyah.jpg"><img src="/img/porima-pla-beyaz.jpg"><img src="/img/porima-pla-kirmizi.jpg"></div>`;
const options = ['Siyah', 'Beyaz', 'Kırmızı'].map((c) => ({ listing: { url: FM + '/porima-pla?variant=' + c, image: FM + '/img/porima-pla-main.jpg' }, html: one, words: [c] }));
ownColourPictures(options);
assert.deepEqual(options.map((p) => p.listing.image.replace(FM, '')), ['/img/porima-pla-siyah.jpg', '/img/porima-pla-beyaz.jpg', '/img/porima-pla-kirmizi.jpg']);

// Colours that already have photos of their own are left alone.
const fine = [{ listing: { url: FM + '/a', image: FM + '/img/a.jpg' }, html: one, words: ['siyah'] }, { listing: { url: FM + '/b', image: FM + '/img/b.jpg' }, html: one, words: ['beyaz'] }];
assert.equal(ownColourPictures(fine), 0);

console.log('PASS: colours that show one shared photo each get a picture of their own (named after the colour, or only on their own page).');
