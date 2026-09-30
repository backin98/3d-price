// A filament shop run on Rhino's saved filament page (scripts/fixtures/pages/rhino-filament-cesitleri.html),
// from the category page to what the review board and the catalog receive. Three bugs the end-to-end
// run (scripts/e2e-local-run.cjs) found, each pinned here:
//  - taxonomy() wrote weight "1000" and diameter "1.75" back onto every listing. The next match read
//    that as no diameter, so every spool was held as "unknown diameter" against the baseline, and the
//    admin publish, which keeps "<n> g" weights only, dropped the weight from the offer.
//  - Colour names the taxonomy did not know stayed in the name ("... - Desert Tan", "... - Violet"),
//    and "Lacivert" never met "Navy Blue" from another shop.
//  - The e-commerce registry badge in the shop footer (etbis.ticaret.gov.tr) was harvested as a spool.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { harvestCategory } = require('../lib/harvest.js');
const { listingFromHarvest } = require('../lib/qwen-website-job.cjs');
const { taxonomy, identity } = require('../lib/product-match.cjs');
const { placeListings } = require('../lib/qwen-place.cjs');
const { classifyFilament } = require('../api/filament-classify.js');

const CATEGORY = 'https://www.rhino3dprinter.com/filament-cesitleri';
const ADMIN_WEIGHT = /^\d+ g$/; // netlify/functions/admin.mjs applySelectedListings keeps an offer weight only in this form

(async () => {
  const html = fs.readFileSync(path.join(__dirname, 'fixtures', 'pages', 'rhino-filament-cesitleri.html'), 'utf8');
  const harvested = await harvestCategory({ categoryUrl: CATEGORY, kind: 'filament', html, inStockOnly: false });
  assert.equal(harvested.inScope.length, 48, 'the page shows 48 spools, and the footer badge is not one of them');
  assert.ok(harvested.inScope.every((p) => new URL(p.url).hostname === 'www.rhino3dprinter.com'), 'every listing is on the shop');
  assert.ok((harvested.rejected || []).some((r) => /etbis\.ticaret\.gov\.tr/.test(r.url) && r.reason === 'link to another site'));

  const job = { kind: 'filament', url: CATEGORY };
  const listings = harvested.inScope.map((card) => listingFromHarvest(card.url, card, job, new Set())).filter(Boolean);
  assert.equal(listings.length, 48);

  // Units survive the taxonomy pass, and a listing that went through it still has its diameter.
  for (const l of listings) {
    const t = taxonomy(l);
    assert.match(t.weight, ADMIN_WEIGHT, l.sourceTitle + ': weight ' + t.weight);
    assert.equal(t.diameter, '1.75 mm', l.sourceTitle + ': diameter ' + t.diameter);
    assert.equal(identity({ ...l, ...t }).diameter, '1.75', l.sourceTitle + ': the diameter survives being written back');
  }
  assert.equal(identity({ name: 'Polymaker PolyLite PETG', kind: 'filament', diameter: '2.85' }).diameter, '2.85', 'a bare 2.85 in the diameter field is 2.85 mm');

  // Colours named after the dash are read, and the name keeps the product only.
  const bySource = (title) => listings.find((l) => l.sourceTitle === title);
  const tan = bySource('Bambu Lab PLA Matte Filament - Desert Tan');
  assert.deepEqual([tan.name, tan.color, tan.colorName], ['Bambu Lab PLA Matte Filament', 'desert-tan', 'Desert Tan']);
  const violet = bySource('Esun E-Silk PLA+ Filament - Violet');
  assert.deepEqual([violet.name, violet.color], ['Esun E-Silk PLA+ Filament', 'violet-purple']);
  assert.equal(classifyFilament({ name: 'ELEGOO PLA Matte Lacivert Filament 1.75mm 1000gr' }).color, 'navy-blue');
  assert.equal(classifyFilament({ name: 'ELEGOO PLA Matte Filament Navy Blue' }).color, 'navy-blue', 'Lacivert and Navy Blue are one colour');
  const noColour = listings.filter((l) => !l.color && !l.multicolor);
  assert.deepEqual(noColour.map((l) => l.sourceTitle), ['Filamix PLA+ Filament - Wood'], 'every other spool on the page has a colour');

  // Placement against the human baseline: a spool whose model and colour the baseline knows is placed,
  // not held as "No human baseline model", and what reaches the board keeps its units.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filament-run-'));
  const catalogFile = path.join(dir, 'catalog.json');
  fs.writeFileSync(catalogFile, JSON.stringify({ products: [], filaments: [] }));
  const baselineFile = path.join(dir, 'baseline.json');
  const family = { id: 'filament/bambu-lab/basic-pla/1.75', category: 'filaments', entityType: 'family', parentId: '', name: 'Bambu Lab Basic PLA', brand: 'Bambu Lab', polymer: 'pla', variant: 'basic', color: '', weight: '', diameter: '1.75 mm', packaging: '' };
  const black = { ...family, id: family.id + '/black', entityType: 'sku', parentId: family.id, name: 'Bambu Lab Basic PLA Black', color: 'black', weight: '1000 g', packaging: 'spool' };
  fs.writeFileSync(baselineFile, JSON.stringify({ categories: [{ id: 'filaments', name: 'Filament' }], items: [family, black] }));
  const bambuBlack = listings.find((l) => l.name === 'Bambu Lab PLA Basic Filament' && l.color === 'black');
  const events = [];
  const placed = await placeListings({ listings: [bambuBlack], site: 'rhino3dprinter.com', catalogFile, baselineFile, apply: false, visualMatch: false, emit: (ev) => events.push(ev) });
  const row = placed.audit[0];
  assert.notEqual(row.action, 'held', 'the baseline knows this spool: ' + row.reason);
  assert.equal(row.matchPath, 'human-baseline');
  assert.equal(row.baselineId, black.id);
  const card = events.find((ev) => ev.type === 'place').listing;
  assert.match(card.weight, ADMIN_WEIGHT, 'the board card weight is one the admin publish keeps');
  assert.equal(card.diameter, '1.75 mm');
  fs.rmSync(dir, { recursive: true, force: true });

  console.log('PASS: a filament run on the saved Rhino page keeps weight and diameter units, reads every named colour, skips the footer badge, and places a spool the baseline knows.');
})().catch((err) => { console.error(err); process.exitCode = 1; });
