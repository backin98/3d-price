"use strict";

// The baseline catalog: one row per real identity, plus a loader and a lookup that answers "is
// this scraped listing a thing we know, and which thing exactly?".
//
// Design rules from the spec, encoded here rather than described in a comment:
//   - A baseline row is a BOOST / HARDCONFLICT / ALIAS source, never a merge decision. This module
//     returns evidence; the matcher decides.
//   - Longest match wins. A short prefix ("K2") must never claim a longer model ("K2 Plus Pro").
//   - Unknown or local makers are not mapped onto a known brand just because they look similar.
//     "A1 tarzı" is not a Bambu A1, and the report says so instead of guessing.
//   - Source priority: official > trusted-tracker > channel-uncertain. When two rows claim the
//     same normalized title, the higher-priority source is the row that is returned, and the
//     conflict is reported rather than hidden.
//
// The reference tables (brands, model aliases, feeders, noise, generic cores) live in
// catalog-index.cjs. This module deliberately does not restate them: two copies of a catalog drift,
// and a baseline that disagrees with the matcher is worse than no baseline.

const fs = require("node:fs");
const path = require("node:path");
const idx = require("./catalog-index.cjs");
const normalizeLib = require("./title-normalize.js");

const DEFAULT_FILE = path.join(__dirname, "..", "data", "baseline-catalog.json");

// Higher wins. An official row beats a tracker row beats an uncertain channel row.
const SOURCE_RANK = { official: 3, "trusted-tracker": 2, "channel-uncertain": 1 };
const sourceRank = (s) => SOURCE_RANK[s] || 0;

function loadBaseline(file = DEFAULT_FILE) {
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  const rows = Array.isArray(raw) ? raw : raw.rows || [];
  return rows.map((r) => ({
    identityId: r.identityId,
    brand: r.brand || "",
    modelCore: r.modelCore || "",
    modelWords: r.modelWords || [],
    comboAxis: r.comboAxis || "bare",
    feederGen: r.feederGen || "",
    kitForm: r.kitForm || "",
    laserWatts: r.laserWatts || "",
    sizeTier: r.sizeTier || "",
    technology: r.technology || "fdm",
    aliases: r.aliases || [],
    noise: r.noise || [],
    hardConflicts: r.hardConflicts || [],
    source: r.source || "channel-uncertain",
    confidence: typeof r.confidence === "number" ? r.confidence : 0.5
  }));
}

// identityId per the spec: {brand}/{modelCore}/{comboAxis}/{feederGen?}/{kitForm?}/{extra?}
// An unknown maker contributes "unknown" so two white-label machines can still agree on an id.
function identityId(axes = {}) {
  const brand = axes.brand || "unknown";
  const core = axes.modelCore || "unnamed";
  const parts = [brand, core, axes.comboAxis === "combo" ? "combo" : "bare"];
  if (axes.feederGen) parts.push(axes.feederGen);
  if (axes.kitForm) parts.push(axes.kitForm);
  if (axes.laserWatts) parts.push("laser-" + axes.laserWatts + "w");
  if (axes.sizeTier) parts.push("size-" + axes.sizeTier);
  if (axes.technology && axes.technology !== "fdm") parts.push(axes.technology);
  return parts.join("/");
}

// A single model match, longest alias first, whole-token only. Returns null rather than a
// best-effort prefix, because a wrong modelCore is a hard conflict that splits one product into two
// rows, and that is far more expensive to undo than a hold.
function longestModelMatch(text, brand, locale = "en") {
  const table = (idx.MODELS || {})[brand];
  if (!table) return null;
  const hay = " " + normalizeLib.normalize(text, { locale, brand }) + " ";
  const aliases = Object.keys(table).sort((a, b) => b.length - a.length);
  for (const alias of aliases) {
    const needle = " " + normalizeLib.fold(alias, locale) + " ";
    if (needle.trim() && hay.includes(needle)) return { alias, modelCore: table[alias] };
  }
  return null;
}

