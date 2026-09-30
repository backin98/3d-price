"use strict";

const TAXONOMY = require("../data/filament-taxonomy.json");

const fold = (value) => String(value || "").toLocaleLowerCase("tr")
  .replace(/ı/g, "i").replace(/ş/g, "s").replace(/ç/g, "c")
  .replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ö/g, "o")
  .replace(/\+/g, " plus ").replace(/_/g, " ")
  .replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();

const entries = (group) => Object.entries(TAXONOMY[group] || {})
  .flatMap(([id, row]) => (row.aliases || []).map((alias) => ({ id, alias: fold(alias) })))
  .sort((a, b) => b.alias.length - a.alias.length);
const POLYMER_ALIASES = entries("polymers");
const VARIANT_ALIASES = entries("variants");
const PACKAGING_ALIASES = entries("packaging");
const COLOR_ALIASES = entries("colours");

const hasPhrase = (text, phrase) => (" " + text + " ").includes(" " + phrase + " ");
const pick = (text, rows) => (rows.find((row) => hasPhrase(text, row.alias)) || {}).id || "";
// The material is the one the title names first: "Esun PLA-High Speed Filament - Peek Green" is PLA
// in a colour called "Peek Green", not PEEK. Longest alias wins at the same spot ("PLA Plus" > "PLA").
const pickFirst = (text, rows) => {
  const padded = " " + text + " ";
  let best = null;
  for (const row of rows) {
    const at = padded.indexOf(" " + row.alias + " ");
    if (at < 0) continue;
    if (!best || at < best.at || (at === best.at && row.alias.length > best.alias.length)) best = { at, alias: row.alias, id: row.id };
  }
  return best ? best.id : "";
};

function canonicalColour(value) {
  return pick(fold(value), COLOR_ALIASES);
}

function colourAgnosticTitle(value, colour) {
  const row = (TAXONOMY.colours || {})[colour];
  if (!row) return String(value || "").trim();
  let title = String(value || "");
  for (const alias of (row.aliases || []).slice().sort((a, b) => b.length - a.length)) {
    const phrase = String(alias).trim().split(/\s+/).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[\\s_/-]+");
    title = title.replace(new RegExp("(^|[^\\p{L}\\p{N}])" + phrase + "(?=$|[^\\p{L}\\p{N}])", "giu"), "$1");
  }
  return title.replace(/\s{2,}/g, " ").replace(/\s*[-–—|/]\s*$/g, "").replace(/^\s*[-–—|/]\s*/g, "").trim();
}

// The colour as the listing writes it ("Dark Red", "Siyah"), not the code. Shops usually end the title
// with " - <colour>"; that whole tail is the name when it names a colour. Otherwise the alias as written.
// `head` is the title without that tail, so "… Filament - Dark Red" never leaves a stray "- Dark".
// Dual / tri colour, gradient and rainbow spools. Their tail can be a made-up name ("Volcanic Eruption").
const MULTI_COLOUR = /\b(?:dual|tri|multi)[\s-]*(?:colou?r|renk)|\b\d\s*renkli\b|\b(?:çift|cift|üç|uc)\s*renk|\brainbow\b|\bgradi(?:ent|yan)\b|g[öo]kku[şs]a[ğg]|\bco-?extru/i;

// A multicolour colourway named inside the title, not after " - ":
// "Creality Hyper PLA Rainbow Spring Lake Filament 1.75mm 1Kg" → "Spring Lake".
// The words after the rainbow / gradient / dual-colour word, up to "filament" or a size; never a material word.
function multiColourName(value) {
  const m = String(value || "").match(/\b(?:rainbow|gradient|gradyan|multicolou?r|(?:dual|tri|multi)[\s-]*(?:colou?r|renk)|\d\s*renkli)\s+(.+?)(?=\s+(?:filament|filaman|\d)|\s*$)/i);
  const name = m ? m[1].trim() : "";
  return name && !/\b(?:pla\+?|petg|abs|asa|tpu|pctg|silk|matte|hyper|speed|filament)\b/i.test(name) ? name : "";
}

function colourNameFromTitle(value, colour) {
  const title = String(value || "").trim();
  const parts = title.split(/\s+[-–—|]\s+/);
  // "Black 1Kg" / "Red 1.75mm 250g": weight and diameter share the tail but are not the colour.
  const tail = parts.length > 1 ? parts[parts.length - 1].replace(/(?:^|\s)\d+(?:[.,]\d+)?\s*(?:kilogram|kilo|kgs?|grams?|gr|g|mm)(?=\s|$)/giu, " ").replace(/\s+/g, " ").trim() : "";
  if (tail && (canonicalColour(tail) || MULTI_COLOUR.test(title))) return { name: tail, head: parts.slice(0, -1).join(" - ").trim() };
  if (MULTI_COLOUR.test(title) && multiColourName(title)) return { name: multiColourName(title), head: "" };
  const row = (TAXONOMY.colours || {})[colour];
  for (const alias of ((row && row.aliases) || []).slice().sort((a, b) => b.length - a.length)) {
    const phrase = String(alias).trim().split(/\s+/).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[\\s_/-]+");
    const m = title.match(new RegExp("(?:^|[^\\p{L}\\p{N}])(" + phrase + ")(?=$|[^\\p{L}\\p{N}])", "iu"));
    if (m) return { name: m[1], head: "" };
  }
  return { name: "", head: "" };
}

