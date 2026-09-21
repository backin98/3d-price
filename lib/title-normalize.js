"use strict";

// Locale-aware title normalization for the scrape baseline.
//
// A shop writes "Creality K2 Plus Combo 3D Yazıcı", a tracker writes "K2 PLUS", and a German shop
// writes "K2 Plus Combo mit AMS". All three have to land on the same normalized string before a
// baseline comparison means anything. This module is that step, and only that step: it never
// decides identity, never merges, never guesses a model.
//
// Locales are pluggable. Turkish and English ship here because those are the two the shops and the
// trackers actually use; a new locale is a new entry in LOCALES plus, if the script needs it, an
// entry in the fold tables. Nothing else in the file is locale-specific.
//
// PERFORMANCE: every function here is pure and call-heavy. `normalize` walks the brand and feeder
// alias tables with split/join passes, so it is memoized by (text, locale, brandHint). Without the
// cache this exact work sat in an O(n^2) comparison loop and pushed /api/hunt past Netlify's 30s
// function limit, which took the storefront down. The cache is not an optimization here, it is a
// correctness requirement of the call pattern.

const idx = require("./catalog-index.cjs");

// Turkish folds are not the generic ones: "I" lowercases to a dotless "ı", and "İ" to "i", so a
// plain toLowerCase() followed by diacritic stripping loses the distinction the shops rely on.
const TR_FOLD = [
  ["İ", "i"], ["I", "i"], ["ı", "i"],
  ["Ş", "s"], ["ş", "s"], ["Ğ", "g"], ["ğ", "g"],
  ["Ü", "u"], ["ü", "u"], ["Ö", "o"], ["ö", "o"], ["Ç", "c"], ["ç", "c"]
];

// "with X" / "without X" templates. {item} is a feeder alias, so "AMS ile" and "AMS'li" both mean
// the printer ships with an AMS, which is a combo. Turkish writes this as a suffix, which is why
// the templates have to accept the glued forms as well as the spaced ones.
const EQUIPMENT_TEMPLATES = {
  combo: ["{item} ile", "{item} li", "{item}li", "{item}'li", "with {item}", "{item} dahil"],
  bare: ["{item} siz", "{item}siz", "{item} olmadan", "without {item}", "no {item}"]
};

// Kit vs assembled is identity, so these must NOT collapse into each other — they only collapse
// onto their own canonical token.
const KIT_TEMPLATES = {
  kit: ["kit", "kendin kur", "kendin-kur", "diy kit", "unassembled"],
  assembled: ["assembled", "montajli", "montajlı", "hazir", "hazır", "pre assembled", "pre-assembled"]
};

const LOCALES = {
  tr: { fold: TR_FOLD, equipment: EQUIPMENT_TEMPLATES, kit: KIT_TEMPLATES },
  en: { fold: [], equipment: EQUIPMENT_TEMPLATES, kit: KIT_TEMPLATES }
};

function foldTables(locale) {
  const tables = LOCALES[locale] || LOCALES.en;
  const extra = tables.fold || [];
  const base = [
    // Dotless i belongs in the BASE table, not only the Turkish one. "ı" does not decompose under
    // NFD, so without this mapping it survives lowercasing and is then eaten by the [^a-z0-9]
    // collapse — "Yazıcı" became "yaz c" under the default locale, silently mangling every Turkish
    // title that was not explicitly normalised as tr.
    ["ı", "i"], ["İ", "i"],
    ["ş", "s"], ["ğ", "g"], ["ü", "u"], ["ö", "o"], ["ç", "c"],
    ["â", "a"], ["î", "i"], ["û", "u"], ["é", "e"], ["è", "e"], ["ê", "e"],
    ["á", "a"], ["à", "a"], ["ä", "a"], ["ß", "ss"]
  ];
  const seen = new Set();
  return [...extra, ...base].filter(([from]) => {
    if (seen.has(from)) return false;
    seen.add(from);
    return true;
  });
}

