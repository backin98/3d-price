const assert = require("node:assert/strict");
const { harvestCategory, isLikelyProductUrl, slugToTitle, readStockFromHtml, extractProductPage, isJunkAmount } = require("../lib/harvest.js");
const { discoverInStockFilter } = require("../lib/harvest-guards.cjs");

const RHINO = [
  "https://www.rhino3dprinter.com/muhendislik-filamentleri",
  "https://www.rhino3dprinter.com/filament-kurutuculari",
  "https://www.rhino3dprinter.com/elektronik-baglanti-elemanlari-862",
  "https://www.rhino3dprinter.com/3d-yazici-elektronik",
  "https://www.rhino3dprinter.com/elektronik-baglanti-elemanlari-4809",
  "https://www.rhino3dprinter.com/guc-kaynaklari-1300",
  "https://www.rhino3dprinter.com/3d-yazici-garantisi-hakkinda",
  "https://www.rhino3dprinter.com/photon-p1-combo-msla-3d-yazici",
  "https://www.rhino3dprinter.com/qidi-tech-plus5-combo-3d-yazici",
  "https://www.rhino3dprinter.com/bambu-lab-h2d-3d-printer",
  "https://www.rhino3dprinter.com/anycubic-kobra-3-v2-combo-3d-yazici",
  "https://www.rhino3dprinter.com/anycubic-kobra-x-3d-yazici",
  "https://www.rhino3dprinter.com/snapmaker-2.0-a350ent-3in1-3d-printer",
  "https://www.rhino3dprinter.com/anycubic-mono-4-sla-3d-yazici",
  "https://www.rhino3dprinter.com/aktip-tekno-at1000-3d-yazici",
  "https://www.rhino3dprinter.com/creality-k2-3d-yazici",
  "https://www.rhino3dprinter.com/anycubic-photon-mono-4-ultra-msla-3d-yazici",
  "https://www.rhino3dprinter.com/bambu-lab-a1-mini-combo-3d-printer",
  "https://www.rhino3dprinter.com/qiditech-max-4-combo-3d-yazici",
  "https://www.rhino3dprinter.com/bambu-lab-h2d-laser-full-10w-3d-yazici",
  "https://www.rhino3dprinter.com/flashforge-creator-5-3d-yazici",
  "https://www.rhino3dprinter.com/qidi-q2-combo-3d-yazici"
];

const REJECT = new Set(RHINO.slice(0, 7));
const KEEP = new Set(RHINO.slice(7));

