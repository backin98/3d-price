#!/usr/bin/env node
"use strict";

// Build data/filament-baseline.json out of the listings we already scraped.
//
// The card is the filament MODEL, never a colour: brand + polymer + material variant + diameter.
// Colours are features *under* the card, so one card ("eSUN Basic PLA 1.75 mm") carries every
// spool colour we have evidence for, and each colour's child SKU carries the actual sellable
// axes (colour + net weight + packaging). That is the same split api/filament-classify.js already
// draws with familyKey (colour-agnostic) and compareKey (the spool).
//
// Nothing here is invented. Every family, colour and SKU is grouped from real listing evidence
// that is committed to the repo: docs/real-listings.jsonl (scripts/mine-listings.cjs folds the
// run outputs on a PC into it) and the tracked JSON under data/ and work/. A colour with no listing
// behind it simply does not exist. Absent axes stay absent, per the taxonomy's unknownRule.
//
// Committed evidence only: untracked run outputs (data/qwen-url-jobs, data/qwen-employee) and the
// live store (work/local-store, data/online-catalog.json) change on every shop run, so reading them
// made the file "stale" after any run and --check disagree between two machines on the same commit.
// To add evidence, run scripts/mine-listings.cjs and commit docs/real-listings.jsonl.
//
//   node scripts/build-filament-baseline.cjs          # write the file when the content changed
//   node scripts/build-filament-baseline.cjs --check   # exit 1 when the file is stale
//
// Re-running is stable: identical listings produce an identical file, and generatedAt only moves
// when the mined content does. No network, no model.

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { classifyFilament, coloursFromName, canonicalColour } = require("../api/filament-classify");
const TAXONOMY = require("../data/filament-taxonomy.json");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "data", "filament-baseline.json");
const EVIDENCE_CAP = 3;

const SKIP_DIRS = new Set(["node_modules", ".git", ".netlify", "graphify-out", ".venv-laya", "backups"]);
// Baseline outputs are derived artifacts, not new shop evidence. Once the filament
// rows are wired into the live baseline they must not feed themselves back into the
// next build and make the generated file drift forever.
const SKIP_FILES = new Set([
  path.join("data", "filament-baseline.json"),
  path.join("data", "online-baseline.json"),
  path.join("work", "local-store", "baseline.json")
]);

const fold = (value) => String(value || "").toLocaleLowerCase("tr")
  .replace(/ı/g, "i").replace(/ş/g, "s").replace(/ç/g, "c")
  .replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ö/g, "o")
  .replace(/\+/g, " plus ").replace(/_/g, " ")
  .replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();

// "https://shop/creality-ender-pla-filament-green" -> "creality ender pla filament green"
const urlWords = (url) => {
  let p = "";
  try { p = decodeURIComponent(new URL(String(url || "")).pathname); } catch { return ""; }
  return p.replace(/[-_/.]+/g, " ").trim();
};

const isRealName = (value) => {
  const s = String(value || "").trim();
  return s.length > 3 && !/^(n\/?a|none|null|unknown|-+)$/i.test(s);
};

// ---------------------------------------------------------------- evidence on disk

function jsonFiles(dir, acc = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) jsonFiles(full, acc);
      continue;
    }
    if (SKIP_FILES.has(path.relative(ROOT, full))) continue;
    const lower = entry.name.toLowerCase();
    if (lower.endsWith(".json") || lower.endsWith(".jsonl")) acc.push(full);
  }
  return acc;
}

// Any object carrying a name/title is a candidate listing, whatever shape its file uses.
function collect(node, file, out, depth = 0) {
  if (depth > 12 || node === null || node === undefined) return;
  if (Array.isArray(node)) { for (const value of node) collect(value, file, out, depth + 1); return; }
  if (typeof node !== "object") return;
  const name = node.name || node.title || node.listingName;
  if (typeof name === "string" && name.trim()) {
    out.push({
      name: name.trim(),
      brand: String(node.brand || node.unit || "").trim(),
      shop: String(node.source || node.shop || node.store || node.site || node.sourceId || "").trim(),
      url: String(node.url || node.link || node.href || "").trim(),
      image: String(node.image || node.img || "").trim(),
      color: String(node.color || "").trim(),
      file
    });
  }
  for (const value of Object.values(node)) {
    if (value && typeof value === "object") collect(value, file, out, depth + 1);
  }
}

