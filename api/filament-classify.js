/* Polymer first, then subtype, then leftover is color. Order matters. */

const POLYMERS = [
  { id: "peba", re: /\bpeba\b/i },
  { id: "plabs", re: /\bpla[\s-]*abs\b|\bplabs\b/i },
  { id: "petg", re: /\bpet[\s-]*g\b|\bpetg\b/i },
  { id: "peek", re: /\bpeek\b/i },
  { id: "pekk", re: /\bpekk\b|\bpoek\b/i },
  { id: "pek", re: /\bpek\b/i },
  { id: "pps", re: /\bpps\b/i },
  { id: "ppa", re: /\bppa\b/i },
  { id: "pa", re: /\bpa[\s-]?cf\b|\bpa[\s-]?\d+\b|\bnaylon\b|\bnylon\b|\bpa6\b|\bpa12\b|\bpa\b/i },
  { id: "pc", re: /\bpolycarbonate\b|\bpolikarbonat\b|\bpolikarbon\b|\bpc[\s-]?cf\b|\bpc\b/i },
  { id: "asa", re: /\basa\b/i },
  { id: "abs", re: /\babs\b/i },
  { id: "tpu", re: /\btpu\b|\btpe\b/i },
  { id: "pva", re: /\bpva\b/i },
  { id: "hips", re: /\bhips\b/i },
  { id: "pet", re: /\bpet\b/i },
  { id: "pla", re: /\bpla\b/i },
  { id: "pp", re: /\bpp\b/i }
];

const VARIANTS = [
  { id: "combo", re: /\bcombo\b|\bpack\b|\bseti\b/i },
  { id: "cf", re: /\bcf\b|\bcarbon\s*fiber\b|\bkarbon\b/i },
  { id: "gf", re: /\bgf\b|\bglass\s*fiber\b|\bcam\s*elyaf/i },
  { id: "glow", re: /\bglow\b|\bphospho|\btwinkling\b|\bglitter\b|\bsparkle\b/i },
  { id: "marble", re: /\bmarble\b|\bmermer\b/i },
  { id: "wood", re: /\bwood\b|\bah[sş]ap\b/i },
  { id: "tough", re: /\btough\b/i },
  { id: "semiflex", re: /\bsemiflex\b|\bsemi[\s-]*flex\b/i },
  { id: "rainbow", re: /\brainbow\b|\bgradient\b|\bgranient\b|\bmystic\b|\bdual\s*renk\b|\b3\s*renk/i },
  { id: "silk", re: /\bsilk\b|\bipek\b/i },
  { id: "plus-hs", re: /(?:plus|\+)\s*.*(?:high\s*speed|\bhs\b)|premium\s*high\s*speed/i },
  { id: "plus", re: /\bplus\b|pla\s*\+|petg\s*\+|abs\s*\+/i },
  { id: "rapid", re: /\brapid\b|\bhyper\b|\bhigh\s*speed\b|\bhigh\s*flow\b|\bhf\b|\bhs\b/i },
  { id: "pure", re: /\bpure\b/i },
  { id: "matte", re: /\bmatte\b|\bmat\b/i },
  { id: "basic", re: /\bbasic\b/i }
];

const POLYMER_ORDER = [
  "pla",
  "plabs",
  "petg",
  "pet",
  "abs",
  "asa",
  "tpu",
  "pc",
  "pa",
  "ppa",
  "pps",
  "pekk",
  "peek",
  "pek",
  "pva",
  "hips",
  "pp",
  "other"
];

function pickFirst(text, list) {
  for (const item of list) {
    if (item.re.test(text)) return item.id;
  }
  return null;
}

