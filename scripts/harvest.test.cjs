const assert = require("node:assert/strict");
const { harvestCategory, isLikelyProductUrl, slugToTitle, readStockFromHtml, extractProductPage, transactionPrice, vatIncludedPrice, preferredPriceSource, isJunkAmount } = require("../lib/harvest.js");
const { discoverInStockFilter } = require("../lib/harvest-guards.cjs");
const { listingFromHarvest, shouldAddVat } = require("../lib/qwen-website-job.cjs");

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
  assert.equal(readStockFromHtml("<div>Ön Sipariş</div><button>Sepete Ekle</button>").status, "preorder");
  assert.equal(readStockFromHtml("<div>Ön Sipariş 10.000,00 TL</div>").status, "out_of_stock", "preorder text without a buy control is unavailable");
  assert.equal(readStockFromHtml("<div>10.000,00 TL</div><button disabled>Sepete Ekle</button>").status, "out_of_stock", "a disabled cart control is not buyable");
  const preorderCard = await harvestCategory({
    categoryUrl: "https://store.metatechtr.com/3d-yazicilar",
    kind: "printers",
    inStockOnly: true,
    html: `<div class="mb-2 product-item"><a href="/foo-on-siparis-yazici" class="product-title">Foo Ön Sipariş 3D Yazıcı</a><div class="sale-price">10.000,00 TL</div><span class="badge">Ön Sipariş</span><button>Sepete Ekle</button></div>`
  });
  assert.equal(preorderCard.inScope.length, 1);
  assert.equal(preorderCard.inScope[0].stock, "preorder");
  const savedVatListing = listingFromHarvest(preorderCard.inScope[0].url, preorderCard.inScope[0], { kind: "printer", vat: "excluded" }, new Set([preorderCard.inScope[0].url]));
  assert.equal(savedVatListing.price, 12000, "a saved VAT-excluded shop policy survives into the next run");
  assert.equal(savedVatListing.vatAdded, true);
  const pageIncluded = listingFromHarvest(preorderCard.inScope[0].url, { ...preorderCard.inScope[0], vatStatus: "included" }, { kind: "printer", vat: "excluded" }, new Set([preorderCard.inScope[0].url]));
  assert.equal(pageIncluded.price, 10000, "explicit KDV-included card text overrides the shop default");
  const deadCard = await harvestCategory({
    categoryUrl: "https://store.metatechtr.com/3d-yazicilar",
    kind: "printers",
    inStockOnly: true,
    html: `<div class="mb-2 product-item"><a href="/dead-yazici" class="product-title">Dead 3D Yazıcı</a><div class="sale-price">10.000,00 TL</div><span class="badge">Tükendi</span></div>`
  });
  assert.equal(deadCard.inScope.length, 0);
  assert.ok(deadCard.rejected.some((r) => r.reason === "out_of_stock"));
  const noCartGrid = await harvestCategory({
    categoryUrl: "https://unknown.example/printers",
    kind: "printer",
    inStockOnly: true,
    html: `<div class="product-item"><a class="brand-title">Maker</a><a class="product-title" href="/maker-model-10-3d-printer">Maker Model 10 3D Printer</a><div class="price">10.000,00 TL</div></div>
      <div class="product-item"><a class="brand-title">Other</a><a class="product-title" href="/other-model-20-3d-printer">Other Model 20 3D Printer</a><div class="price">20.000,00 TL</div></div>
      <div class="product-item"><a class="product-title" href="/maker-model-30-3d-printer">Maker Model 30 3D Printer</a><div class="price">30.000,00 TL</div><span>Tükendi</span></div>`
  });
  assert.equal(noCartGrid.inScope.length, 2, "a grid layout with no cart controls defers its products to their detail pages");
  assert.equal(noCartGrid.inScope[0].name, "Maker Model 10 3D Printer", "the product title wins over an earlier brand link");
  assert.ok(noCartGrid.inScope.every((p) => p.stock === "unknown"));
  assert.equal(listingFromHarvest(noCartGrid.inScope[0].url, noCartGrid.inScope[0], { kind: "printer" }, new Set()), null, "deferred cards cannot bypass product-page stock verification");
  const mixedGrid = await harvestCategory({
    categoryUrl: "https://unknown.example/printers",
    kind: "printer",
    inStockOnly: true,
    html: `<div class="product-item"><a class="product-title" href="/maker-live-3d-printer">Maker Live 3D Printer</a><div class="price">10.000,00 TL</div><button>Add to cart</button></div>
      <div class="product-item"><a class="product-title" href="/maker-dead-3d-printer">Maker Dead 3D Printer</a><div class="price">20.000,00 TL</div></div>`
  });
  assert.equal(mixedGrid.inScope.length, 1, "when a grid supports cart controls, a card without one is out of stock");
  assert.ok(mixedGrid.rejected.some((r) => r.url.endsWith("maker-dead-3d-printer") && r.reason === "out_of_stock"));
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

  const shopify = await harvestCategory({
    categoryUrl: "https://www.3dteknomarket.com/collections/fdm-yazicilar",
    kind: "printers",
    html: `<div class="card product-card"><a href="/collections/vendors?q=Bambu%20Lab" title="Bambu Lab">Bambu Lab</a><a href="/products/bambu-lab-a1-combo-3d-yazici"><div class="product-card__title">Bambu Lab A1 Combo 3D Yazıcı</div><div class="sale-price">$599</div></a><button>Add to cart</button></div>`
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

  const cartPricePage = `<script>window.product={"satisFiyatiStr":"₺77.000,00","indirimliFiyatiStr":"₺72.000,00","urunSepetFiyatiStr":"₺72.000,00"}</script>
    <script type="application/ld+json">{"@type":"Product","name":"Bambu Lab H2S 3D Yazıcı","brand":{"name":"Bambu Lab"},"offers":{"price":"72000","priceCurrency":"TRY"}}</script>
    <h1>Bambu Lab H2S 3D Yazıcı</h1><div><span id="fiyat">₺77.000,00</span><span id="indirimliFiyat">₺72.000,00</span></div><button>Sepete Ekle</button>`;
  assert.equal(transactionPrice(cartPricePage).price, 72000, "the formatted product cart price is transaction evidence");
  const cartPriced = extractProductPage(cartPricePage, "https://shop.example/bambu-lab-h2s-3d-yazici", "printer");
  assert.equal(cartPriced.product.price, 72000, "cart price wins over the crossed-out/list price");
  assert.equal(cartPriced.product.priceSource, "cart-price");

  const netAndGross = `<h1>Example Model 3D Printer</h1><span class="product-price-not-vat">20.921,52</span> TL + KDV
    <p>KDV Dahil: <span class="product-price">25.105,83</span> TL</p>
    <script type="application/ld+json">{"@type":"Product","name":"Example Model 3D Printer","offers":{"price":"20921.52","priceCurrency":"TRY"}}</script><button>Sepete Ekle</button>`;
  assert.equal(vatIncludedPrice(netAndGross).price, 25105.83, "the exact labeled KDV-included total is recognized");
  const grossPriced = extractProductPage(netAndGross, "https://shop.example/example-model", "printer");
  assert.equal(grossPriced.product.price, 25105.83, "the displayed KDV-included total wins over the net JSON-LD price");
  assert.equal(grossPriced.product.priceSource, "vat-included-price");

  const robotizmoGross = `<script>var settings={"urunKdvDahilGoster":true,"urunSepetFiyatiStr":"₺43.124,26"}</script>
    <h1>Snapmaker U1 3D Yazıcı</h1><div>Fiyat: $883.33 + KDV</div>
    <div><span>KDV Dahil</span>: <span>₺51.749,11</span></div><button>Sepete Ekle</button>`;
  assert.equal(vatIncludedPrice(robotizmoGross).price, 51749.11, "script settings cannot hide the visible KDV-included total");
  assert.equal(extractProductPage(robotizmoGross, "https://shop.example/snapmaker-u1-3d-yazici", "printer").product.price, 51749.11);

  const priceBeforeVatLabel = `<h1>Creality K2 Pro Combo 3D Yazıcı</h1>
    <div>Fiyat: ₺52.999,00 (KDV Dahil)</div><div>₺5.888,78 'den başlayan taksitlerle</div>
    <script type="application/ld+json">{"@type":"Product","name":"Creality K2 Pro Combo 3D Yazıcı","offers":{"price":"52999","priceCurrency":"TRY"}}</script><button>Sepete Ekle</button>`;
  assert.equal(vatIncludedPrice(priceBeforeVatLabel).price, 52999, "a price immediately before the VAT label wins over a later installment");
  assert.equal(extractProductPage(priceBeforeVatLabel, "https://shop.example/creality-k2-pro-combo", "printer").product.price, 52999);

  const competingPrices = `<h1>Example Printer</h1><div>KDV Dahil: 55.000,00 TL</div>
    <script>window.product={"urunSepetFiyatiStr":"₺50.500,00"}</script>
    <script type="application/ld+json">{"@type":"Product","name":"Example Printer","offers":{"price":"50500","priceCurrency":"TRY"}}</script><button>Sepete Ekle</button>`;
  assert.equal(extractProductPage(competingPrices, "https://www.3dultra.com.tr/example-printer", "printer").product.price, 50500, "3D Ultra uses its cart-price variable");
  assert.equal(extractProductPage(competingPrices, "https://www.valment.com.tr/example-printer", "printer").product.price, 55000, "Valment uses its visible KDV-included buy-box price");
  assert.equal(preferredPriceSource("https://www.urhanshop.com/example"), "structured");

  const microdataCurrency = extractProductPage(`<h1>Bambu Lab X1E Combo</h1>
    <meta itemprop="price" content="159001.88"><meta itemprop="priceCurrency" content="TRY">
    <div>$2,700.00 €2,500.00</div><button>Sepete Ekle</button>`, "https://shop.example/bambu-lab-x1e-combo", "printer");
  assert.equal(microdataCurrency.product.price, 159001.88);
  assert.equal(microdataCurrency.product.priceCurrency, "TRY", "microdata price keeps its declared currency despite unrelated foreign-currency text");

  const pairedVat = extractProductPage(`<script type="application/ld+json">{"@type":"Product","name":"Snapmaker U1 3D Yazıcı","brand":"Snapmaker","offers":{"price":"49918.50","priceCurrency":"TRY"}}</script>
    <h1>Snapmaker U1 3D Yazıcı</h1><div>41598.75 TL + KDV</div><del>63.408,00 TL</del><div class="sale-price">49.918,50 TL</div><button>Sepete Ekle</button>`, "https://shop.example/snapmaker-u1", "printer");
  assert.equal(pairedVat.product.price, 49918.5);
  assert.equal(pairedVat.product.vatStatus, "included", "a payable price equal to the visible net price plus VAT is not taxed twice");

  const plusVat = extractProductPage(`
    <h1>Creality K1 Max 3D Yazıcı</h1>
    <div class="brand">Creality</div>
    <img src="https://cdn.example.com/k1.jpg">
    <div class="sale-price">10.000,00 TL</div><span>+ KDV</span>`, "https://www.rhino3dprinter.com/creality-k1-max-3d-yazici", "printer");
  assert.equal(plusVat.product.plusVat, true);
  assert.equal(plusVat.product.price, 10000);
  assert.equal(plusVat.product.vatStatus, "excluded");

  const silentVat = extractProductPage(`
    <h1>Creality K1 Max 3D Yazıcı</h1><button>Sepete Ekle</button>
    <div class="sale-price">10.000,00 TL</div>`, "https://shop.example/creality-k1-max", "printer");
  assert.equal(silentVat.product.vatStatus, "unknown", "a silent page stays unknown instead of becoming KDV-included");
  assert.equal(silentVat.product.vatIncluded, undefined);
  assert.equal(shouldAddVat("excluded", "unknown"), true, "the saved shop policy applies when a page is silent");
  assert.equal(shouldAddVat("excluded", "included"), false, "explicit KDV-included page text overrides the shop default");
  assert.equal(shouldAddVat("included", "excluded"), true, "explicit +KDV page text always adds tax");
  assert.equal(shouldAddVat("included", "unknown"), false, "an included shop does not invent tax on a silent page");

  const incomplete = extractProductPage("<h1>Mystery</h1>", "https://www.rhino3dprinter.com/creality-k2-3d-yazici", "printer");
  assert.ok(incomplete.incomplete);
  assert.match(incomplete.reason, /incomplete/i);

  console.log("PASS: 15 in-scope Rhino printers, 7 rejected listings, no Dropshipping names, card parse routes badge to stock.");
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
