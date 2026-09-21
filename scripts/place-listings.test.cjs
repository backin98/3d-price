const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { placeListings } = require('../lib/qwen-place.cjs');
const { unionCatalog } = require('../lib/catalog-union.cjs');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), '3d-place-'));
  const catalogFile = path.join(dir, 'catalog.json');
  fs.writeFileSync(catalogFile, JSON.stringify({
    products: [{
      id: 'rhino-a1',
      name: 'Bambu Lab A1 3D Yazıcı',
      brand: 'Bambu Lab',
      kind: 'printer',
      aisle: 'fdm',
      offers: [{ store: 'Rhino 3D Printer', price: 20000, url: 'https://www.rhino3dprinter.com/bambu-lab-a1-3d-yazici' }]
    }],
    filaments: []
  }));

  // Thumbnails are downloaded for the reverse-image step; that is not the model. Only a
  // non-image fetch counts as an LLM call, and with the toggle off there must be none.
  let modelCalls = 0;
  let thumbnails = 0;
  const origFetch = global.fetch;
  global.fetch = async (url) => {
    if (/\.jpg|\.png|\.webp/i.test(String(url))) { thumbnails += 1; return { ok: false, status: 404, body: null }; }
    modelCalls += 1;
    throw new Error('model must not be called: ' + url);
  };

  try {
    const merged = await placeListings({
      listings: [{
        name: 'Bambu Lab A1 3D Printer',
        brand: 'Bambu Lab',
        kind: 'printer',
        price: 18500,
        url: 'https://store.metatechtr.com/bambu-lab-a1',
        image: 'https://cdn.example.com/a1.jpg'
      }],
      site: 'metatech',
      catalogFile,
      apply: false
    });
    assert.equal(modelCalls, 0);
    assert.equal(merged.run.model, '');
    assert.equal(merged.run.merged, 1);
    assert.equal(merged.run.created, 0);
    assert.equal(merged.run.held, 0);

    const wrongModel = await placeListings({
      listings: [{
        name: 'Bambu Lab',
        brand: 'Bambu Lab',
        kind: 'printer',
        price: 22000,
        url: 'https://store.example/bambu-lab-h2s'
      }],
      site: 'example',
      catalogFile,
      apply: false
    });
    assert.equal(wrongModel.run.merged, 0, 'placement cannot bypass URL-derived model conflicts');

    const created = await placeListings({
      listings: [{
        name: 'Bambu Lab A1 Combo 3D Yazıcı',
        brand: 'Bambu Lab',
        kind: 'printer',
        price: 24000,
        url: 'https://store.metatechtr.com/bambu-lab-a1-combo',
        image: 'https://cdn.example.com/combo.jpg'
      }],
      site: 'metatech',
      catalogFile,
      apply: false
    });
    assert.equal(modelCalls, 0);
    // The policy, not the incidental outcome. A1 is a generic core, so it is a channel-uncertain
    // confirmed row: it may merge onto the row that holds that identity, or create one carrying the
    // confirmed identity. What it must never do is produce a silent, unnamed new row — that is the
    // behaviour this test was written to pin down, and pinning the exact branch instead made it
    // flip every time the baseline learned a model.
    assert.equal(created.run.held, 0, 'a confirmed identity does not wait for permission');
    assert.ok(
      created.run.merged === 1 || (created.run.created === 1 && !!created.audit[0].baselineIdentityId),
      'A1 Combo merges onto the confirmed row, or is created carrying the confirmed identity: ' + JSON.stringify(created.run)
    );

    const held = await placeListings({
      listings: [{
        name: 'Mystery Printer',
        brand: '',
        kind: 'printer',
        price: 100,
        url: 'https://store.metatechtr.com/mystery'
      }],
      site: 'metatech',
      catalogFile,
      apply: false
    });
    assert.equal(modelCalls, 0);
    assert.equal(held.run.held, 1);
    assert.ok(fs.existsSync(path.join(dir, 'qwen-employee', 'catalog.candidate.json')));
    const u = unionCatalog(
      { products: [{ id: 'a', name: 'Live A1', kind: 'printer', offers: [{ url: 'https://a.example/a1' }] }], filaments: [] },
      { products: [{ id: 'b', name: 'Cand A1 Combo', kind: 'printer', offers: [{ url: 'https://b.example/combo' }] }], filaments: [] }
    );
    assert.equal(u.products.length, 2);
    const { collapseByMagellan } = require('../lib/catalog-union.cjs');
    const grouped = collapseByMagellan({
      products: [
        { id: '1', name: 'Bambu Lab A1 Combo 3D Yazıcı', brand: 'Bambu Lab', kind: 'printer', offers: [{ store: 'Rhino', price: 20000, url: 'https://a.example/combo' }] },
        { id: '2', name: 'Bambu Lab A1 Combo 3D Printer', brand: 'Bambu Lab', kind: 'printer', offers: [{ store: 'Metatech', price: 18500, url: 'https://b.example/combo' }] }
      ],
      filaments: []
    });
    assert.equal(grouped.products.length, 1);
    assert.equal(grouped.products[0].offers.length, 2);
    assert.equal(grouped.products[0].offers[0].price, 18500);
    const { pricesToTry } = require('../lib/catalog-union.cjs');
    const tl = pricesToTry({
      products: [{ name: 'X', currency: 'USD', offers: [{ price: 20, currency: 'USD' }] }],
      filaments: []
    });
    assert.equal(tl.products[0].currency.code, 'TRY');
    assert.ok(tl.products[0].offers[0].price > 100);
  } finally {
    global.fetch = origFetch;
    fs.rmSync(dir, { recursive: true, force: true });
  }

  console.log('PASS: deterministic placement works with no model; combo splits; incomplete evidence is held.');
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
