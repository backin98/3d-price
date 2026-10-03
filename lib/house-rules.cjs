"use strict";

// House rules: what your own edits teach the run.
//
// Every card you fix by hand in the admin (spool material, sub-brand, the swatch colour you eyedropped) is a label.
// scripts/learn-house-rules.cjs reads them into data/house-rules.json; this module turns the rules back into guesses
// for a new listing, each with the evidence behind it, so the admin can say WHY a field is filled and you can decide
// how far to trust it. A guess never overwrites something a person set.
//
//   predictSpool(rules, listing)  → { value: "cardboard", confidence: 0.87, n: 14, level: "brand+polymer+variant" } | null
//   subBrandOf(brand, title, rules) → "Panchroma" | "Ender" | "CR" | …  ("" when the title names no line)
//   toneFor(rules, listing)       → { hex, n, level } | null  (the shade you picked for this colour before)
//   enrichListing(listing, rules) → the listing with the fields it can fill, never over a value that is already there

const fold = (v) => String(v == null ? "" : v).toLowerCase().normalize("NFD").replace(/\p{M}/gu, "")
  .replace(/ı/g, "i").replace(/ş/g, "s").replace(/ç/g, "c").replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ö/g, "o")
  .replace(/\+/g, " plus ").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
const words = (v) => " " + fold(v) + " ";

// ---- sub-brands --------------------------------------------------------------------------------------------------
// A line a maker sells under its own name inside its brand: "Polymaker PolyTerra", "Creality Ender". Written the way
// the baseline writes them. Creality Hyper is NOT here on purpose: the baseline files it as the high-speed variant.
const SEED_SUBS = {
  polymaker: [
    ["Panchroma", /\bpanchroma\b/], ["PolyTerra", /\bpoly ?terra\b/], ["PolyLite", /\bpoly ?lite\b/], ["PolyMax", /\bpoly ?max\b/],
    ["PolyFlex", /\bpoly ?flex\b/], ["PolyMide", /\bpoly ?mide\b/], ["PolySonic", /\bpoly ?sonic\b/], ["PolyCast", /\bpoly ?cast\b/],
    ["PolyWood", /\bpoly ?wood\b/], ["PolyDissolve", /\bpoly ?dissolve\b/], ["PolySupport", /\bpoly ?support\b/], ["Fiberon", /\bfiberon\b/]
  ],
  creality: [
    ["Ender", /\bender\b/], ["CR", /\bcr (?=pla|petg|abs|tpu|silk|wood|pc|pa|asa|plus)/], ["Space Pi", /\bspace ?pi\b/]
  ]
};

function subBrandOf(brand, title, rules) {
  const b = fold(brand);
  const t = fold(title);
  if (!b || !t) return "";
  const found = [];
  for (const [name, re] of SEED_SUBS[b] || []) if (re.test(t)) found.push(name);
  // Lines you named yourself: a card whose title says the line and where you typed that line as the sub-brand.
  for (const row of ((rules && rules.subBrands) || {})[b] || []) {
    if (!found.includes(row.name) && words(t).includes(" " + fold(row.name) + " ")) found.push(row.name);
  }
  return found[0] || "";
}

// ---- spool material ----------------------------------------------------------------------------------------------
// Most specific first. "brand+variant" is the same special spool across materials (every RhinoLab -CF is cardboard).
const SPOOL_LEVELS = [
  ["brand+sub+polymer+variant", (k) => [k.brand, k.sub, k.polymer, k.variant]],
  ["brand+polymer+variant", (k) => [k.brand, k.polymer, k.variant]],
  ["brand+variant", (k) => (k.variant ? [k.brand, "*", k.variant] : null)],
  ["brand+polymer", (k) => [k.brand, k.polymer]],
  ["brand", (k) => [k.brand]]
];

function spoolKeyParts(l) {
  const sub = String(l.subBrand || "").split(",")[0];
  return {
    brand: fold(l.brand),
    sub: fold(sub),
    polymer: fold(l.polymer),
    variant: String(l.variant || "").split(/[,+]/).map(fold).filter(Boolean).sort().join("+")
  };
}
const joinKey = (parts) => parts.join("|");

