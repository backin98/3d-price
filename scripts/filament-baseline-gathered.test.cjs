"use strict";

// Guards data/filament-baseline.json: the card is the colour-agnostic filament model, colours hang
// under it as gathered features, and each colour's child SKU carries the sellable axes. Every
// claim in the file has to be re-derivable from the listing it cites, or it does not belong there.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { classifyFilament, coloursFromName } = require("../api/filament-classify");
const { sanitizeBoard, asMatchProducts } = require("../lib/baseline-board.cjs");
const TAXONOMY = require("../data/filament-taxonomy.json");

const ROOT = path.join(__dirname, "..");
const baseline = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "filament-baseline.json"), "utf8"));
const families = baseline.items.filter((row) => row.entityType === "family");
const skus = baseline.items.filter((row) => row.entityType === "sku");

assert.equal(baseline.schemaVersion, 1);
assert.equal(baseline.kind, "filament-baseline");
assert.ok(baseline.source.listingsWithPolymer > 0, "the baseline must be mined from real listings");
assert.ok(families.length >= 100, "expected the scraped corpus to yield many cards, got " + families.length);
assert.ok(skus.length >= families.length, "every card should own at least one spool child");

const ids = new Set();
for (const row of baseline.items) {
  assert.ok(!ids.has(row.id), "duplicate item id " + row.id);
  ids.add(row.id);
}

// --- the card is colour-agnostic -------------------------------------------------------------

const colourAliases = Object.entries(TAXONOMY.colours).flatMap(([id, row]) =>
  (row.aliases || []).map((alias) => ({ id, phrase: alias.toLowerCase() })));

for (const family of families) {
  assert.equal(family.category, "filaments");
  assert.equal(family.kind, "filament");
  assert.ok(family.polymer, family.id + " has no polymer, so it is not a filament model");
  assert.equal(family.familyKey, [family.brand.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-"), family.polymer, family.variant, family.diameter].join("|").replace(/-+/g, "-"),
    family.id + ": familyKey must be brand | polymer | variant | diameter");
  assert.ok(family.familyKey.includes("|" + family.polymer + "|"), family.id + ": polymer is a card axis");
  assert.ok(family.familyKey.endsWith("|" + family.diameter), family.id + ": diameter is a card axis");

  const text = (family.id + " " + family.name).toLowerCase();
  for (const { id, phrase } of colourAliases) {
    const tokens = phrase.split(/\s+/).filter(Boolean);
    if (!tokens.length || !tokens.every((token) => new RegExp("(^|[^a-z0-9])" + token + "($|[^a-z0-9])").test(text))) continue;
    // "Wood", "Rainbow" and "Gradient" name a material variant, not the spool colour.
    if (family.variant && phrase.includes(family.variant.replace(/-/g, " "))) continue;
    assert.fail(family.id + " leaks the colour " + id + " into the card itself");
  }
}

// Colour evidence is always gathered, never suggested or invented at family level.
for (const family of families) {
  for (const colour of family.colours) {
    assert.equal(colour.source, "gathered", family.id + "/" + colour.id + ": only gathered colours belong in the baseline");
    assert.equal(colour.hex, (TAXONOMY.colours[colour.id] || {}).hex, family.id + "/" + colour.id + ": hex must come from the taxonomy");
    assert.equal(colour.name, (TAXONOMY.colours[colour.id] || {}).name, family.id + "/" + colour.id + ": name must come from the taxonomy");
    assert.ok(colour.seenCount >= 1 && colour.seenIn.length >= 1, family.id + "/" + colour.id + ": a colour without a listing is a suggestion, not a fact");
    for (const seen of colour.seenIn) {
      const again = classifyFilament({ name: seen.name, brand: family.brand });
      assert.ok(again.familyKey === family.familyKey
        || (again.diameter === "" && family.diameter && again.familyKey === family.familyKey.replace("|" + family.diameter, "|")),
      family.id + "/" + colour.id + ": evidence " + JSON.stringify(seen.name) + " does not classify to this card (" + again.familyKey + ")");
      assert.ok(coloursFromName(seen.name).includes(colour.id),
        family.id + "/" + colour.id + ": " + JSON.stringify(seen.name) + " never states that colour");
    }
  }
}

// The diameter fold may only be used where one diameter is genuinely the only candidate: a card
// with no diameter must never sit beside a single known diameter of the same brand+polymer+variant.
const byBase = new Map();
for (const family of families) {
  const base = [family.brand.toLowerCase(), family.polymer, family.variant].join("|");
  if (!byBase.has(base)) byBase.set(base, []);
  byBase.get(base).push(family);
}
for (const [base, group] of byBase) {
  const known = new Set(group.map((family) => family.diameter).filter(Boolean));
  const open = group.filter((family) => !family.diameter);
  if (open.length) {
    assert.notEqual(known.size, 1, base + ": a card without a diameter cannot sit beside exactly one known diameter (fold missed it)");
  }
}

// --- the child spool carries the sellable axes ------------------------------------------------
for (const sku of skus) {
  const parent = families.find((family) => family.id === sku.parentId);
  assert.ok(parent, sku.id + " has no card");
  assert.ok(sku.id.startsWith(parent.id + "/"), sku.id + " must sit under " + parent.id);
  assert.equal(parent.polymer, sku.polymer);
  assert.equal(parent.variant, sku.variant);
  assert.equal(parent.diameter, sku.diameter);
  if (sku.color) {
    assert.ok(parent.colours.some((colour) => colour.id === sku.color),
      sku.id + ": " + sku.color + " is not one of the card's gathered colours");
  }
  if (sku.weight) assert.match(sku.weight, /^\d+ g$/, sku.id + ": weight stays in the taxonomy's unit");
  if (sku.packaging) assert.ok(TAXONOMY.packaging[sku.packaging], sku.id + ": unknown packaging " + sku.packaging);
  assert.ok(sku.seenIn.length >= 1, sku.id + ": a spool without a listing is invented");
}

for (const family of families) {
  assert.ok(skus.some((sku) => sku.parentId === family.id), family.id + " has no child SKU for an offer to land on");
}

// --- it is a baseline ------------------------------------------------------------------------
const board = sanitizeBoard({ items: baseline.items });
const matchPool = asMatchProducts(board, "filament");
assert.equal(matchPool.length, skus.length, "families never receive scraped offers");
assert.ok(matchPool.every((row) => row.polymer), "every match candidate keeps its card axes");
assert.ok(board.items.every((row) => row.offers === undefined), "baseline strips retailer offers");

// --- and it is reproducible ------------------------------------------------------------------
execFileSync(process.execPath, [path.join(__dirname, "build-filament-baseline.cjs"), "--check"], { stdio: "pipe" });

const colours = new Set(families.flatMap((family) => family.colours.map((colour) => colour.id)));
console.log(`PASS: filament baseline, ${families.length} colour-agnostic cards, ${skus.length} spool SKUs, ${colours.size} gathered colours from ${baseline.source.shops.length} shops`);
