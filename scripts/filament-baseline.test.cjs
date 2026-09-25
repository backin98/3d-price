"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { classifyFilament } = require("../api/filament-classify");
const { identity, conflicts, decidePair } = require("../lib/product-match.cjs");
const { sanitizeBoard, asMatchProducts } = require("../lib/baseline-board.cjs");

const plain = classifyFilament({ name: "Acme PLA Siyah", brand: "Acme" });
assert.deepEqual([plain.variant, plain.weight, plain.diameter, plain.packaging], ["", "", "", ""], "missing axes stay unknown");

const plus = classifyFilament({ name: "eSUN PLA-Plus Siyah 1,0 kg 1,75mm Makarasız", brand: "eSUN" });
assert.deepEqual([plus.polymer, plus.variant, plus.color, plus.weight, plus.diameter, plus.packaging], ["pla", "plus", "black", "1000 g", "1.75 mm", "refill"]);
const fastPlus = classifyFilament({ name: "Porima Hyper PLA+ Kırmızı 1000gr", brand: "Porima" });
assert.equal(fastPlus.variant, "plus-high-speed");
assert.equal(classifyFilament({ name: "PLA Army Khaki Green 1kg", brand: "Acme" }).color, "khaki-green");
assert.equal(classifyFilament({ name: "PLA Pastel Pembe 750g", brand: "Acme" }).color, "pastel-pink");
assert.equal(classifyFilament({ name: "PLA Silk Rapid CF 1.75mm", brand: "Acme" }).color, "", "functional terms never leak into colour");
assert.equal(classifyFilament({ name: "Vakumlu Filament Saklama Poşeti", brand: "Acme" }).classificationRejected, true);
assert.equal(classifyFilament({ name: "Standard Resin Black 1kg", brand: "Acme" }).productForm, "resin");
assert.notEqual(plus.familyKey, classifyFilament({ name: "eSUN PLA-Plus Siyah 1kg 2.85mm Makarasız", brand: "eSUN" }).familyKey, "diameter is a family axis");
assert.notEqual(plus.compareKey, classifyFilament({ name: "eSUN PLA-Plus Beyaz 1kg 1.75mm Makarasız", brand: "eSUN" }).compareKey, "colour is a child axis");

const complete = (overrides = {}) => ({ name: "Acme Standard PLA Black 1000g 1.75mm Spool", brand: "Acme", kind: "filament", ...overrides });
for (const [axis, left, right] of [
  ["polymer", { polymer: "pla" }, { polymer: "petg" }],
  ["variant", { variant: "standard" }, { variant: "silk" }],
  ["color", { color: "black" }, { color: "white" }],
  ["weight", { weight: "1000 g" }, { weight: "750 g" }],
  ["diameter", { diameter: "1.75 mm" }, { diameter: "2.85 mm" }],
  ["packaging", { packaging: "spool" }, { packaging: "refill" }]
]) {
  const found = conflicts(identity(complete(left)), identity(complete(right)));
  assert.ok(found.includes(axis), axis + " must be a hard conflict: " + found.join(","));
}
assert.equal(decidePair(
  { name: "eSUN PLA+ Siyah 1KG 1.75mm Makarasız", brand: "eSUN", kind: "filament" },
  { id: "same", name: "eSUN PLA Plus Black 1000 gr 1,75 mm Refill", brand: "eSUN", kind: "filament" }
).action, "merge");

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "filament-parent-child.fixtures.json"), "utf8"));
const board = sanitizeBoard(fixture.baseline);
const families = board.items.filter((row) => row.entityType === "family");
const skus = board.items.filter((row) => row.entityType === "sku");
assert.ok(families.length >= 3 && skus.length >= 4);
assert.equal(asMatchProducts(board, "filament").length, skus.length, "families never receive scraped offers");
assert.ok(asMatchProducts(board, "filament").every((row) => row.parentId === undefined && row.polymer));
assert.ok(board.items.every((row) => row.offers === undefined), "baseline strips retailer offers");

const laya = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "laya-filament-pairs.json"), "utf8")).pairs;
assert.ok(laya.length >= 50, "need at least 50 filament pairs");
assert.ok(laya.some((row) => row.label === "same"));
for (const axis of ["polymer", "variant", "colour", "weight", "diameter", "packaging", "product-form"]) {
  assert.ok(laya.some((row) => row.label === "different" && row.axis === axis), "missing Laya hard negatives for " + axis);
}

const evidence = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "filament-storefront-evidence.json"), "utf8")).rows;
const required = "shop platform categoryUrl productCount paginationType paginationControl backgroundEndpoint productCardBoundary productUrlSource titleSource brandSource polymerSource variantSource colourSource weightSource diameterSource packagingSource priceSource stockSource imageSource variantUrlBehavior preorderBehavior knownTraps sampleEvidence".split(" ");
for (const row of evidence) for (const field of required) assert.ok(Object.hasOwn(row, field), row.shop + " lacks " + field);
for (const platform of ["IdeaSoft", "Ticimax", "T-Soft", "WooCommerce", "OpenCart", "Shopify", "Custom SPA / Bixcod"]) {
  assert.ok(evidence.some((row) => row.platform === platform), "missing platform evidence: " + platform);
}

console.log(`PASS: filament taxonomy, ${families.length} families/${skus.length} SKUs, ${laya.length} Laya pairs, ${evidence.length} storefronts`);
