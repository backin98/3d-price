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

function canonicalColour(value) {
  return pick(fold(value), COLOR_ALIASES);
}

function specsFromName(value) {
  const text = String(value || "");
  const weight = text.match(/(\d+(?:[.,]\d+)?)\s*(kg|kilogram|g|gr|gram)\b/i);
  const diameter = text.match(/(?:\b(?:cap|çap|diameter)\s*[:=]?\s*)?(1[.,]75|2[.,]85|3[.,]00)\s*mm\b/i);
  const grams = weight ? Math.round(Number(weight[1].replace(",", ".")) * (/^(kg|kilogram)$/i.test(weight[2]) ? 1000 : 1)) : 0;
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
  const polymer = pick(fold(product.polymer), POLYMER_ALIASES) || pick(text, POLYMER_ALIASES);
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

module.exports = { classifyFilament, canonicalColour, specsFromName, productFormFromName, POLYMERS, VARIANTS, POLYMER_ORDER };
