"use strict";

// compareScrapedToBaseline(listing, index) -> a report for Magellan / harvest QA.
//
// This answers exactly one question: "which real product is this, and is there anything about it I
// do not trust?" It never merges, never prices, and never calls a model. The matcher may use the
// report as a boost; a human reads the notes.
//
// The order is the spec's order and it matters:
//   normalize -> resolve brand -> longest model match -> axes -> row lookup -> hard conflict check
//   -> ambiguity check -> report
//
// Status is deliberately three-valued and pessimistic:
//   "match"  a row was found and nothing contradicts it
//   "hold"   a row was found but something is ambiguous (contested alias, missing axes, two packs)
//   "unknown" no row was found, or the brand is not one we carry — never mapped onto a lookalike

const baseline = require("./baseline-catalog.js");
const normalizeLib = require("./title-normalize.js");

// A listing that says "uyumlu", "tarzı", "compatible" or "replacement for" is an accessory or a
// clone. Mapping one of those onto a baseline brand is the single worst mistake this module could
// make, so it is checked before anything else and short-circuits to "unknown".
// Two strengths, because these words are not equivalent in a Turkish shop title.
//
// STRONG means the listing is about being like, or for, something else: "A1 tarzi" (A1
// style), "muadil", "benzer", "replacement for". Never the brand's own product.
//
// WEAK words ("uyumlu", "uygun", "compatible") are also how Turkish shops describe a
// FEATURE of a genuine product — "Bambu Lab H2S 3D Yazici (AMS uyumlu)" is a real H2S
// that happens to work with AMS. Treating that as an accessory held the second shop's
// listing of a product the first shop had already created, so two shops never merged
// onto one row. Weak wording is therefore only fatal when NO model core matched.
const COMPATIBILITY_STRONG = /\b(tarzi|benzer|muadil|replacement for|for use with|alternatif)\b/;
const COMPATIBILITY_WEAK = /\b(uyumlu|uygun|compatible|compatibility|destekli)\b/;

function compareScrapedToBaseline(listing = {}, index, options = {}) {
  const locale = options.locale || "en";
  const title = String(listing.name || listing.title || "");
  const notes = [];
  const report = {
    title,
    normalized: "",
    status: "unknown",
    identityId: "",
    brand: "",
    modelCore: "",
    axes: null,
    matchedRow: null,
    matchedAlias: "",
    source: "",
    confidence: 0,
    hardConflicts: [],
    notes
  };

  if (!title.trim()) {
    notes.push("empty title");
    return report;
  }

  // 1. Compatibility talk is not identity.
  const foldedRaw = normalizeLib.fold(title, locale);
  if (COMPATIBILITY_STRONG.test(" " + foldedRaw + " ")) {
    notes.push("compatibility wording: not mapped onto a baseline brand");
    return report;
  }

  // 2/3. Brand, then longest model match. The brand hint narrows the model table so "A1" cannot be
  // looked up in Sovol's table.
  const brand = baseline.resolveBrand(title, locale);
  report.brand = brand;
  if (!brand) {
    notes.push("brand is not in the reference: axis-only identity, no baseline row");
    return report;
  }

  const axes = baseline.extractAxes(title, { brand, locale });
  report.axes = axes;
  report.normalized = normalizeLib.normalize(title, { locale, brand });
  report.modelCore = axes.modelCore;
  report.identityId = axes.modelCore ? baseline.identityId(axes) : "";

  if (!axes.modelCore) {
    // No confirmed model AND soft compatibility wording: an accessory or a lookalike. Mapping it
    // onto the brand is the mistake the spec names.
    if (COMPATIBILITY_WEAK.test(" " + foldedRaw + " ")) {
      notes.push("compatibility wording and no model core: not mapped onto a baseline brand");
      return report;
    }
    notes.push("no model core matched: refusing to guess from a prefix");
    return report;
  }
  // A generic core ("a1", "k2", "ender-3") is a real product that a clone can also be named after.
  // It is no longer a dead end: the row exists as channel-uncertain, so it can match and merge
  // while still never overruling a conflict on its own. Refusing it outright meant the three most
  // common printers on these shops asked for permission on every single run.
  if (axes.genericCore) {
    notes.push("generic model core '" + axes.modelCore + "': boost only, confirmed by a human");
  }

  // 4. Row lookup, highest source priority first.
  const hit = index ? index.lookup(title, { brand }) : null;
  if (!hit) {
    notes.push("model core matched but no baseline row claims this pack: hold for review");
    return report;
  }

  report.matchedRow = hit.row;
  report.matchedAlias = hit.matched;
  report.source = hit.row.source;
  report.confidence = hit.row.confidence;

  // 5. The listing's axes against the row's axes. A difference here is the reason the old matcher
  // split one product into two rows, so it is reported as a hard conflict rather than a nudge.
  const conflicts = baseline.hardConflicts(axes, hit.row);
  report.hardConflicts = conflicts;
  if (conflicts.length) {
    notes.push("hard conflict on " + conflicts.join(", ") + " against " + hit.row.identityId);
    report.status = "hold";
    return report;
  }

  // 6. Ambiguity: two rows claiming the same alias means the baseline itself disagrees, and the
  // baseline is not allowed to quietly pick a winner for us.
  if (hit.contested) {
    notes.push("alias '" + hit.matched + "' is claimed by " + hit.contested.map((r) => r.identityId).join(" and "));
    report.status = "hold";
    return report;
  }

  // A row that is not the best source we hold is a boost, not a confirmation.
  if (hit.row.source !== "official") {
    notes.push("matched a " + hit.row.source + " row: boost only");
  }

  report.status = "match";
  return report;
}

module.exports = { compareScrapedToBaseline, COMPATIBILITY_STRONG, COMPATIBILITY_WEAK };