// The brand as the reference knows it, or "" when this is not a brand we carry.
function resolveBrand(text, locale = "en") {
  const found = idx.brandOf ? idx.brandOf(text) : null;
  if (found && found.id) return found.id;
  const folded = normalizeLib.fold(text, locale);
  for (const canonical of Object.keys(idx.BRANDS || {})) {
    if (folded.includes(canonical)) return canonical;
  }
  return "";
}

// Axes for a title: brand, model core, and the axes that hard-split a product from its neighbours.
function extractAxes(text, options = {}) {
  const locale = options.locale || "en";
  const brand = options.brand || resolveBrand(text, locale);
  const model = brand ? longestModelMatch(text, brand, locale) : null;
  const folded = normalizeLib.normalize(text, { locale, brand });
  // feederOf is (brandId, title) - the arguments were the wrong way round, so this always returned
  // null and every baseline row lost its feeder generation. Verified: "Bambu Lab P1S AMS 2 Pro Combo"
  // gives null the old way and {id:"ams-2-pro"} the right way.
  const feed = brand && idx.feederOf ? idx.feederOf(brand, text) : null;
  // feederOf is not consistent about its return shape, so collapse it once, here.
  const feederName = (() => {
    const raw = feed && typeof feed === "object" ? feed.feeder || feed.id || feed.name || "" : feed;
    return typeof raw === "string" ? raw : "";
  })();
  const comboWords = (idx.COMBO_WORDS || []).some((w) => folded.includes(normalizeLib.fold(w, locale)));
  const bareWords = (idx.BARE_WORDS || []).some((w) => folded.includes(normalizeLib.fold(w, locale)));
  const generic = !!(model && (idx.GENERIC_CORES || new Set()).has(model.modelCore));

  return {
    brand,
    modelCore: model ? model.modelCore : "",
    modelWords: model ? String(model.alias).split(" ") : [],
    genericCore: generic,
    // feederOf answers in three shapes depending on the title: null when no feeder is named, a
    // single feeder when it is, and (for a brand with several) a choice. Normalize all three here
    // rather than at each call site, because reading `.feeder` off a string silently yields "" and
    // an empty feeder is not "no feeder" — it is a missing axis, which shows up as a false hard
    // conflict against every row that does name one.
    //
    // An explicit bare word beats an explicit combo word: "CFS'siz combo" is a bare machine, and
    // shops do write that.
    comboAxis: bareWords ? "bare" : comboWords ? "combo" : feederName ? "combo" : "bare",
    feederGen: feederName,
    kitForm: idx.kitFormOf ? idx.kitFormOf(text) || "" : "",
    laserWatts: idx.laserWattsOf ? idx.laserWattsOf(text) || "" : "",
    sizeTier: idx.sizeTierOf ? idx.sizeTierOf(text) || "" : "",
    // technologyOf is also (brandId, title). Called with the title alone it returns "fdm" for
    // everything, so every laser machine was being classified as FDM.
    technology: idx.technologyOf ? idx.technologyOf(brand, text) || "fdm" : "fdm"
  };
}

// The axes that, when they differ, mean two listings are not the same product. Model core first:
// K2 Plus vs K2 Pro is the difference that matters most and is the one the old matcher lost.
//
// Two classes of axis, and the distinction matters:
//   always compared  model, combo, technology. Every listing has a value for these — a machine
//                    without a feeder is "bare", not "unspecified" — so a difference is real.
//   compared only when both are stated: feeder generation, kit form, laser watts, size tier.
//                    "Combo" with no AMS named is the brand's default bundle, not a different
//                    bundle, and a title that omits the wattage has not contradicted one that
//                    states it. Treating silence as disagreement held every combo listing against
//                    its own bare row and made the baseline useless for the packs it exists to
//                    confirm.
function hardConflicts(a = {}, b = {}) {
  const out = [];
  const always = (name, x, y) => { if ((x || "") !== (y || "")) out.push(name); };
  const bothStated = (name, x, y) => {
    const sx = x || "";
    const sy = y || "";
    if (sx && sy && sx !== sy) out.push(name);
  };
  always("model", a.modelCore, b.modelCore);
  always("combo", a.comboAxis, b.comboAxis);
  bothStated("feeder", a.feederGen, b.feederGen);
  bothStated("kit", a.kitForm, b.kitForm);
  bothStated("laser", a.laserWatts, b.laserWatts);
  bothStated("size", a.sizeTier, b.sizeTier);
  always("technology", a.technology, b.technology);
  return out;
}

