"use strict";

// Generates data/baseline-catalog.json.
//
// The spec asks for a baseline catalog as data. It already half-exists: lib/catalog-index.cjs holds
// the brand/model/feeder reference (25 brands, 217 model aliases) and the axis functions. What is
// missing is the baseline LAYER on top — one row per identity, each tagged with where it came from
// and how much it can be trusted.
//
// So this script derives rows from the reference instead of restating it. Hand-copying 217 models
// into a second file would guarantee the two drift apart, and a baseline that disagrees with the
// matcher is worse than no baseline at all.
//
//   official        — from catalog-index.cjs (the published brand/model reference)
//   trusted-tracker — the Aurora FDM/resin SKU lists in the prompt (Part B1/B2)
//
// Run: node scripts/build-baseline-catalog.cjs

const fs = require("node:fs");
const path = require("node:path");
const idx = require("../lib/catalog-index.cjs");
const baseline = require("../lib/baseline-catalog.js");

const OUT = path.join(__dirname, "..", "data", "baseline-catalog.json");

// Part B1/B2 of the prompt, verbatim. Every pack is its own identity when combo/AMS/kit differs,
// which is why "A1" and "A1 AMS Lite" are two entries and not one with a note.
const TRACKER = {
  anycubic: {
    fdm: ["Kobra 2 Max", "Kobra 3 Max Combo", "Kobra 4", "Kobra S1 Combo", "Kobra X"],
    resin: ["Photon D2", "Photon M3 Max", "Photon Mono 2", "Photon Mono M5", "Photon Mono M5S", "Photon Mono M5S Pro"]
  },
  bambu: {
    fdm: ["A1", "A1 AMS Lite", "A1 Mini", "A1 Mini AMS Lite", "A2L", "H2C AMS", "H2D AMS", "H2S AMS", "P1S AMS", "P2S", "P2S AMS", "X2D AMS"],
    resin: []
  },
  comgrow: { fdm: ["T300", "T500"], resin: [] },
  creality: {
    fdm: ["Ender-3 V3 KE", "Ender-3 V3 PLUS", "Ender-3 V3 SE", "Ender-3 V4", "Ender-5 Max", "HI Combo", "K1", "K1 Max", "K1C", "K2 PLUS", "K2 Pro", "SPARKX i7"],
    resin: []
  },
  elegoo: {
    fdm: ["Centauri Carbon", "Centauri Carbon 2 Combo", "Neptune 3 Max", "Neptune 3 Plus", "Neptune 3 Pro", "Neptune 4", "Neptune 4 Max", "Neptune 4 Plus", "Neptune 4 Pro", "OrangeStorm Giga"],
    resin: ["Jupiter SE", "Mars 4 9K", "Mars 4 DLP", "Mars 4 Ultra 9K", "Saturn 2 8K", "Saturn 3 12K", "Saturn 3 Ultra 12K", "Saturn 4 Ultra", "Saturn 4 Ultra 16K"]
  },
  flashforge: { fdm: ["AD5X", "Adventurer 5M", "Adventurer 5M Pro", "Creator 5"], resin: [] },
  infimech: { fdm: ["TX"], resin: [] },
  prusa: {
    fdm: ["Core One Assembled", "Core One Kit", "Core One L Assembled", "MK4S Assembled", "MK4S Kit", "Mini Plus Enclosure Bundle", "XL"],
    resin: []
  },
  qidi: { fdm: ["MAX4", "PLUS 4", "Q1 Pro", "Q2", "Q2C", "X-MAX-3"], resin: [] },
  snapmaker: { fdm: ["J1S", "U1"], resin: [] },
  sovol: { fdm: ["SV06", "SV06 Ace", "SV06 Plus Ace", "SV08", "Zero"], resin: [] }
};

// Resin lines hard-split on class, and the tracker names them differently from the shops
// ("Mono M5S Pro" vs "Photon Mono M5s Pro"), so the raw SKU is kept as an alias too.
const RESIN_TECHNOLOGY = "resin";

function rowsFromTracker() {
  const rows = [];
  for (const [brand, shelves] of Object.entries(TRACKER)) {
    for (const [shelf, skus] of Object.entries(shelves)) {
      for (const sku of skus) {
        const axes = baseline.extractAxes(sku, { brand, locale: "en" });
        if (!axes.modelCore) continue; // not in the reference: nothing to anchor a baseline row to
        rows.push({
          identityId: baseline.identityId({ ...axes, technology: shelf === "resin" ? RESIN_TECHNOLOGY : axes.technology }),
          brand,
          modelCore: axes.modelCore,
          modelWords: axes.modelWords,
          comboAxis: axes.comboAxis,
          feederGen: axes.feederGen,
          kitForm: axes.kitForm,
          laserWatts: axes.laserWatts,
          sizeTier: axes.sizeTier,
          technology: shelf === "resin" ? RESIN_TECHNOLOGY : axes.technology,
          aliases: [sku],
          noise: [],
          hardConflicts: ["model", "combo", "feeder", "kit", "laser", "size", "technology"],
          source: "trusted-tracker",
          confidence: 0.9
        });
      }
    }
  }
  return rows;
}

