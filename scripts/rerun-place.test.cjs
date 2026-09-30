// A second run of a shop you already published refreshes prices and stock on the rows you placed the
// listings on. The end-to-end run (scripts/e2e-local-run.cjs) found it holding them instead:
//  - a spool on its filament family row was held as "Ambiguous deterministic title match" because
//    another family of the same brand scored in the gray band,
//  - a printer you published from Uncertain was held again by the new-product gate,
//  - a printer whose confirmed identity is its own row was held as "Invalid or low-confidence merge",
//  - and each refresh stamped the spool's colour onto the family row, so the next colour of the same
//    family looked like a different product.
// Listings come from the saved Rhino pages; the catalog is what the first run's publish produced.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { harvestCategory } = require('../lib/harvest.js');
const { listingFromHarvest } = require('../lib/qwen-website-job.cjs');
const { placeListings } = require('../lib/qwen-place.cjs');

const page = (file) => fs.readFileSync(path.join(__dirname, 'fixtures', 'pages', file), 'utf8');
async function listingsOf(file, url, kind, pick) {
  const got = await harvestCategory({ categoryUrl: url, kind, html: page(file), inStockOnly: true });
  return got.inScope.filter((c) => pick.test(c.name)).map((c) => listingFromHarvest(c.url, c, { kind, url }, new Set())).filter(Boolean);
}
const offer = (l, price) => ({ store: 'rhino3dprinter.com', url: l.url, price, image: l.image, sourceTitle: l.sourceTitle || l.name, colorName: l.colorName || '', stockStatus: 'in_stock' });

(async () => {
  const spools = await listingsOf('rhino-filament-cesitleri.html', 'https://www.rhino3dprinter.com/filament-cesitleri', 'filament', /^Bambu Lab PLA (Basic|Matte) Filament/);
  const printers = await listingsOf('rhino-3d-yazicilar.html', 'https://www.rhino3dprinter.com/3d-yazicilar', 'printer', /Photon P1 Combo|Bambu Lab H2D 3D Printer|QIDI Q2C ve Outlet|Snapmaker 2\.0/);
  assert.ok(spools.length >= 8 && printers.length === 4, 'the saved pages hold the listings: ' + spools.length + ' spools, ' + printers.length + ' printers');
  const basic = spools.filter((l) => /Basic/.test(l.sourceTitle));
  const matte = spools.filter((l) => /Matte/.test(l.sourceTitle));

  // What the first run's publish left: one family row per model with a colour per offer (published
  // from the board with its baseline family), and the printers as you confirmed them on Uncertain.
  const family = (id, name, variant, list) => ({ id, name, brand: 'Bambu Lab', kind: 'filament', polymer: 'pla', variant, diameter: '1.75 mm', aisle: 'filament', baselineId: id, offers: list.map((l) => offer(l, l.price - 50)) });
  const catalog = {
    products: printers.map((l, i) => ({ id: 'sel-' + i, name: l.name, brand: l.brand, kind: 'printer', aisle: 'fdm', offers: [offer(l, l.price - 500)] })),
    filaments: [family('filament/bambu-lab/basic-pla/unknown', 'Bambu Lab Basic PLA', 'basic', basic), family('filament/bambu-lab/matte-pla/unknown', 'Bambu Lab Matte PLA', 'matte', matte)]
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rerun-place-'));
  const catalogFile = path.join(dir, 'catalog.json');
  fs.writeFileSync(catalogFile, JSON.stringify(catalog));

  const placed = await placeListings({ listings: [...spools, ...printers], site: 'rhino3dprinter.com', catalogFile, apply: true, visualMatch: false });
  const held = placed.audit.filter((row) => row.action !== 'updated');
  assert.deepEqual(held.map((row) => (row.listing.sourceTitle || row.listing.name) + ': ' + row.action + ' — ' + row.reason), [], 'every published listing is refreshed on its own row');

  const after = JSON.parse(fs.readFileSync(catalogFile, 'utf8'));
  for (const l of [...spools, ...printers]) {
    const row = [...after.products, ...after.filaments].find((p) => (p.offers || []).some((o) => o.url === l.url));
    assert.equal(row.offers.find((o) => o.url === l.url).price, l.price, (l.sourceTitle || l.name) + ': the price is the new one');
  }
  assert.equal(after.filaments.length, 2, 'no new filament row');
  assert.equal(after.products.length, 4, 'no new printer row');
  for (const row of after.filaments) {
    assert.equal(row.color || '', '', row.name + ': a family row takes no single spool colour');
    assert.equal(row.variant, row.id.includes('matte') ? 'matte' : 'basic', row.name + ': keeps its variant');
  }
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('PASS: a second run refreshes ' + placed.audit.length + ' published listings (spools on their family rows, printers you confirmed) in place: nothing held, no new rows, family colours untouched.');
})().catch((err) => { console.error(err); process.exitCode = 1; });