(async () => {
  for (const url of REJECT) assert.equal(isLikelyProductUrl(url, "printers"), false, url);
  for (const url of KEEP) assert.equal(isLikelyProductUrl(url, "printers"), true, url);
  assert.equal(isLikelyProductUrl("https://store.metatechtr.com/iemai-magic-ht-max-3d-printer-2-2", "printer"), true);
  assert.equal(isLikelyProductUrl("https://store.metatechtr.com/fast-jet-1500-pellet-extruder-iemai-3d-printe-r", "printer"), true);
  assert.equal(isLikelyProductUrl("https://store.metatechtr.com/3d-yazicilar", "printer"), false);
  assert.equal(isLikelyProductUrl("https://store.metatechtr.com/centauri-carbon", "printer"), true);
  assert.equal(isLikelyProductUrl("https://store.metatechtr.com/centauri-carbon", "printer", "Elegoo Centauri Carbon 3D Yazıcı"), true);
  assert.equal(isLikelyProductUrl("https://store.metatechtr.com/polymaker-filament-turkiye", "filament"), false);
  assert.equal(isLikelyProductUrl("https://www.3dultra.com.tr/{{url}}/{{productUrl}}", "printer"), false);
  assert.equal(isLikelyProductUrl("https://www.robotizmo.net/anasayfa", "printer"), false);
  assert.equal(isLikelyProductUrl("https://store.metatechtr.com/3d-yazicilar?ps=14", "printer"), false);
  assert.equal(readStockFromHtml("<div>Stoktan Teslim</div><button>Sepete Ekle</button>").status, "in_stock");
  assert.equal(readStockFromHtml("<div>Tükendi</div>").status, "out_of_stock");
  assert.equal(isJunkAmount(1, "placeholder"), true);
  assert.equal(isJunkAmount(2500, "2.500 TL ÜZERİ ALIŞVERİŞTE KARGO ÜCRETSİZ"), true);
  assert.equal(isJunkAmount(37051, "Photon P1 Combo"), false);
  const filter = discoverInStockFilter('<a href="/3d-yazicilar?foo=1">Sadece Stoktakiler</a>', 'https://store.metatechtr.com/3d-yazicilar');
  assert.equal(filter && filter.type, 'link');
  assert.match(filter.href, /foo=1/);
  assert.equal(discoverInStockFilter('<div>no filter</div>', 'https://shop.example/list'), null);

  const title = slugToTitle("https://www.rhino3dprinter.com/photon-p1-combo-msla-3d-yazici");
  assert.match(title, /Photon/i);
  assert.match(title, /3D Yazıcı/);
  assert.doesNotMatch(title, /Dropshipping/i);

  const result = await harvestCategory({
    categoryUrl: "https://www.rhino3dprinter.com/3d-yazicilar",
    kind: "printers",
    urls: RHINO
  });
  assert.equal(result.inScope.length, 15);
  assert.equal(result.mismatches.length + result.rejected.length, 7);
  assert.equal(result.inScope.filter((p) => /dropshipping/i.test(p.name)).length, 0);
  assert.deepEqual(new Set(result.inScope.map((p) => p.url)), KEEP);
  assert.ok(result.inScope.every((p) => p.kind === "printer"));

  const html = `
    <div class="card-product">
      <div class="product-label top-left"><img alt="Dropshipping" title="Dropshipping" src="https://cdn.example.com/drop.webp"></div>
      <a href="https://www.rhino3dprinter.com/photon-p1-combo-msla-3d-yazici">
        <img data-src="https://cdn.example.com/photon.jpg" alt="">
      </a>
      <a href="https://www.rhino3dprinter.com/photon-p1-combo-msla-3d-yazici" class="c-p-i-link" title="Photon P1 Combo MSLA 3D Yazıcı">
        <div class="title">Photon P1 Combo MSLA 3D Yazıcı</div>
        <div class="brand">Anycubic</div>
        <div class="sale-price">37.051,30 TL</div>
      </a>
    </div>
    <div class="card-product">
      <a href="https://www.rhino3dprinter.com/muhendislik-filamentleri" class="c-p-i-link" title="Mühendislik Filamentleri">
        <div class="title">Mühendislik Filamentleri</div>
      </a>
    </div>
    <div class="card-product">
      <a href="https://www.rhino3dprinter.com/qidi-box-renk-modulu" class="c-p-i-link" title="Qidi Box Renk Modülü">
        <div class="title">Qidi Box Renk Modülü</div>
        <div class="sale-price">15.548,99 TL</div>
      </a>
    </div>`;
  const cards = await harvestCategory({
    categoryUrl: "https://www.rhino3dprinter.com/3d-yazicilar",
    kind: "printers",
    html
  });
  assert.equal(cards.inScope.length, 1);
  assert.equal(cards.inScope[0].name, "Photon P1 Combo MSLA 3D Yazıcı");
  assert.equal(cards.inScope[0].stock, "dropshipping");
  assert.equal(cards.inScope[0].price, 37051.3);
  assert.doesNotMatch(cards.inScope[0].name, /Dropshipping/i);
  assert.equal(cards.rejected.length, 1);
  assert.equal(cards.mismatches.length, 1);
  assert.equal(cards.mismatches[0].detectedType, "accessory");
  assert.equal(cards.mismatches[0].declaredType, "printer");

  const shopify = await harvestCategory({
    categoryUrl: "https://www.3dteknomarket.com/collections/fdm-yazicilar",
    kind: "printers",
    html: `<div class="card product-card"><a href="/collections/vendors?q=Bambu%20Lab" title="Bambu Lab">Bambu Lab</a><a href="/products/bambu-lab-a1-combo-3d-yazici"><div class="product-card__title">Bambu Lab A1 Combo 3D Yazıcı</div><div class="sale-price">$599</div></a></div>`
  });
  assert.equal(shopify.inScope.length, 1);

  const idea = await harvestCategory({
    categoryUrl: "https://www.robotzade.com/kategori/3d-yazici",
    kind: "printers",
    html: `<div class="showcase"><a href="/urun/bambu-lab-a1-3d-yazici" title="Bambu Lab A1 3D Yazıcı"><div class="showcase-title">Bambu Lab A1 3D Yazıcı</div></a><div class="showcase-price-new">14.700,00 TL + KDV</div><a class="add-to-cart-button">Sepete Ekle</a></div>`
  });
  assert.equal(idea.inScope.length, 1);
  assert.match(idea.inScope[0].url, /\/urun\/bambu-lab-a1-3d-yazici/);
  assert.equal(idea.inScope[0].price, 14700);
  assert.match(shopify.inScope[0].url, /\/products\/bambu-lab-a1-combo-3d-yazici/);
  assert.doesNotMatch(shopify.inScope[0].url, /vendors/);

  const preorderCard = await harvestCategory({
    categoryUrl: "https://shop.example/printers",
    kind: "printers",
    html: `<div class="card product-card"><a href="/products/creality-k2"><h3>Creality K2 3D Printer</h3></a><div class="stock-badge">Tükendi</div><span>Ön Sipariş Ürünü</span><div class="sale-price">25.000,00 TL</div><button>Sepete Ekle</button></div>`
  });
  assert.equal(preorderCard.inScope.length, 1, "a preorder with Add to Cart is not rejected as sold out");
  assert.equal(preorderCard.inScope[0].stock, "preorder");

  assert.equal(readStockFromHtml('<div class="out-of-stock">Tükendi</div>').status, "out_of_stock");
  assert.equal(readStockFromHtml("<div>Stokta Yok</div><button>Sepete Ekle</button>").status, "out_of_stock");
  const qty = readStockFromHtml("<div>Stok Miktarı: 4</div><button>Sepete Ekle</button>");
  assert.equal(qty.status, "in_stock");
  assert.equal(qty.quantity, 4);
  assert.equal(readStockFromHtml('<button onclick="addToCart(12)">Sepete Ekle</button>').status, "in_stock");
  assert.equal(readStockFromHtml("<div>hello</div>", { filterVerified: true }).status, "in_stock");
  assert.equal(readStockFromHtml("<div>Tükendi</div>", { filterVerified: true }).status, "out_of_stock");
  assert.equal(readStockFromHtml("<div>no signals</div>", { badge: "Dropshipping" }).status, "dropshipping");

  const page = extractProductPage(`
    <title>Bambu Lab A1 Combo 3D Yazıcı | Rhino 3D Printer</title>
    <meta property="og:title" content="Bambu Lab A1 Combo 3D Yazıcı">
    <meta property="og:image" content="https://cdn.example.com/a1.jpg">
    <h1 class="product-title">Bambu Lab A1 Combo 3D Yazıcı</h1>
    <div class="brand">Bambu Lab</div>
    <div class="sale-price">19.999,00 TL</div>
    <div class="list-price">22.000,00 TL</div>
    <button>Sepete Ekle</button>`, "https://www.rhino3dprinter.com/bambu-lab-a1-combo-3d-yazici", "printer");
  assert.equal(page.product.name, "Bambu Lab A1 Combo 3D Yazıcı");
  assert.equal(page.product.brand, "Bambu Lab");
  assert.equal(page.product.price, 19999);
  assert.equal(page.product.image, "https://cdn.example.com/a1.jpg");
  assert.equal(page.product.kind, "printer");

  const rich = extractProductPage(`
    <script type="application/ld+json">{"@graph":[{"@type":"WebSite","name":"Example Shop"},{"@type":"Product","name":"Anycubic Kobra 3 Combo","brand":{"name":"Anycubic"},"offers":{"price":"25000"}}]}</script>
    <meta property="og:title" content="Anycubic">
    <h1>Breadcrumb Brand Text</h1>
    <div class="sale-price">25.000,00 TL</div>`, "https://shop.example/products/anycubic-kobra-3-combo", "printer");
  assert.equal(rich.product.name, "Anycubic Kobra 3 Combo", "JSON-LD Product.name wins over weaker page text");

  const social = extractProductPage(`
    <meta property="og:title" content="Example Shop">
    <meta name="twitter:title" content="Creality K2 Plus Combo">
    <h1>Creality</h1><div class="sale-price">30.000,00 TL</div>`, "https://example.shop/creality-k2-plus-combo", "printer");
  assert.equal(social.product.name, "Creality K2 Plus Combo", "a product-like social title wins over the H1");

  const brandOnly = extractProductPage(`
    <script type="application/ld+json">{"@type":"Product","name":"Elegoo","brand":{"name":"Elegoo"},"offers":{"price":"20000"}}</script>
    <div class="sale-price">20.000,00 TL</div>`, "https://shop.example/elegoo-neptune-4-pro", "printer");
  assert.match(brandOnly.product.name, /Neptune 4 Pro/, "brand-only structured title falls back to the product slug");

  const plusVat = extractProductPage(`
    <h1>Creality K1 Max 3D Yazıcı</h1>
    <div class="brand">Creality</div>
    <img src="https://cdn.example.com/k1.jpg">
    <div class="sale-price">10.000,00 TL</div><span>+ KDV</span>`, "https://www.rhino3dprinter.com/creality-k1-max-3d-yazici", "printer");
  assert.equal(plusVat.product.plusVat, true);
  assert.equal(plusVat.product.price, 10000);

  const incomplete = extractProductPage("<h1>Mystery</h1>", "https://www.rhino3dprinter.com/creality-k2-3d-yazici", "printer");
  assert.ok(incomplete.incomplete);
  assert.match(incomplete.reason, /incomplete/i);

  console.log("PASS: 15 in-scope Rhino printers, 7 rejected listings, no Dropshipping names, card parse routes badge to stock.");
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