// Build a lookup over the rows. Aliases are indexed by their normalized form so a shop title finds
// its row without an O(rows) scan per call.
function createCatalogIndex(rows, options = {}) {
  const locale = options.locale || "en";
  const byAlias = new Map();
  const byIdentity = new Map();

  for (const row of rows) {
    if (!byIdentity.has(row.identityId)) byIdentity.set(row.identityId, row);
    const keys = new Set([row.modelCore, ...(row.aliases || [])]);
    for (const key of keys) {
      if (!key) continue;
      const needle = normalizeLib.fold(key, locale);
      if (!needle) continue;
      // One alias maps to MANY rows, not one: a model core names a family ("p1s" is both the bare
      // machine and the combo), and picking a single winner here is what made every combo listing
      // report a hard conflict against its own bare row. Candidates are resolved by axes below.
      if (!byAlias.has(needle)) byAlias.set(needle, []);
      byAlias.get(needle).push(row);
    }
  }

  // The row whose axes actually fit the listing. Fewest hard conflicts wins, then the
  // higher-priority source. A listing naming no feeder will prefer the bare row; one naming AMS
  // will prefer the AMS row; and a genuine mismatch stays a conflict because nothing fits.
  function bestOf(candidates, axes) {
    if (!candidates || !candidates.length) return null;
    const ranked = candidates
      .map((row) => ({ row, conflicts: hardConflicts(axes, row).length }))
      .sort((a, b) => a.conflicts - b.conflicts || sourceRank(b.row.source) - sourceRank(a.row.source));
    const winner = ranked[0];
    return {
      row: winner.row,
      conflicts: winner.conflicts,
      // Two rows that fit equally well are the baseline disagreeing with itself about this title.
      contested: ranked.length > 1 && ranked[1].conflicts === winner.conflicts && ranked[1].row.identityId !== winner.row.identityId
        ? [winner.row, ranked[1].row]
        : null
    };
  }

  // lookup(text, { brand }) -> { row, matched, contested, conflicts } | null
  function lookup(text, opts = {}) {
    const brand = opts.brand || resolveBrand(text, locale);
    const axes = extractAxes(text, { brand, locale });
    const needle = normalizeLib.normalize(text, { locale, brand });
    if (!needle) return null;

    const model = brand ? longestModelMatch(text, brand, locale) : null;
    if (model) {
      const hit = bestOf(byAlias.get(normalizeLib.fold(model.alias, locale)), axes);
      if (hit) return { ...hit, matched: model.alias };
    }
    // Fall back to a whole-title alias scan, longest alias first.
    const aliases = [...byAlias.keys()].sort((a, b) => b.length - a.length);
    for (const alias of aliases) {
      if ((" " + needle + " ").includes(" " + alias + " ")) {
        const hit = bestOf(byAlias.get(alias), axes);
        if (hit) return { ...hit, matched: alias };
      }
    }
    return null;
  }

  return {
    rows,
    size: rows.length,
    byIdentity,
    lookup,
    axes: (text, opts) => extractAxes(text, opts),
    identityId,
    hardConflicts
  };
}

module.exports = {
  DEFAULT_FILE,
  SOURCE_RANK,
  loadBaseline,
  createCatalogIndex,
  identityId,
  extractAxes,
  longestModelMatch,
  resolveBrand,
  hardConflicts
};