// Runtime state, rewritten by the local host and the worker on every run: never evidence.
const VOLATILE = /^(?:work[\\/]local-store[\\/]|data[\\/](?:online-catalog\.json$|qwen-url-jobs[\\/]|qwen-employee[\\/]))/;

function committed(files) {
  let tracked;
  try {
    tracked = new Set(execFileSync("git", ["ls-files", "-z", "--", "data", "work"], { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] })
      .toString().split("\0").filter(Boolean).map((f) => path.join(ROOT, f)));
  } catch {
    tracked = null; // not a git checkout (a zip download): the VOLATILE rule alone keeps it stable
  }
  return files.filter((f) => (!tracked || tracked.has(f)) && !VOLATILE.test(path.relative(ROOT, f)));
}

function readEvidence() {
  const files = committed([...jsonFiles(path.join(ROOT, "data")), ...jsonFiles(path.join(ROOT, "work"))]).sort();
  const jsonl = path.join(ROOT, "docs", "real-listings.jsonl");
  if (fs.existsSync(jsonl)) files.push(jsonl);

  const raw = [];
  for (const file of files) {
    const rel = path.relative(ROOT, file);
    if (rel === path.join("docs", "real-listings.jsonl")) {
      for (const line of fs.readFileSync(file, "utf8").split("\n")) {
        if (!line.trim()) continue;
        try { collect(JSON.parse(line), rel, raw); } catch { /* not a record */ }
      }
      continue;
    }
    let text;
    try { text = fs.readFileSync(file, "utf8"); } catch { continue; }
    if (text.length > 40 * 1024 * 1024) continue;
    try { collect(JSON.parse(text), rel, raw); } catch { /* not listing JSON */ }
  }
  return { raw, files: files.map((f) => path.relative(ROOT, f)) };
}

// ---------------------------------------------------------------- brand vocabulary

// Run files sometimes park a whole product slug ("creality-cr-pla-gri-filament-1-75mm-1kg") in the
// brand field, and a slug like that would become a card all by itself. A brand is one to three
// words and never a material: anything else is dropped and the title decides instead.
const MATERIAL_WORDS = new Set([
  ...Object.keys(TAXONOMY.polymers), ...Object.keys(TAXONOMY.variants),
  ...Object.keys(TAXONOMY.colours), "filament", "filamentler", "filamentleri"
]);

function looksLikeBrand(value) {
  const brand = String(value || "").trim();
  if (/^(n\/?a|unknown|bilinmiyor|yok|other|diğer|diger|none|null|-+)$/i.test(brand)) return false;
  if (brand.length < 2 || brand.length > 25) return false;
  const words = fold(brand).split(" ").filter(Boolean);
  if (!words.length || words.length > 3) return false;
  return !words.some((word) => MATERIAL_WORDS.has(word));
}

// Brands are learned from the same corpus (plus the bundled printer import, because these shops
// sell both aisles). Nothing is hard-coded, so a shop we start scraping tomorrow teaches its brand.
function brandVocabulary(listings) {
  const spelling = new Map();
  const add = (value) => {
    const brand = String(value || "").trim();
    if (!looksLikeBrand(brand)) return;
    const key = fold(brand).replace(/\s+/g, "-");
    if (!key) return;
    const seen = spelling.get(key) || new Map();
    seen.set(brand, (seen.get(brand) || 0) + 1);
    spelling.set(key, seen);
  };
  for (const listing of listings) add(listing.brand);
  try {
    for (const product of require("../data/v001-printers.json").products || []) add(product.brand);
  } catch { /* optional seed */ }
  try {
    for (const item of require("../work/local-store/baseline.json").items || []) add(item.brand);
  } catch { /* optional seed */ }
  return { spelling, aliases: [...spelling.entries()].map(([key, seen]) => ({ key, phrase: fold(key.replace(/-/g, " ")) })).sort((a, b) => b.phrase.length - a.phrase.length) };
}

// Shops write the same brand in every case ("bambu lab", "Bambu Lab", "ELEGOO"). Prefer the
// spelling that carries case — mixed case first, then all caps, then lowercase — and let the
// frequency decide between equally cased spellings, so "eSUN" and "eSun" land on one card name.
const caseScore = (spelling) => {
  const hasLower = /[a-zçğıöşü]/.test(spelling);
  const hasUpper = /[A-ZÇĞİÖŞÜ]/.test(spelling);
  return hasLower && hasUpper ? 2 : hasUpper ? 1 : 0;
};

