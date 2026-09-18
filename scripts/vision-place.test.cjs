// End to end: a gray-band printer pair is confirmed by thumbnails, Gemma stays out of
// it, and the second run reuses the fingerprint instead of re-downloading.
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const cache = path.join(os.tmpdir(), 'vision-place-phash-' + Date.now() + '.json');
process.env.IMAGE_PHASH_FILE = cache; // read when image-match is first required

const assert = require('node:assert/strict');
const { placeListings } = require('../lib/qwen-place.cjs');
const { shutdown } = require('../lib/image-match.cjs');

const IMG_LISTING = 'https://cdn.example.com/ender-ke.jpg';
const IMG_CANDIDATE = 'https://cdn.example.com/ender-se.jpg';
const IMG_LISTING2 = 'https://cdn.example.com/other-ke.jpg';
const IMG_CANDIDATE2 = 'https://cdn.example.com/other-se.jpg';
const bottle = fs.readFileSync('public/assets/products/bottle.jpg');
const coffee = fs.readFileSync('public/assets/products/coffee.jpg');
const picture = (bytes) => new Response(bytes, { status: 200, headers: { 'content-type': 'image/jpeg' } });

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vision-place-'));
const catalogFile = path.join(dir, 'catalog.json');
const writeCatalog = (candidateImage = IMG_CANDIDATE) => fs.writeFileSync(catalogFile, JSON.stringify({
  products: [{
    id: 'rhino-se',
    name: 'Creality Ender 3 V3 SE',
    brand: 'Creality',
    kind: 'printer',
    offers: [{ store: 'Rhino', price: 12000, url: 'https://rhino.example/ender-se', image: candidateImage }]
  }],
  filaments: []
}));
const listing = (image) => [{
  name: 'Creality Ender 3 V3 KE',
  brand: 'Creality',
  kind: 'printer',
  price: 11000,
  url: 'https://shop.example/ender-ke',
  image
}];

let modelCalls = 0;
let imageFetches = 0;
let failImages = false;
const realFetch = global.fetch;

(async () => {
  global.fetch = async (url) => {
    const u = String(url);
    if (u === IMG_LISTING) {
      imageFetches += 1;
      if (failImages) throw new Error('offline');
      return picture(bottle);
    }
    if (u === IMG_CANDIDATE) {
      imageFetches += 1;
      if (failImages) throw new Error('offline');
      return picture(bottle); // same photo, different CDN path
    }
    modelCalls += 1;
    throw new Error('the model must not be called: ' + u);
  };

  // 1. Gray titles + the same thumbnail -> merge, and no Gemma call (toggle is off).
  writeCatalog();
  let result = await placeListings({ listings: listing(IMG_LISTING), site: 'shop', catalogFile, apply: false, autoLlmMatch: false });
  let row = result.audit[0];
  assert.equal(row.action, 'held', 'a matching thumbnail confirms but never merges alone: ' + row.reason);
  assert.equal(row.photoMatch, true);
  assert.equal(row.matchPath, 'magellan+visual');
  assert.equal(row.candidateId, 'rhino-se');
  assert.ok(row.visual >= 0.84, 'the visual score is carried for the review board, got ' + row.visual);
  assert.match(row.reason, /confirm one printer/);
  assert.equal(modelCalls, 0, 'LLM help is off, so Gemma is never asked');
  assert.equal(imageFetches, 2, 'both thumbnails were fetched once');
  assert.ok(fs.existsSync(cache), 'fingerprints are cached to disk');

  // 2. Second run with the network gone: the cache answers, same decision.
  failImages = true;
  writeCatalog();
  result = await placeListings({ listings: listing(IMG_LISTING), site: 'shop', catalogFile, apply: false });
  row = result.audit[0];
  assert.equal(row.action, 'held', 'a cached fingerprint still confirms');
  assert.equal(row.photoMatch, true);
  assert.equal(row.matchPath, 'magellan+visual');
  const after = imageFetches;
  assert.equal(after, 2, 'no second download');

  // 3. Same gray titles, a different photo -> hold as a near duplicate, still no Gemma.
  // Fresh URLs on purpose: the cache is keyed by image URL.
  writeCatalog(IMG_CANDIDATE2);
  global.fetch = async (url) => {
    const u = String(url);
    if (u === IMG_LISTING2) return picture(coffee);
    if (u === IMG_CANDIDATE2) return picture(bottle);
    modelCalls += 1;
    throw new Error('the model must not be called: ' + u);
  };
  result = await placeListings({ listings: listing(IMG_LISTING2), site: 'shop', catalogFile, apply: false });
  row = result.audit[0];
  assert.equal(row.action, 'held', 'thumbnails that disagree leave the call to the human');
  assert.equal(row.nearDupe, true);
  assert.match(row.reason, /[Nn]ear duplicate/);
  assert.equal(modelCalls, 0);

  // 4. Vision off: the gray band holds exactly as it did before this feature.
  writeCatalog();
  result = await placeListings({ listings: listing(IMG_LISTING), site: 'shop', catalogFile, apply: false, visualMatch: false });
  row = result.audit[0];
  assert.equal(row.action, 'held');
  assert.equal(row.visual == null, true, 'no visual evidence when vision is off');
  assert.equal(row.nearDupe, true, 'the gray band still holds for the human');

  console.log('PASS: thumbnails confirm the gray band, fingerprints are reused, Gemma stays out, vision is switchable.');
})()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => {
    global.fetch = realFetch;
    await shutdown(); // Chromium is open after any decode
    fs.rmSync(cache, { force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  });
