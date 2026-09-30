// What a listing IS decides what reaches a shelf. The old rule called anything with a printer brand
// in its title a printer, so hotends, fans, upgrade kits and AMS units were published as printers,
// and "ender" counted as a printer word, so every Creality Ender PLA spool was held out of filament
// runs as a "printer". Titles below are real listings from the shops (docs/real-listings.jsonl and
// the published catalog), and the two category pages are saved copies of the live shops.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { classifyProductType } = require('../lib/product-type.cjs');
const { harvestCategory } = require('../lib/harvest.js');

const cases = {
  printer: [
    'Bambu Lab A1 Mini 3D Yazıcı',
    'Bambu Lab A1 Combo',
    'Anycubic Kobra 3 V2 Combo 3D Yazıcı',
    'Creality Ender-3 V4 Combo',
    'Bambu Lab P1S AMS 2 Pro Combo 3D Yazıcı',
    'Bambu Lab P1s 3D Yazıcı Ams\'siz 256 x 256 x 256mm Kapalı Gövde Süper Hızlı 3D Yazıcı',
    'Bambu Lab P1s Combo 3D Yazıcı Ams ile 16 Renge Kadar Baskı',
    'creality k2 combo 3d yazici cfs cok renkli baski',
    'Bambu Lab H2c Combo 3D Yazıcı - Çift Nozul, 350°C Hotend, Endüstriyel Hassasiyet',
    'Bambu Lab H2C Laser Full Combo 10W',
    'Bambu Lab H2D Laser Full Combo 10W 3d Yazıcı Fiyatı Ve Özellikleri',
    'Bambu Lab X1 Carbon AMS 2 Pro Bundle',
    'Bambu Lab X1 Carbon AMS 2 Pro',
    'Bambu Lab H2D AMS Pro',
    'Bambu Lab H2D Combo AMS HT Bundle',
    'FLASHFORGE Adventurer 5X & Enclosed Kit Bundle (Kamera Hediyeli)',
    'QIDI Q2C ve Outlet QIDI Box Özel Set',
    'QIDI Tech Max4 Combo 3d Yazıcı * Polar Cooler Hediye*',
    'ELEGOO Centauri Carbon 2 Combo 3D Yazıcı R3D Kurutucu Bundle',
    'wanhao d13 idex dual extruder endustriyel 3d yazici',
    'Wanhao Duplicator i3 Plus Mark II',
    'Zaxe Z3S',
    'Original Prusa CORE One 3D Printer Kit',
    'Anycubic Photon Mono M7 Pro MSLA 3D Printer',
    'Snapmaker 2.0 A350ENT 3in1 3D Printer',
    'Bambu Lab P1S 3D Yazıcı Kamera ile'
  ],
  accessory: [
    // the hotends, fans and kits that were on the printer shelf
    'bambu lab fah021 a1a1 mini 08mm sertlestirilmis celik hotend',
    'bambu lab faf002 hotend sogutma fani x1 x1 carbon',
    'bambu lab x1e paslanmaz celik 08mm nozul hotend tam unite fah014',
    'bambu lab fah001 complete hotend assembly with hardened steel nozzle 0.4 mm x1 x1 carbon x1c',
    'creality cfs upgrade accessory kit k1 serisi',
    'Creality K1 Serisi CFS Upgrade Kiti',
    'Original Prusa i3 MK3/S/+ to MK4 upgrade kit',
    // add-on modules on their own
    'Bambu Lab AMS 2 Pro',
    'Bambu Lab AMS 2 Pro (Kutusuz)',
    'Bambu Lab AMS Lite - Automatic Material System',
    'Creality CFS-C Multicolor Kit',
    'QIDI Box Çok Renkli Baskı Modülü *Outlet*',
    'Qidi Box Renk Modülü',
    'QIDI Q2 Box Hub',
    'Bambu Lab AMS Lite A1 Uyumlu',
    // parts named after the printer they fit
    '3D Yazıcı Tabla Yayı',
    '3D Yazıcı Tabla Kalibrasyon Somunu',
    'Ender 3 V3 3D Yazıcı Tabla Yayı',
    'Creality Ender-3 V3 SE Yedek Hotend',
    'Kobra 3 için 0.4 mm Nozul',
    'Bambu Lab Textured PEI Plate',
    'Flsun V400 Kabin (Enclosure)',
    // filament gear
    'Creality SpacePi X4 Filament Kurutucu',
    'Vakumlu Filament Saklama Poşeti - 5 Adet'
  ],
  laser: [
    'Snapmaker Ray Lazer Gravür ve Kesici - 40W',
    'Creality Falcon A1 Pro 20W Lazer Gravür ve Kesici',
    'xTool F1 Ultra İnanılmaz Lazer'
  ],
  filament: [
    'Creality Ender PLA+ Filament - Green',
    'Creality Ender Fast PLA Siyah Filament 1.75mm 1000gr',
    'Porima PLA Army Filament Kobra 1.75mm 1Kg',
    'Bambu Lab PLA Matte Çeşitleri',
    'Elegoo PLA+ 1kg Siyah',
    'Beta PEBA 90A Black',
    'Basf Ultrafuse PAHT CF15 1.75 mm 750g',
    '3D Yazıcı Filamenti PLA 1.75mm Siyah'
  ]
};