function canonicalBrand(vocab, value) {
  const key = fold(value).replace(/\s+/g, "-");
  if (!key) return "";
  const seen = vocab.spelling.get(key);
  if (!seen) return String(value || "").trim();
  return [...seen.entries()]
    .sort((a, b) => caseScore(b[0]) - caseScore(a[0]) || b[1] - a[1] || a[0].length - b[0].length || a[0].localeCompare(b[0]))[0][0];
}

// A listing that never carried a brand field still names its brand in the title.
function brandFromTitle(vocab, name) {
  const text = " " + fold(name) + " ";
  for (const { phrase } of vocab.aliases) {
    if (phrase && text.includes(" " + phrase + " ")) return phrase;
  }
  return "";
}

// ---------------------------------------------------------------- grouping

// The display label of an axis: the alias that IS the id ("PLA", "Translucent") when the taxonomy
// has one, otherwise the shortest plain-ASCII alias, so card names stay English and never pick up a
// Turkish synonym that happens to read like a colour ("Seffaf" for transparent).
const AXIS_LABEL = (group, id) => {
  const row = (TAXONOMY[group] || {})[id];
  if (!row) return id;
  const aliases = row.aliases || [];
  const target = fold(id);
  const equal = aliases.find((alias) => fold(alias) === target);
  if (equal) return equal;
  const ascii = aliases.filter((alias) => /^[\x20-\x7e]+$/.test(alias));
  const pool = ascii.length ? ascii : aliases;
  return [...pool].sort((a, b) => a.length - b.length || a.localeCompare(b))[0] || id;
};

function slug(value) {
  return fold(value).replace(/\s+/g, "-").replace(/^-+|-+$/g, "");
}

function isEmptyAxis(value) {
  return !value || /^(unknown|yok|n\/?a)$/i.test(String(value));
}

