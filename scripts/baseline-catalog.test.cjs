"use strict";

// Baseline catalog + compare API. The spec's definition of done is the assertion list below:
// EN and TR wordings of one product share an identity; prefix collisions must NOT; unknown and
// compatibility-only makers hold; noise-only differences are the same product.
//
// It also contains a performance assertion, which is the part the last outage proved was missing:
// the previous suite was green while /api/hunt took 30s and 502'd, because nothing ever timed the
// real comparison path at catalog scale.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const baseline = require("../lib/baseline-catalog.js");
const normalize = require("../lib/title-normalize.js");
const { compareScrapedToBaseline } = require("../lib/compare-to-baseline.js");

const FILE = path.join(__dirname, "..", "data", "baseline-catalog.json");
assert.ok(fs.existsSync(FILE), "baseline-catalog.json must exist (run scripts/build-baseline-catalog.cjs)");

const rows = baseline.loadBaseline(FILE);
const index = baseline.createCatalogIndex(rows, { locale: "tr" });
assert.ok(rows.length > 150, "baseline should carry the full reference, got " + rows.length);

// --- identity scheme ----------------------------------------------------------------
// {brand}/{modelCore}/{comboAxis}/{feederGen?}/{kitForm?}/{extra?}
assert.equal(
  baseline.identityId({ brand: "bambu", modelCore: "p1s", comboAxis: "combo", feederGen: "ams-2-pro" }),
  "bambu/p1s/combo/ams-2-pro",
  "identityId follows the spec's segment order"
);
assert.equal(
  baseline.identityId({ brand: "creality", modelCore: "k2", comboAxis: "bare" }),
  "creality/k2/bare",
  "a bare machine carries no feeder segment"
);
assert.equal(
  baseline.identityId({ brand: "", modelCore: "zx900", comboAxis: "bare" }),
  "unknown/zx900/bare",
  "an unknown maker contributes 'unknown', so two white-labels can still agree"
);

// --- EN <=> TR: the same product, two languages, one identity ----------------------
// This is the spec's headline requirement. "Combo"/"AMS ile"/"CFS'li" are the same statement, and
// the identity must not depend on which language the shop happened to write it in.
const en = compareScrapedToBaseline({ name: "Bambu Lab P1S Combo 3D Printer" }, index);
const tr = compareScrapedToBaseline({ name: "Bambu Lab P1S Combo 3D Yazıcı" }, index);
assert.equal(en.status, "match", "EN wording matches: " + en.notes.join("; "));
assert.equal(tr.status, "match", "TR wording matches: " + tr.notes.join("; "));
assert.equal(en.identityId, tr.identityId, "EN and TR wordings of one product share an identity");

// Turkish suffix forms and equivalent noise must fold onto the same normalized title.
const a = normalize.normalize("Creality K2 Plus Combo 3D Yazıcı", { locale: "tr", brand: "creality" });
const b = normalize.normalize("CREALITY K2 PLUS COMBO 3D YAZICI", { locale: "tr", brand: "creality" });
assert.equal(a, b, "case and locale-specific letters fold to the same normalized title");

// --- prefix collisions must differ -------------------------------------------------
// A short model must never claim a longer one. This is the failure that made one catalog row out of
// the whole K2 family, so it is asserted in both directions.
const k2 = compareScrapedToBaseline({ name: "Creality K2 Combo 3D Yazıcı" }, index);
const k2Plus = compareScrapedToBaseline({ name: "Creality K2 Plus Combo 3D Yazıcı" }, index);
const k2Pro = compareScrapedToBaseline({ name: "Creality K2 Pro Combo 3D Yazıcı" }, index);
assert.ok(k2Plus.identityId && k2Pro.identityId, "both K2 variants resolve to a row");
assert.notEqual(k2Plus.modelCore, k2.modelCore, "K2 Plus is not K2");
assert.notEqual(k2Pro.modelCore, k2.modelCore, "K2 Pro is not K2");
assert.notEqual(k2Plus.identityId, k2Pro.identityId, "K2 Plus and K2 Pro are different identities");

// Longest match wins even when a shorter alias is a prefix of a longer one.
const longest = baseline.longestModelMatch("Bambu Lab A1 Mini AMS Lite Combo", "bambu", "en");
assert.equal(longest.modelCore, "a1-mini", "the longest alias wins, not the 'a1' prefix");