// Lower bound of the share of the majority at ~85% confidence (Wilson): 3 of 3 is not as sure as 14 of 14.
function wilson(k, n) {
  if (!n) return 0;
  const z = 1.04, p = k / n;
  return (p + (z * z) / (2 * n) - z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n)) / (1 + (z * z) / n);
}

function predictSpool(rules, listing, opts = {}) {
  const table = rules && rules.spool;
  if (!table || !listing) return null;
  const parts = spoolKeyParts(listing);
  if (!parts.brand) return null;
  const minShare = opts.minShare != null ? opts.minShare : 0.7;
  const found = [];
  SPOOL_LEVELS.forEach(([level, pick], depth) => {
    const key = pick(parts);
    const counts = key && (table[level] || {})[joinKey(key)];
    if (!counts) return;
    const n = Object.values(counts).reduce((a, b) => a + b, 0);
    const [value, top] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    if (!n || top / n < minShare) return;
    found.push({ value, confidence: Math.round(wilson(top, n) * 100) / 100, share: Math.round((top / n) * 100) / 100, n, level, depth });
  });
  if (!found.length) return null;
  // The most specific level that has seen this kind of spool at least twice speaks for it, even when a broader
  // level has seen more: "RhinoLab is plastic" must not overrule "RhinoLab -CF is cardboard".
  const best = found.find((f) => f.n >= 2) || found.reduce((a, b) => (b.confidence > a.confidence ? b : a));
  const { depth, ...rest } = best;
  return rest;
}

// ---- learned tones -----------------------------------------------------------------------------------------------
const toneName = (l) => fold(l.colorName || l.color || "");

function toneFor(rules, listing) {
  const tones = rules && rules.tones;
  if (!tones || !listing || listing.multicolor) return null;
  const name = toneName(listing);
  if (!name) return null;
  const brand = fold(listing.brand);
  const hit = (tones.byBrandName || {})[brand + "|" + name];
  if (hit) return { hex: hit.hex, n: hit.n, level: "brand+colour" };
  const named = (tones.byName || {})[name];
  if (named) return { hex: named.hex, n: named.n, level: "colour" };
  return null;
}