function mine() {
  const { raw, files } = readEvidence();
  // Run outputs nest the same listing many times over (a card inside an event inside a job). Collapse
  // them to one row per shop/URL before anything is classified, so a repeated listing cannot look
  // like several shops agreeing on an axis.
  const byIdentity = new Map();
  for (const node of raw) {
    const key = [fold(node.name), fold(node.brand), fold(node.shop || node.url)].join("|");
    if (!byIdentity.has(key)) byIdentity.set(key, node);
  }
  const nodes = [...byIdentity.values()];
  const vocab = brandVocabulary(nodes);
  const cache = new Map();

  const listings = [];
  for (const node of nodes) {
    if (!isRealName(node.name) || /^https?:\/\//i.test(node.name)) continue;
    const brand = looksLikeBrand(node.brand) ? canonicalBrand(vocab, node.brand) : "";
    const resolved = brand || canonicalBrand(vocab, brandFromTitle(vocab, node.name));
    const key = fold(node.name) + "|" + fold(resolved);
    let classified = cache.get(key);
    if (!classified) {
      classified = classifyFilament({ name: node.name, brand: resolved });
      cache.set(key, classified);
    }
    // A family card needs the family axis and a real filament behind it: dryers, resin, storage
    // bags and theme words ("Filament") are not filament models and never open a card.
    if (classified.productForm !== "filament" || !classified.polymer) continue;
    const colours = new Set(coloursFromName(node.name));
    // A stored colour counts only when the listing itself says it (title or URL slug): a run may
    // have guessed it from the photo's pixels, and a guess is a suggestion, not gathered evidence.
    const stored = canonicalColour(node.color);
    if (stored && coloursFromName(node.name + " " + urlWords(node.url)).includes(stored)) colours.add(stored);
    listings.push({
      name: node.name,
      brand: resolved,
      // An empty brand key keeps the classifier's own familyKey shape ("|pla|high-speed|1.75 mm"), so a
      // scraped listing without brand evidence still lands on the card it belongs to.
      brandKey: fold(resolved).replace(/\s+/g, "-"),
      polymer: classified.polymer,
      variant: classified.variant,
      diameter: classified.diameter,
      weight: classified.weight,
      packaging: classified.packaging,
      colours: [...colours].sort(),
      shop: node.shop,
      url: node.url,
      image: /^https?:\/\//i.test(node.image) ? node.image : "",
      file: node.file
    });
  }

  // One listing appears in several run outputs; keep the copy that knows the most, deterministically.
  const byKey = new Map();
  const richness = (row) => [row.diameter, row.weight, row.packaging, row.colours.length ? "c" : "", row.image, row.url].filter(Boolean).length;
  for (const row of listings) {
    const key = row.url ? fold(row.url) : fold(row.shop) + "|" + fold(row.name);
    const old = byKey.get(key);
    if (!old || richness(row) > richness(old)) byKey.set(key, row);
  }
  const deduped = [...byKey.values()];

  // Diameter is a family axis, but shops drop it from titles often (621 of 1400 rows). When every
  // listing of a brand+polymer+variant agrees on one diameter, the silent ones belong to it; when
  // two diameters are genuinely in play we will not guess, and they keep an empty diameter.
  const base = new Map();
  for (const row of deduped) {
    const key = [row.brandKey, row.polymer, row.variant].join("|");
    if (!base.has(key)) base.set(key, []);
    base.get(key).push(row);
  }
  for (const rows of base.values()) {
    const known = [...new Set(rows.map((row) => row.diameter).filter((d) => !isEmptyAxis(d)))];
    if (known.length !== 1) continue;
    for (const row of rows) if (isEmptyAxis(row.diameter)) row.diameter = known[0];
  }

  const families = new Map();
  for (const row of deduped) {
    const familyKey = [row.brandKey, row.polymer, row.variant, row.diameter].join("|");
    if (!families.has(familyKey)) families.set(familyKey, { key: familyKey, rows: [] });
    families.get(familyKey).rows.push(row);
  }

  const items = [];
  for (const { key, rows } of families.values()) {
    const first = rows[0];
    const brand = canonicalBrand(vocab, first.brand) || first.brand;
    const diameterSlug = isEmptyAxis(first.diameter) ? "unknown" : first.diameter.replace(/\s*mm$/i, "");
    const core = [first.variant, first.polymer].filter(Boolean).join("-");
    const id = ["filament", first.brandKey || "unknown", slug(core), diameterSlug].join("/");
    const label = [brand, AXIS_LABEL("variants", first.variant), AXIS_LABEL("polymers", first.polymer), first.diameter]
      .filter(Boolean).join(" ");

    const images = new Map();
    for (const row of rows) if (row.image) images.set(row.image, (images.get(row.image) || 0) + 1);

    const colours = new Map();
    for (const row of rows) {
      for (const colourId of row.colours) {
        if (!colours.has(colourId)) colours.set(colourId, { seen: 0, evidence: new Map() });
        const entry = colours.get(colourId);
        entry.seen += 1;
        const evidenceKey = (row.shop || "?") + "|" + row.name;
        if (!entry.evidence.has(evidenceKey)) entry.evidence.set(evidenceKey, { shop: row.shop, name: row.name, url: row.url });
      }
    }

    const weights = new Map();
    for (const row of rows) {
      const colourIds = row.colours.length ? row.colours : [""];
      for (const colourId of colourIds) {
        const skuKey = [colourId || "unknown", row.weight, row.packaging].join("|");
        if (!weights.has(skuKey)) weights.set(skuKey, { colourId, weight: row.weight, packaging: row.packaging, seen: 0, evidence: new Map() });
        const entry = weights.get(skuKey);
        entry.seen += 1;
        entry.evidence.set(row.shop + "|" + row.name, { shop: row.shop, name: row.name, url: row.url });
      }
    }

    items.push({
      id,
      entityType: "family",
      kind: "filament",
      category: "filaments",
      name: label,
      brand,
      polymer: first.polymer,
      variant: first.variant,
      diameter: first.diameter,
      familyKey: key,
      // Filament thumbnails belong to the current shop offer. A scraped image
      // must win so a stale colour/variant image never becomes the family image.
      image: "",
      listingCount: rows.length,
      shops: [...new Set(rows.map((row) => row.shop).filter(Boolean))].sort(),
      colours: [...colours.entries()]
        .map(([colourId, entry]) => ({
          id: colourId,
          name: (TAXONOMY.colours[colourId] || {}).name || colourId,
          hex: (TAXONOMY.colours[colourId] || {}).hex || "",
          parent: (TAXONOMY.colours[colourId] || {}).parent || "",
          source: "gathered",
          seenCount: entry.seen,
          seenIn: [...entry.evidence.values()].sort((a, b) => (a.shop + a.name).localeCompare(b.shop + b.name)).slice(0, EVIDENCE_CAP)
        }))
        .sort((a, b) => b.seenCount - a.seenCount || a.id.localeCompare(b.id))
    });

    // The colour features above are the card's menu; these children are the spools an offer can
    // land on, so each keeps only the axes its own listing proved.
    for (const entry of weights.values()) {
      const grams = entry.weight ? String(parseInt(entry.weight, 10) || entry.weight.replace(/\s+/g, "")) : "";
      const parts = [id, entry.colourId || "unknown", grams, entry.packaging].filter(Boolean);
      const colourName = entry.colourId ? (TAXONOMY.colours[entry.colourId] || {}).name || entry.colourId : "";
      items.push({
        id: parts.join("/"),
        entityType: "sku",
        kind: "filament",
        category: "filaments",
        parentId: id,
        name: [label, colourName, entry.weight, entry.packaging].filter(Boolean).join(" "),
        brand,
        polymer: first.polymer,
        variant: first.variant,
        diameter: first.diameter,
        color: entry.colourId,
        weight: entry.weight,
        packaging: entry.packaging,
        productForm: "filament",
        seenCount: entry.seen,
        seenIn: [...entry.evidence.values()].sort((a, b) => (a.shop + a.name).localeCompare(b.shop + b.name)).slice(0, EVIDENCE_CAP)
      });
    }
  }
  items.sort((a, b) => a.id.localeCompare(b.id) || a.entityType.localeCompare(b.entityType));

  return {
    items,
    source: {
      nameNodesSeen: raw.length,
      distinctListings: nodes.length,
      listingsWithPolymer: deduped.length,
      filesScanned: files.length,
      shops: [...new Set(deduped.map((row) => row.shop).filter(Boolean))].sort()
    }
  };
}

function payload(items, source, generatedAt) {
  return {
    schemaVersion: 1,
    kind: "filament-baseline",
    generator: "scripts/build-filament-baseline.cjs",
    rules: {
      card: "brand + polymer + material variant + diameter (familyKey) - colour-agnostic",
      colour: "a feature under its card, populated only from listing evidence (source: gathered)",
      sku: "family + colour + net weight + packaging (only the axes the listing proved)",
      diameterFold: "a listing that omits the diameter joins its brand+polymer+variant card when that card has exactly one known diameter",
      unknown: TAXONOMY.unknownRule
    },
    generatedAt,
    source,
    categories: [{ id: "printers", name: "3D Printers" }, { id: "filaments", name: "Filament" }],
    items
  };
}

function main() {
  const check = process.argv.includes("--check");
  const { items, source } = mine();
  const families = items.filter((row) => row.entityType === "family");
  const skus = items.filter((row) => row.entityType === "sku");
  const colours = new Set(families.flatMap((row) => row.colours.map((c) => c.id)));

  let previous = null;
  try { previous = JSON.parse(fs.readFileSync(OUT, "utf8")); } catch { /* first run */ }
  const unchanged = previous && JSON.stringify(previous.items) === JSON.stringify(items);
  const next = payload(items, source, unchanged && previous.generatedAt ? previous.generatedAt : new Date().toISOString());
  const text = JSON.stringify(next, null, 2) + "\n";
  const current = previous ? JSON.stringify(previous, null, 2) + "\n" : "";

  if (check) {
    if (text !== current) {
      console.error("FAIL: data/filament-baseline.json is stale - run node scripts/build-filament-baseline.cjs");
      process.exit(1);
    }
    console.log(`OK: filament baseline is current - ${families.length} cards, ${skus.length} SKUs, ${colours.size} colours`);
    return;
  }
  if (text === current) {
    console.log(`unchanged: ${families.length} cards, ${skus.length} SKUs, ${colours.size} colours`);
    return;
  }
  fs.writeFileSync(OUT, text);
  console.log(`wrote data/filament-baseline.json from ${source.listingsWithPolymer} listings`);
  console.log(`${families.length} filament cards, ${skus.length} colour SKUs, ${colours.size} distinct colours`);
  console.log(`shops: ${source.shops.join(", ")}`);
  console.log("cards by brand:");
  const byBrand = {};
  for (const family of families) byBrand[family.brand] = (byBrand[family.brand] || 0) + 1;
  for (const [brand, n] of Object.entries(byBrand).sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`   ${n}  ${brand}`);
}

if (require.main === module) main();

module.exports = { mine, payload, canonicalBrand, brandVocabulary, readEvidence, fold, OUT };
