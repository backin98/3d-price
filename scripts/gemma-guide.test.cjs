// Catalog-guided Gemma (Part A of the reference prompt).
//
// The invariant: Magellan decides everything it can; the model is only ever asked to *choose*
// from identities our own catalog already holds, and the code refuses anything else. A hold is
// the correct outcome for every uncertain case — never a silent merge, never a silent duplicate.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const { buildGemmaContext, buildAllowedIdentities, enforceDecision, hardConflictsBetween } = require('../lib/guide-gemma.cjs');
const matcher = require('../lib/product-match.cjs');

// --- the model is stubbed for the escalation wiring ------------------------------------
let asked = 0;
let tasks = [];
let answer = { decision: 'merge', identityId: 'bambu/p1s/combo/ams-2-pro', confidence: 0.92, reason: 'stub' };
let failWith = null;
const load = Module._load;
Module._load = function (request, ...rest) {
  if (request === '../scripts/local-qwen.cjs') {
    return {
      ask: async (task) => {
        asked += 1;
        tasks.push(task);
        if (failWith) throw new Error(failWith);
        return answer;
      }
    };
  }
  return load.call(this, request, ...rest);
};
const { placeListings, gemmaPick } = require('../lib/qwen-place.cjs');
const { shutdown } = require('../lib/image-match.cjs');

const catalogRow = (id, name, url) => ({ id, name, brand: 'Bambu Lab', kind: 'printer', offers: [{ store: 'Rhino', price: 30000, url, image: '' }] });
const CATALOG = [
  catalogRow('row-bare', 'Bambu Lab P1S 3D Yazıcı', 'https://rhino.example/p1s'),
  catalogRow('row-ams2', 'Bambu Lab P1S AMS 2 Pro Combo 3D Yazıcı Kurulum Dahil', 'https://rhino.example/p1s-ams2'),
  catalogRow('row-h2d', 'Bambu Lab H2D Combo 3D Yazıcı', 'https://rhino.example/h2d')
];
const listing = (name, url) => ({
  name, brand: 'Bambu Lab', kind: 'printer', price: 31000, url, image: '',
  stockStatus: 'in_stock', stockQuantity: null, stockVerified: true, stockCheckedAt: new Date().toISOString()
});
const rankedFor = (name) => matcher.rankCandidates(
  { name, brand: 'Bambu Lab', kind: 'printer' },
  CATALOG.map((p) => ({ ...p, offers: p.offers.map((o) => ({ ...o })) }))
);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemma-guide-'));
const catalogFile = path.join(dir, 'catalog.json');
const writeCatalog = () => fs.writeFileSync(catalogFile, JSON.stringify({ products: JSON.parse(JSON.stringify(CATALOG)), filaments: [] }));