for (const [want, titles] of Object.entries(cases)) {
  for (const title of titles) {
    assert.equal(classifyProductType(title, ''), want, JSON.stringify(title) + ' is a ' + want);
  }
}

// Saved category pages: a printer run keeps every printer (bundles with AMS, lasers, dryers, a gifted
// camera included) and holds the modules out as category mismatches instead of publishing them.
(async () => {
  const page = (file) => fs.readFileSync(path.join(__dirname, 'fixtures', 'pages', file), 'utf8');

  const rhino = await harvestCategory({ categoryUrl: 'https://www.rhino3dprinter.com/3d-yazicilar', kind: 'printer', html: page('rhino-3d-yazicilar.html'), inStockOnly: false });
  const rhinoIn = rhino.inScope.map((p) => p.name);
  assert.deepEqual(rhino.mismatches.map((m) => [m.name, m.detectedType]), [['Qidi Box Renk Modülü', 'accessory']]);
  for (const name of ['FLASHFORGE Adventurer 5X & Enclosed Kit Bundle (Kamera Hediyeli)', 'QIDI Q2C ve Outlet QIDI Box Özel Set', 'Bambu Lab H2C Laser Full Combo 10W', 'Creality Ender-3 V4 Combo']) {
    assert.ok(rhinoIn.includes(name), 'Rhino keeps the printer ' + name);
  }
  assert.equal(rhino.inScope.length, 23);

  const tekno = await harvestCategory({ categoryUrl: 'https://www.3dteknomarket.com/collections/fdm-yazicilar', kind: 'printer', html: page('teknomarket-fdm-yazicilar.html'), inStockOnly: false });
  assert.deepEqual(tekno.mismatches.map((m) => m.name).sort(), ['Bambu Lab AMS - Automatic Material System', 'Bambu Lab AMS 2 Pro', 'Bambu Lab AMS Lite - Automatic Material System']);
  assert.ok(tekno.inScope.every((p) => p.kind === 'printer'));
  for (const name of ['Bambu Lab X1 Carbon AMS 2 Pro Bundle', 'ELEGOO Centauri Carbon 2 Combo 3D Yazıcı R3D Kurutucu Bundle', 'Bambu Lab H2D AMS Pro 3D Yazıcı']) {
    assert.ok(tekno.inScope.some((p) => p.name === name), '3D Teknomarket keeps the printer ' + name);
  }
  assert.equal(tekno.inScope.length, 42);

  // Rows published as printers before these rules stay in the admin, but the catalog API keeps them
  // off the storefront shelves.
  const vm = require('node:vm');
  const huntSrc = fs.readFileSync(path.join(__dirname, '..', 'netlify', 'functions', 'hunt.mjs'), 'utf8')
    .replace(/^import .*;$/gm, '')
    .replace('export default async', 'globalThis.handler = async');
  const offer = (store, n) => [{ store, price: 1000 + n, url: 'https://' + store + '/p' + n }];
  const files = {
    'catalog.json': {
      products: [
        { id: 'a1', name: 'Bambu Lab A1 Combo 3D Yazıcı', kind: 'printer', offers: offer('shop-a.example', 1) },
        { id: 'fan', name: 'bambu lab faf002 hotend sogutma fani x1 x1 carbon', kind: 'printer', offers: offer('shop-a.example', 2) },
        { id: 'ams', name: 'Bambu Lab AMS 2 Pro', kind: 'printer', offers: offer('shop-b.example', 3) },
        { id: 'zaxe', name: 'Zaxe Z3S', kind: 'printer', offers: offer('shop-b.example', 4) }
      ],
      filaments: [
        { id: 'pla', name: 'Creality Ender PLA+ Filament', kind: 'filament', polymer: 'pla', offers: offer('shop-a.example', 5) },
        { id: 'dryer', name: 'Creality SpacePi X4 Filament Kurutucu', kind: 'filament', offers: offer('shop-a.example', 6) }
      ]
    }
  };
  const sandbox = {
    Response, URL,
    store: { readJSON: async (key, fallback) => JSON.parse(JSON.stringify(key in files ? files[key] : fallback)) },
    catalogUnion: require('../lib/catalog-union.cjs'),
    search: require('../lib/search-match.cjs'),
    boardLib: require('../lib/baseline-board.cjs'),
    merchLib: require('../lib/storefront-merch.cjs'),
    productType: require('../lib/product-type.cjs')
  };
  vm.runInNewContext(huntSrc, sandbox);
  const served = await (await sandbox.handler({ url: 'https://3d-price.example/api/hunt' })).json();
  assert.deepEqual(served.products.map((p) => p.id).sort(), ['a1', 'zaxe'], 'the fan and the AMS unit are not on the printer shelf');
  assert.deepEqual(served.filaments.map((p) => p.id), ['pla'], 'the dryer is not on the filament shelf');

  console.log('PASS: parts, add-on modules and laser engravers stay off the printer shelf; printer bundles and Ender PLA spools classify correctly.');
})().catch((e) => { console.error(e); process.exitCode = 1; });