// --- combo vs bare is identity, not a detail --------------------------------------
const combo = compareScrapedToBaseline({ name: "Bambu Lab P1S AMS 2 Pro Combo 3D Yazıcı" }, index);
const bare = compareScrapedToBaseline({ name: "Bambu Lab P1S 3D Yazıcı" }, index);
assert.equal(combo.axes.comboAxis, "combo", "an AMS mention is a combo");
assert.equal(bare.axes.comboAxis, "bare", "no feeder mention is bare");
assert.ok(
  baseline.hardConflicts(combo.axes, bare.axes).includes("combo"),
  "combo vs bare is reported as a hard conflict"
);

// A Turkish bare suffix must beat a stray combo word: "CFS'siz" means without the feeder.
const bareTr = compareScrapedToBaseline({ name: "Creality K2 Plus CFS'siz 3D Yazıcı" }, index);
assert.equal(bareTr.axes.comboAxis, "bare", "a Turkish 'siz' suffix is a bare machine");

// --- unknown and compatibility hold, never map ------------------------------------
const clone = compareScrapedToBaseline({ name: "Bambu Lab A1 tarzı 3D Yazıcı" }, index);
assert.equal(clone.status, "unknown", "compatibility wording never maps onto a baseline brand");
assert.match(clone.notes.join(" "), /compat/);

// A maker the baseline carries resolves to a row (Zaxe is in the reference — Part C of the prompt
// lists Z3S/X4/Z1-Z3), so the case worth asserting is a maker it does NOT carry.
const zaxe = compareScrapedToBaseline({ name: "Zaxe X4 3D Yazıcı" }, index);
assert.ok(["match", "hold"].includes(zaxe.status), "a maker the baseline carries resolves to a row");
const outsider = compareScrapedToBaseline({ name: "Acme XY-900 3D Yazıcı" }, index);
assert.equal(outsider.status, "unknown", "a maker outside the baseline does not invent a row");

const unknownModel = compareScrapedToBaseline({ name: "Bambu Lab ZX9000 Quantum Combo" }, index);
assert.equal(unknownModel.status, "unknown", "a model the baseline does not hold is not guessed at");

// --- noise-only differences are the same product ----------------------------------
const plain = compareScrapedToBaseline({ name: "Elegoo Neptune 4 Pro 3D Yazıcı" }, index);
const noisy = compareScrapedToBaseline({ name: "Elegoo Neptune 4 Pro 3D Yazıcı Kargo Bedava Hediyeli" }, index);
assert.equal(plain.identityId, noisy.identityId, "marketing noise is not identity");

// --- the report is evidence, not a decision ---------------------------------------
assert.ok(!("merge" in en), "the report never carries a merge instruction");
assert.ok(!("price" in en), "the baseline is identity, never price truth");
assert.ok(en.source === "official" || en.source === "trusted-tracker", "the row records its source");
assert.equal(en.matchedRow.modelCore, "p1s", "a match names the row it matched");

// --- PERFORMANCE: the assertion that was missing -----------------------------------
// /api/hunt runs a full comparison pass on EVERY KEYSTROKE. When this loop got slow the function
// blew past Netlify's 30s limit, /api/hunt returned 502, and the storefront search went blank while
// every other test still passed. So the budget is asserted here, not discovered in production.
const titles = rows.slice(0, 400).map((r) => "Bambu Lab " + r.modelCore + " Combo 3D Yazıcı");
const started = Date.now();
for (const t of titles) compareScrapedToBaseline({ name: t }, index);
const elapsed = Date.now() - started;
const perCall = elapsed / titles.length;
assert.ok(
  elapsed < 2000,
  titles.length + " comparisons took " + elapsed + "ms (" + perCall.toFixed(2) + "ms each) — the request path cannot afford this"
);
// The cache is what makes the repeat rate cheap; a cold cache is the real cost, so report both.
const coldStarted = Date.now();
normalize.normalize("Some Brand New Title Nobody Has Seen " + Math.random(), { locale: "tr" });
const cold = Date.now() - coldStarted;
assert.ok(cold < 200, "a cold normalize call must stay well under the request budget, took " + cold + "ms");

console.log("PASS: EN/TR share an identity, prefix collisions split, combo vs bare hard-splits, unknown and")
console.log("      compatibility hold, noise is not identity, and " + titles.length + " comparisons run in " +
  elapsed + "ms (" + perCall.toFixed(2) + "ms each) with a " + cold + "ms cold normalise.");