function stripSpecs(s) {
  return String(s || "")
    .replace(/\b1[.,]75\s*mm\b/gi, " ")
    .replace(/\b2[.,]85\s*mm\b/gi, " ")
    .replace(/\b\d+([.,]\d+)?\s*(kg|gr|g)\b/gi, " ")
    .replace(/\(\s*\)/g, " ")
    .replace(/\s*[-–—]\s*$/g, "")
    .replace(/^\s*[-–—]\s*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function colorFromName(name, brand) {
  const parts = String(name || "")
    .split(/\s+[-–—]\s+/)
    .map(stripSpecs)
    .filter(Boolean);
  if (parts.length >= 2) {
    const last = parts[parts.length - 1]
      .replace(/\bfilament\b/gi, " ")
      .replace(/\brefill\b/gi, " ")
      .replace(/\breusable\b/gi, " ")
      .replace(/\bspool\b/gi, " ")
      .replace(/\bwith\b/gi, " ")
      .replace(/\bbambu\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (last && !/^(filament|pla|petg|abs|asa|tpu|pc|pa)$/i.test(last)) return stripSpecs(last);
  }

  let rest = stripSpecs(parts[0] || name || "");
  if (brand) {
    rest = rest.replace(new RegExp("^" + brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*", "i"), "");
  }
  rest = stripSpecs(rest.replace(/\b(filament|refill|reusable|spool|with)\b/gi, " "));

  const tokens = rest.split(" ").filter(Boolean);
  const skip =
    /^(pla|plabs|petg|pet|abs|asa|tpu|pc|pa|pa6|pa12|plus|premium|high|speed|hs|hf|hyper|silk|ipek|matte|mat|basic|rapid|cf|gf|combo|series|serisi|easy|naylon|nylon|95a|wood|twinkling|refill|reusable|spool|with|pure)$/i;
  const colorBits = [];
  for (let i = tokens.length - 1; i >= 0; i--) {
    const tok = tokens[i].replace(/\+$/, "");
    if (skip.test(tok) || /^(peba|\d{2,3}[ad])$/i.test(tok)) break;
    colorBits.unshift(tokens[i]);
  }
  return colorBits.join(" ").trim();
}

function specsFromName(name) {
  const text = String(name || "");
  const w = text.match(/(\d+(?:[.,]\d+)?)\s*(kg|gr|g)\b/i);
  const d = text.match(/(1[.,]75|2[.,]85)\s*mm/i);
  return {
    weight: w ? (() => {
      const grams = Number(w[1].replace(",", ".")) * (/^kg$/i.test(w[2]) ? 1000 : 1);
      return grams >= 1000 ? (grams / 1000) + " kg" : grams + " gr";
    })() : "",
    diameter: d ? d[1].replace(",", ".") + " mm" : "1.75 mm"
  };
}

function tidyName(name) {
  return String(name || "")
    .replace(/\b(basic|matte|silk\+|silk|plus|pure|hf|cf|gf)\s*-\s*/gi, "$1 - ")
    .replace(/-\s*with\b/gi, " with ");
}

function classifyFilament(product) {
  const name = tidyName(product.name || "");
  const brand = product.brand || "";
  const parts = name.split(/\s+[-–—]\s+/);
  const material = parts.length >= 2 ? parts.slice(0, -1).join(" ") : name;
  const hay = (brand + " " + material).trim();
  let polymer = pickFirst(hay, POLYMERS);
  let variant = pickFirst(hay, VARIANTS) || "standard";
  if (!polymer && (variant === "wood" || /twinkling|glitter|sparkle/i.test(hay))) {
    polymer = "pla";
  }
  if (!polymer) polymer = "other";
  if (/twinkling|glitter|sparkle/i.test(hay) && variant === "standard") variant = "glow";
  const color = colorFromName(name, brand);
  const specs = specsFromName(product.name || "");
  const brandKey = (product.brand || "unknown").toLowerCase().replace(/\s+/g, "-");
  // Retailer-independent browsing family. Color and packaging remain SKU options,
  // not separate material subtypes; never assume refill and spool are equivalent.
  const isMetatech = product.sourceId === "metatech" || product.source === "Metatech"
    || (product.offers || []).some((offer) => /^metatech$/i.test(offer.store || ""));
  // Metatech's unlabeled packaging means with spool; explicit refill wins.
  const packaging = /\brefill\b|makaras[iı]z/i.test(product.name || "") ? "refill"
    : /\bspool\b|makaral[iı]/i.test(product.name || "") || isMetatech ? "spool" : "unspecified";
  const familyKey = brandKey + "|" + polymer + "|" + variant;
  return {
    ...product,
    kind: "filament",
    aisle: "filament",
    polymer,
    variant,
    color: color || "",
    weight: specs.weight,
    diameter: specs.diameter,
    packaging,
    familyKey,
    compareKey: familyKey
  };
}

module.exports = { classifyFilament, POLYMERS, VARIANTS, POLYMER_ORDER };