// One row per (brand, modelCore, axes) the reference knows. The reference is the authority here, so
// these rows outrank the tracker rows when both claim a title.
function rowsFromReference() {
  const rows = [];
  for (const [brand, table] of Object.entries(idx.MODELS || {})) {
    const byCore = new Map();
    for (const [alias, core] of Object.entries(table)) {
      if (!byCore.has(core)) byCore.set(core, []);
      byCore.get(core).push(alias);
    }
    for (const [core, aliases] of byCore) {
      // Generic cores ("a1", "k2", "i3"...) are deliberately not baseline rows: they are shared
      // across makers and a row would let a clone inherit a real brand's identity.
      // Generic cores are real products (Bambu A1, Creality K2, Ender-3) that a clone could also be
      // named after, so they are emitted as rows but marked channel-uncertain below: confirmed
      // enough to match and merge, never enough to overrule a conflict on its own.
      const sample = aliases[0];
      const axes = baseline.extractAxes(sample, { brand, locale: "en" });

      // A model core is not one product. "P1S" and "P1S Combo" are two rows, because the pack is
      // identity — a baseline holding only the bare row reports a hard conflict on every combo
      // listing and holds the very products it exists to confirm.
      //
      // The combo row needs a feeder, and the reference knows each brand's default (Combo on a
      // brand that ships an AMS means that AMS). Without a default we still emit the combo row,
      // just without a feeder segment, and the tracker rows supply the named generations.
      const bare = { ...axes, modelCore: core, brand, comboAxis: "bare", feederGen: "" };
      const defaults = (idx.DEFAULT_FEEDER || {})[brand];
      const defaultFeeder = defaults && typeof defaults === "object" ? defaults.feeder || defaults.id || "" : defaults || "";

      const variants = [bare];
      if (aliases.some((a) => /\bcombo\b/i.test(a)) || defaultFeeder) {
        variants.push({ ...bare, comboAxis: "combo", feederGen: defaultFeeder || axes.feederGen });
      }

      for (const variant of variants) {
        rows.push({
          identityId: baseline.identityId(variant),
          brand,
          modelCore: core,
          modelWords: String(sample).split(" "),
          comboAxis: variant.comboAxis,
          feederGen: variant.feederGen,
          kitForm: variant.kitForm,
          laserWatts: variant.laserWatts,
          sizeTier: variant.sizeTier,
          technology: variant.technology,
          aliases: [...new Set([...aliases, sample])],
          noise: [],
          hardConflicts: ["model", "combo", "feeder", "kit", "laser", "size", "technology"],
          // A generic core is emitted, but never as authoritative: it matches and merges, and it
          // is not allowed to overrule a conflict on its own.
          source: (idx.GENERIC_CORES || new Set()).has(core) ? "channel-uncertain" : "official",
          confidence: (idx.GENERIC_CORES || new Set()).has(core) ? 0.6 : 0.95
        });
      }
    }
  }
  return rows;
}

function main() {
  const official = rowsFromReference();
  const tracker = rowsFromTracker();

  // An official row wins an identityId clash; tracker rows that duplicate one are dropped, but a
  // tracker row that names a PACK the reference does not (A1 AMS Lite) is kept as its own row.
  const byId = new Map();
  for (const row of official) byId.set(row.identityId, row);
  let kept = 0;
  for (const row of tracker) {
    if (byId.has(row.identityId)) {
      // Same identity from a second source is evidence, not a new row: record the alias instead.
      const existing = byId.get(row.identityId);
      existing.aliases = [...new Set([...existing.aliases, ...row.aliases])];
      continue;
    }
    byId.set(row.identityId, row);
    kept += 1;
  }

  const rows = [...byId.values()].sort((a, b) => a.identityId.localeCompare(b.identityId));
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({
    version: 1,
    generatedFrom: ["lib/catalog-index.cjs (official)", "prompt Part B1/B2 (trusted-tracker)"],
    counts: {
      rows: rows.length,
      official: rows.filter((r) => r.source === "official").length,
      "trusted-tracker": rows.filter((r) => r.source === "trusted-tracker").length,
      brands: new Set(rows.map((r) => r.brand)).size
    },
    rows
  }, null, 1) + "\n");

  console.log("wrote", path.relative(process.cwd(), OUT));
  console.log("rows:", rows.length, "| official:", rows.filter((r) => r.source === "official").length,
    "| tracker-only:", kept, "| brands:", new Set(rows.map((r) => r.brand)).size);
}

main();