// Every colour id the name mentions, resolved as phrases (longest first) so
// "Sky Blue" does not also count as "blue" and "Blue Black Purple" counts as
// three. Returns a sorted list: single-colour spools have exactly one entry.
function coloursFromName(value) {
  const tokens = fold(value).split(" ").filter(Boolean);
  const used = new Array(tokens.length).fill(false);
  const out = [];
  for (const { id, alias } of COLOR_ALIASES) {
    const parts = alias.split(" ").filter(Boolean);
    let placed = false;
    for (let i = 0; i + parts.length <= tokens.length && !placed; i++) {
      let ok = true;
      for (let j = 0; j < parts.length; j++) {
        if (used[i + j] || tokens[i + j] !== parts[j]) { ok = false; break; }
      }
      if (ok) {
        out.push(id);
        for (let j = 0; j < parts.length; j++) used[i + j] = true;
        placed = true;
      }
    }
  }
  return [...new Set(out)].sort();
}

// Spool weight in grams from any text: "1KG", "1,5 kg", "0.25 kg", "250gr", "750 gram", "1.000 gr".
// A dot/comma before exactly three digits in a gram amount is a thousands separator (Turkish "1.000 gr"),
// in a kg amount it is a decimal ("0.250 kg"). Values outside 50 g – 20 kg are part numbers, not weights.
function gramsFromText(value) {
  const re = /(\d+(?:[.,]\d+)?)\s*(kilogram|kilo|kgs?|grams?|gr|g)(?![\p{L}\p{N}])/giu;
  for (const m of String(value || "").matchAll(re)) {
    const kg = /^k/i.test(m[2]);
    const num = !kg && /^\d{1,3}[.,]\d{3}$/.test(m[1]) ? Number(m[1].replace(/[.,]/, "")) : Number(m[1].replace(",", "."));
    const grams = Math.round(num * (kg ? 1000 : 1));
    if (grams >= 50 && grams <= 20000) return grams;
  }
  return 0;
}

function specsFromName(value) {
  const text = String(value || "");
  const grams = gramsFromText(text);
  const diameter = text.match(/(?:\b(?:cap|çap|diameter)\s*[:=]?\s*)?(1[.,]75|2[.,]85|3[.,]00)\s*mm\b/i);
  return {
    weight: grams > 0 ? grams + " g" : "",
    diameter: diameter ? Number(diameter[1].replace(",", ".")).toFixed(2).replace(/\.00$/, ".0") + " mm" : ""
  };
}

function productFormFromName(value) {
  const text = fold(value);
  for (const [form, aliases] of Object.entries(TAXONOMY.productForms || {})) {
    if ((aliases || []).some((alias) => hasPhrase(text, fold(alias)))) return form;
  }
  return "filament";
}

function classifyFilament(product) {
  const name = String(product.name || "").trim();
  const text = fold(name);
  const polymer = pick(fold(product.polymer), POLYMER_ALIASES) || pickFirst(text, POLYMER_ALIASES);
  const explicitVariant = pick(fold(product.variant), VARIANT_ALIASES);
  const foundVariants = new Set(VARIANT_ALIASES.filter((row) => hasPhrase(text, row.alias)).map((row) => row.id));
  const variant = explicitVariant || (foundVariants.has("plus") && foundVariants.has("high-speed")
    ? "plus-high-speed"
    : Object.keys(TAXONOMY.variants).find((id) => foundVariants.has(id)) || "");
  const packaging = pick(fold(product.packaging), PACKAGING_ALIASES) || pick(text, PACKAGING_ALIASES);
  const color = canonicalColour(product.color) || canonicalColour(text);
  const specs = specsFromName(name);
  const diameter = product.diameter ? specsFromName(product.diameter).diameter : specs.diameter;
  const weight = product.weight ? specsFromName(product.weight).weight : specs.weight;
  const brandKey = fold(product.brand).replace(/\s+/g, "-");
  const familyKey = [brandKey, polymer, variant, diameter].join("|");
  const compareKey = [familyKey, color, weight, packaging].join("|");
  const productForm = productFormFromName(name);
  return {
    ...product,
    kind: "filament",
    aisle: "filament",
    productForm,
    classificationRejected: productForm !== "filament",
    polymer,
    variant,
    color,
    weight,
    diameter,
    packaging,
    familyKey,
    compareKey
  };
}

const POLYMERS = Object.keys(TAXONOMY.polymers).map((id) => ({ id }));
const VARIANTS = Object.keys(TAXONOMY.variants).map((id) => ({ id }));
const POLYMER_ORDER = [...Object.keys(TAXONOMY.polymers), "other"];

module.exports = { MULTI_COLOUR, multiColourName, classifyFilament, canonicalColour, colourAgnosticTitle, colourNameFromTitle, coloursFromName, specsFromName, gramsFromText, productFormFromName, POLYMERS, VARIANTS, POLYMER_ORDER };