(async () => {
  // ---------------------------------------------------------------- the closed list
  // "P1S Combo AMS ile 16 Renk" is the reference's own example of noise around a real SKU.
  const comboListing = listing('Bambu Lab P1S Combo AMS ile 16 Renge Kadar Baskı', 'https://shop.example/p1s-combo');
  const ctx = buildGemmaContext(comboListing, rankedFor(comboListing.name));
  const ids = ctx.allowedIdentities.map((e) => e.identityId);

  assert.ok(ctx.allowedIdentities.length >= 3 && ctx.allowedIdentities.length <= 8, '3-8 identities offered: ' + ctx.allowedIdentities.length);
  assert.ok(ids.includes('bambu/p1s/combo/ams'), 'the combo identity of the listing');
  assert.ok(ids.includes('bambu/p1s/bare'), 'the bare configuration of the same model is always offered');
  assert.ok(ctx.catalogHints.officialPackTokens.includes('ams 2 pro'), 'the brand pack lexicon travels with the question');
  assert.ok(ctx.hardConflicts.includes('bare≠combo'), 'the conflict rules travel with the question');
  assert.equal(ctx.gathered.parsedAxes.model, 'p1s', 'the parsed axes are shown to the model');
  // Noise must not invent an axis: "16 renge kadar" is not identity.
  assert.equal(ctx.gathered.parsedAxes.model, matcher.axesOf({ name: 'Bambu Lab P1S Combo', brand: 'Bambu Lab', kind: 'printer' }).modelCore);

  // ---------------------------------------------------------------- enforcement
  // The catalog has a bare P1S and an AMS 2 Pro bundle, but no plain "AMS combo" row. The
  // listing's own identity is offered so the model can name it, yet there is nothing to merge
  // onto — merging is refused and `create` is the answer, which is what the reference says.
  const ownIdentity = enforceDecision({ decision: 'merge', identityId: 'bambu/p1s/combo/ams', confidence: 0.9 }, ctx);
  assert.equal(ownIdentity.action, 'held', 'no row carries that identity yet');
  assert.equal(ownIdentity.rejected, 'no-row');
  const asNew = enforceDecision({ decision: 'create', confidence: 0.9, reason: 'no AMS combo row' }, ctx);
  assert.equal(asNew.action, 'create', 'so a confident create is the outcome');
  // The bare row is offered, but this listing is a combo: choosing it would cross bare≠combo.
  const crossAxis = enforceDecision({ decision: 'merge', identityId: 'bambu/p1s/bare', confidence: 0.99 }, ctx);
  assert.equal(crossAxis.action, 'held');
  assert.equal(crossAxis.rejected, 'conflict');
  // An id nobody offered is a hallucination.
  const invented = enforceDecision({ decision: 'merge', identityId: 'bambu/h2c/combo/ams-2-pro', confidence: 1 }, ctx);
  assert.equal(invented.action, 'held');
  assert.equal(invented.rejected, 'hallucinated-id');
  // Low confidence, and anything that is not merge/create, hold.
  assert.equal(enforceDecision({ decision: 'merge', identityId: 'bambu/p1s/combo/ams', confidence: 0.3 }, ctx).action, 'held');
  assert.equal(enforceDecision({ decision: 'dunno', confidence: 1 }, ctx).action, 'held');
  assert.equal(enforceDecision({}, ctx).action, 'held', 'an empty answer holds');

  // ---------------------------------------------------------------- the alternative branch
  // The AMS 2 Pro bundle is a *different* identity from a bare "AMS ile" combo (reference:
  // "P1S Combo ≠ P1S AMS 2 Pro Combo"), so the model cannot land a vague listing on it.
  const ambiguous = buildGemmaContext(comboListing, rankedFor(comboListing.name));
  const ontoAms2 = enforceDecision({ decision: 'merge', identityId: 'bambu/p1s/combo/ams-2-pro', confidence: 0.95 }, ambiguous);
  assert.equal(ontoAms2.action, 'held', 'an unnamed bundle may not silently claim a named generation');
  assert.ok(ambiguous.hardConflicts.some((c) => c.startsWith('feeder')), 'and the reason is on the conflict list');

  // A listing that *names* AMS 2 Pro lands on that row.
  const named = listing('Bambu Lab P1S AMS 2 Pro Combo 3D Printer with Buffer', 'https://shop.example/p1s-ams2');
  const namedCtx = buildGemmaContext(named, rankedFor(named.name));
  const namedMerge = enforceDecision({ decision: 'merge', identityId: 'bambu/p1s/combo/ams-2-pro', confidence: 0.9 }, namedCtx);
  assert.equal(namedMerge.action, 'merge', 'the named generation merges onto its own row: ' + JSON.stringify(namedMerge));
  assert.equal(namedMerge.candidateId, 'row-ams2');

  // ---------------------------------------------------------------- unknown maker
  const unknownRanked = matcher.rankCandidates(
    { name: 'Anycubic Kobra 3 Combo 3D Yazıcı', brand: 'Anycubic', kind: 'printer' },
    [{ id: 'row-kobra', name: 'Anycubic Kobra 3 Combo', brand: 'Anycubic', kind: 'printer', offers: [] }]
  );
  const unknownCtx = buildGemmaContext({ name: 'Anycubic Kobra 3 Combo 3D Yazıcı', brand: 'Anycubic', kind: 'printer' }, unknownRanked);
  assert.ok(unknownCtx.allowedIdentities.some((e) => e.identityId === 'anycubic/kobra-3/combo/ace-pro'), 'a listed brand gets its real identity');
  const localCtx = buildGemmaContext(
    { name: 'Yerli Marka XYZ-200 Combo 3D Yazıcı', brand: 'Yerli Marka', kind: 'printer' },
    matcher.rankCandidates({ name: 'Yerli Marka XYZ-200 Combo 3D Yazıcı', brand: 'Yerli Marka', kind: 'printer' }, [{ id: 'row-local', name: 'Yerli Marka XYZ-200 Combo', brand: 'Yerli Marka', kind: 'printer', offers: [] }])
  );
  assert.ok(localCtx.listingIdentity.startsWith('unknown/'), 'an unlisted maker still gets an identity: ' + localCtx.listingIdentity);
  assert.ok(localCtx.listingIdentity.includes('xyz-200'), 'and the model tokens carry the identity: ' + localCtx.listingIdentity);
  assert.ok(localCtx.allowedIdentities.length >= 2, 'with a usable closed list to choose from');

  // ---------------------------------------------------------------- wiring: toggle on/off
  writeCatalog();
  asked = 0;
  tasks = [];
  answer = { decision: 'merge', identityId: 'bambu/p1s/combo/ams-2-pro', confidence: 0.92, reason: 'the catalog row' };
  const on = await placeListings({
    listings: [listing('Bambu Lab P1S AMS 2 Pro Combo 3D Yazıcı Cift Nozul', 'https://shop.example/p1s-ams2-new')],
    site: 'shop', catalogFile, apply: false, autoLlmMatch: true, visualMatch: false, runDir: dir
  });
  assert.deepEqual(tasks, ['match-catalog-guided'], 'the run asks the catalog-guided question: ' + JSON.stringify(on.audit[0]));
  assert.equal(on.audit[0].action, 'merge', 'and the enforced answer places the listing');
  assert.equal(on.audit[0].candidateId, 'row-ams2');
  assert.equal(on.audit[0].matchPath, 'gemma-catalog-guided');

  // Toggle off: no model call at all, and a same-brand+model candidate becomes a hold,
  // never a duplicate row.
  writeCatalog();
  asked = 0;
  tasks = [];
  const off = await placeListings({
    listings: [listing('Bambu Lab P1S AMS 2 Pro Combo 3D Yazıcı Cift Nozul', 'https://shop.example/p1s-again')],
    site: 'shop', catalogFile, apply: false, autoLlmMatch: false, visualMatch: false, runDir: dir
  });
  assert.equal(asked, 0, 'no model call with the toggle off');
  assert.equal(off.audit[0].action, 'held', 'the same configuration holds instead of creating: ' + off.audit[0].reason);
  assert.equal(off.run.created, 0, 'and no duplicate row is invented');

  // A model the confirmed catalog has never seen is NOT invented any more. It is held with
  // needsPermission so a human is asked before a row exists — the policy is "merge when confirmed,
  // ask when new", and an unknown model is exactly what the ask is for.
  const fresh = await placeListings({
    listings: [listing('Acme Zeta 900 3D Yazıcı', 'https://shop.example/zeta-900')],
    site: 'shop', catalogFile, apply: false, autoLlmMatch: false, visualMatch: false, runDir: dir
  });
  assert.equal(fresh.audit[0].action, 'held', 'an unknown model waits for permission: ' + JSON.stringify(fresh.audit[0].reason));
  assert.equal(fresh.audit[0].needsPermission, true, 'and is flagged so the board can frame it');
  assert.equal(fresh.run.created, 0, 'no row is invented before a human says yes');

  // A model that times out or answers garbage holds the listing; it never breaks the run.
  writeCatalog();
  failWith = 'model unreachable';
  const broken = await placeListings({
    listings: [listing('Bambu Lab P1S AMS 2 Pro Combo 3D Yazıcı Kamera', 'https://shop.example/p1s-x')],
    site: 'shop', catalogFile, apply: false, autoLlmMatch: true, visualMatch: false, runDir: dir
  });
  assert.equal(broken.audit[0].action, 'held');
  assert.equal(broken.audit[0].matchPath, 'gemma-catalog-guided');
  assert.match(String(broken.audit[0].reason), /unavailable/);
  failWith = null;

  // The aggressive pass is the same question with the same enforcement.
  writeCatalog();
  asked = 0;
  tasks = [];
  answer = { decision: 'merge', identityId: 'bambu/p1s/combo/ams-2-pro', confidence: 0.9, reason: 'stub' };
  const pick = await gemmaPick(listing('Bambu Lab P1S AMS 2 Pro Combo 3D Yazıcı', 'https://shop.example/p1s-ams2-pick'), CATALOG, { dir });
  assert.deepEqual(tasks, ['match-catalog-guided']);
  assert.equal(pick.action, 'merge');
  assert.equal(pick.matchId, 'row-ams2');
  assert.ok(pick.allowed.length >= 3, 'the audit keeps the closed list it was allowed to choose from');

  await shutdown();
  console.log('PASS: Gemma may only choose a catalog identity, the code refuses hallucinated ids and cross-axis merges, and every uncertain case holds instead of guessing.');
})().catch((e) => { console.error(e); process.exitCode = 1; });