// Lowercase + de-accent + collapse everything that is not a letter or digit into a single space.
// The ASCII-folding is deliberate: the shops mix Turkish, English and stray Cyrillic in one title,
// and comparing folded forms is what makes "Yazıcı" and "Yazici" the same word.
function fold(text, locale = "en") {
  let s = String(text == null ? "" : text).normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  s = s.toLowerCase();
  for (const [from, to] of foldTables(String(locale).toLowerCase())) {
    s = s.split(from.toLowerCase()).join(to);
  }
  return s.replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

const aliasesOf = (table, key) => Object.keys(table || {}).filter((a) => (table[a] === key || table[a] === key.id));

// Longest alias first: "ams 2 pro" must win over "ams", or every AMS 2 Pro combo reads as a plain
// AMS combo. A prefix-only match is explicitly forbidden by the spec, so this sorts by length and
// requires the whole alias token-sequence to be present.
function byLongestFirst(list) {
  return [...list].sort((a, b) => b.length - a.length);
}

function applyTemplates(text, item, templates, replacement) {
  let out = " " + text + " ";
  for (const template of templates) {
    const phrase = fold(template.replace("{item}", item));
    if (!phrase) continue;
    out = out.split(" " + phrase + " ").join(" " + replacement + " ");
  }
  return out;
}

const cache = new Map();
const CACHE_LIMIT = 50000; // ponytail: one catalog pass is a few hundred titles; this only guards a runaway caller

// normalize(text, { locale, brand }) -> a folded, alias-resolved, noise-stripped title.
//
// brand is only a hint. It narrows which feeder namespace is consulted, because Sovol "ACE" and
// Anycubic "ACE" are different feeders and must never be resolved against each other.
function normalize(text, options = {}) {
  const locale = String(options.locale || "en").toLowerCase();
  const brand = options.brand ? fold(options.brand, locale) : "";
  const key = locale + "\u0001" + brand + "\u0001" + String(text == null ? "" : text);
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  let t = fold(text, locale);
  const tables = LOCALES[locale] || LOCALES.en;

  // Brand spellings first: "BambuLab", "Bambu Lab" and "bambu-lab" are one brand, and the canonical
  // id has to be in place before anything else looks at the string.
  for (const canonical of Object.keys(idx.BRANDS || {})) {
    for (const alias of byLongestFirst(aliasesOf(idx.BRANDS[canonical], canonical))) {
      const phrase = fold(alias, locale);
      if (phrase) t = (" " + t + " ").split(" " + phrase + " ").join(" " + canonical + " ").trim();
    }
  }

  // Equipment phrases. Resolved per brand namespace when we know the brand, and across every
  // namespace otherwise — never across namespaces when a brand hint exists.
  const namespaces = brand && idx.FEEDERS && idx.FEEDERS[brand]
    ? [idx.FEEDERS[brand]]
    : Object.values(idx.FEEDERS || {});
  const items = new Set();
  for (const table of namespaces) for (const alias of Object.keys(table || {})) items.add(alias);
  for (const item of items) {
    for (const [replacement, templates] of Object.entries(tables.equipment || {})) {
      t = applyTemplates(t, item, templates, replacement).trim();
    }
  }

  // Kit and assembled keep their own tokens.
  for (const [replacement, templates] of Object.entries(tables.kit || {})) {
    for (const template of templates) {
      const phrase = fold(template, locale);
      if (phrase) t = (" " + t + " ").split(" " + phrase + " ").join(" " + replacement + " ").trim();
    }
  }

  // Marketing noise last: it is not identity, so it must not survive into a comparison.
  for (const noise of byLongestFirst((idx.NOISE || []).map((n) => fold(n, locale)))) {
    if (noise) t = (" " + t + " ").split(" " + noise + " ").join(" ").trim();
  }

  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(key, t);
  return t;
}

function cacheSize() {
  return cache.size;
}

module.exports = { normalize, fold, LOCALES, EQUIPMENT_TEMPLATES, KIT_TEMPLATES, cacheSize };