// ---- learning ----------------------------------------------------------------------------------------------------
function hexToLab(hex) {
  const n = parseInt(String(hex).slice(1), 16);
  const lin = (c) => { c /= 255; return c > 0.04045 ? ((c + 0.055) / 1.055) ** 2.4 : c / 12.92; };
  const r = lin((n >> 16) & 255), g = lin((n >> 8) & 255), b = lin(n & 255);
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047), y = f(r * 0.2126 + g * 0.7152 + b * 0.0722), z = f((r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
const labDist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
// The pick closest to all the others: a shade you really chose, not an average that no spool has.
function medoidHex(hexes) {
  if (hexes.length <= 2) return hexes[0];
  const labs = hexes.map(hexToLab);
  let best = 0, bestSum = Infinity;
  labs.forEach((a, i) => { const s = labs.reduce((t, b) => t + labDist(a, b), 0); if (s < bestSum) { bestSum = s; best = i; } });
  return hexes[best];
}

/**
 * cards: the cards you edited by hand (each with the listing title and the values you set).
 * Returns the rules object that data/house-rules.json stores.
 */
function learnRules({ cards = [], baselineItems = [] } = {}) {
  const spool = Object.fromEntries(SPOOL_LEVELS.map(([level]) => [level, {}]));
  const bump = (level, key, value) => { const t = spool[level]; (t[key] = t[key] || {})[value] = ((t[key] || {})[value] || 0) + 1; };
  const subs = {};
  const toneLists = { byBrandName: {}, byName: {} };
  let spoolCards = 0, toneCards = 0;
  const rows = [
    ...cards.map((c) => ({ ...c, _src: "card" })),
    ...baselineItems.filter((i) => i && i.spoolMaterial && i.category === "filaments").map((i) => ({ ...i, _src: "baseline" }))
  ];
  // A value still equal to what the run guessed is not a label: autosave stores every field of a card you touched, so an
  // untouched guess would come back as if you had chosen it, and the rules would only ever learn their own words.
  const guessed = (c, field) => !!(c.guess && c.guess[field] && fold(c.guess[field].value) === fold(c[field]));
  for (const c of rows) {
    const value = fold(c.spoolMaterial);
    if ((value === "plastic" || value === "cardboard") && !guessed(c, "spoolMaterial") && c.spoolSource !== "photo") {
      spoolCards++;
      const parts = spoolKeyParts(c);
      for (const [level, pick] of SPOOL_LEVELS) { const key = pick(parts); if (key) bump(level, joinKey(key), value); }
    }
    // A sub-brand you typed that the title also names is a line to recognise next time.
    const sub = String(c.subBrand || "").split(",")[0].trim();
    const title = c.sourceTitle || c.name || "";
    if (sub && fold(c.brand) && !guessed(c, "subBrand") && words(title).includes(" " + fold(sub) + " ")) {
      const b = fold(c.brand);
      subs[b] = subs[b] || new Map();
      subs[b].set(sub, (subs[b].get(sub) || 0) + 1);
    }
    // Only shades you picked yourself teach the run; ones the photo reader filled in would just teach it its own guesses.
    if (c._src === "card" && c.colorHexSource !== "photo" && /^#[0-9a-f]{6}$/i.test(c.colorHex || "") && !c.multicolor) {
      const name = toneName(c);
      if (name) {
        toneCards++;
        (toneLists.byName[name] = toneLists.byName[name] || []).push(c.colorHex.toLowerCase());
        const key = fold(c.brand) + "|" + name;
        (toneLists.byBrandName[key] = toneLists.byBrandName[key] || []).push(c.colorHex.toLowerCase());
      }
    }
  }
  const pack = (lists) => Object.fromEntries(Object.entries(lists).map(([k, hexes]) => [k, { hex: medoidHex(hexes), n: hexes.length }]));
  return {
    version: 1,
    trainedOn: { cards: cards.length, spoolLabels: spoolCards, toneLabels: toneCards, baselineItems: baselineItems.length },
    spool,
    subBrands: Object.fromEntries(Object.entries(subs).map(([b, m]) => [b, [...m].map(([name, n]) => ({ name, n }))])),
    tones: { byBrandName: pack(toneLists.byBrandName), byName: pack(toneLists.byName) }
  };
}

// ---- applying ----------------------------------------------------------------------------------------------------
// What the run fills in. `sure` guesses are filled and marked as learned; weaker ones are only offered as a hint.
const SURE = 0.8;

function enrichListing(listing, rules, opts = {}) {
  if (!listing || listing.kind !== "filament") return listing;
  const title = listing.sourceTitle || listing.name || "";
  const out = { ...listing };
  const guess = {};
  if (!out.subBrand) {
    const sub = subBrandOf(out.brand, title, rules);
    if (sub) { out.subBrand = sub; guess.subBrand = { value: sub, from: "title", confidence: 0.95 }; }
  }
  if (!out.spoolMaterial) {
    const spoolGuess = predictSpool(rules, out, opts);
    if (spoolGuess) {
      guess.spoolMaterial = { ...spoolGuess, from: "your labels" };
      if (spoolGuess.confidence >= SURE) out.spoolMaterial = spoolGuess.value;
    }
  }
  if (!out.colorHex && !(Array.isArray(out.colorHexes) && out.colorHexes.length)) {
    const tone = toneFor(rules, out);
    if (tone) { out.colorHex = tone.hex; guess.colorHex = { value: tone.hex, from: "your earlier picks", n: tone.n, level: tone.level }; }
  }
  if (Object.keys(guess).length) out.guess = { ...(out.guess || {}), ...guess };
  return out;
}

module.exports = { fold, SEED_SUBS, subBrandOf, predictSpool, toneFor, learnRules, enrichListing, medoidHex, hexToLab, labDist, wilson, SURE };
