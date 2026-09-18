function fold(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/ı/g, "i")
    .replace(/İ/g, "i")
    .replace(/ş/g, "s")
    .replace(/ç/g, "c")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ö/g, "o")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isPreorder(text) {
  return /[öo]n\s*sipari[sş]|pre-?order/i.test(text || "");
}

function brandKey(p) {
  let b = fold(p.brand);
  if (b === "bambu") b = "bambu lab";
  if (b === "original prusa") b = "prusa";
  if (b === "qidi") b = "qidi";
  return b;
}

function listingTokens(p) {
  const brand = brandKey(p);
  let n = fold(String(p.name || "").replace(/\b1000\s*(?:gr|g)\b/gi, "1 kg"));
  if (brand) {
    brand.split(" ").forEach((part) => {
      n = n.replace(new RegExp("(^| )" + part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "( |$)", "g"), " ");
    });
  }
  n = n
    .replace(/\bon siparis\b/g, " ")
    .replace(/\bpre ?order\b/g, " ")
    .replace(/\b3d\s*(yazici|printer)\b/g, " ")
    .replace(/\bfilament\b/g, " ")
    .replace(/\brefill\b/g, " ")
    .replace(/\breusable\b/g, " ")
    .replace(/\bspool\b/g, " ")
    .replace(/\b1 kg\b/g, " ")
    .replace(/\b1kg\b/g, " ")
    .replace(/\b1 75 mm\b/g, " ")
    .replace(/\bstoktan\b/g, " ")
    .replace(/\bfiyat(i ve ozellikleri|i)?\b/g, " ")
    .replace(/\binceleme\b/g, " ")
    .replace(/\b202[0-9]\b/g, " ")
    .replace(/\bwith\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return n
    .split(" ")
    .filter((t) => t.length > 1)
    .sort()
    .join(" ");
}

function printerMatchKey(p) {
  const name = fold(p.name);
  if (brandKey(p) === "bambu lab" && /\bp1s\b/.test(name)) {
    const without = /\bams\s*(?:siz|yok|haric)\b|\bwithout ams\b|\bno ams\b/.test(name);
    const generation = without ? "plain"
      : /\bams\s*2\b/.test(name) ? "ams2"
      : /\bams\s*ht\b/.test(name) ? "ams-ht"
      : /\bams\s*lite\b/.test(name) ? "ams-lite"
      : /\bams\b|\bcombo\b/.test(name) ? "ams1" : "plain";
    const baseName = name
      .replace(/\b(?:without|no) ams\b|\bams\s*(?:siz|yok|haric)\b/g, " ")
      .replace(/\bams\s*(?:2\s*(?:pro)?|1|ht|lite)?\b/g, " ")
      .replace(/\b(?:combo|uniteli|unitesi|ile)\b/g, " ");
    // Keep other bundle contents (buffer, dual units, etc.) in the match key.
    return "p|bambu lab|" + listingTokens({ ...p, name: baseName }) + "|" + generation;
  }
  const t = listingTokens(p);
  if (!t) return null;
  const amsGeneration = (name.match(/\bams\s*(2|1|ht|lite)\b/) || [])[1] || "";
  return "p|" + brandKey(p) + "|" + t + (amsGeneration ? "|ams-" + amsGeneration : "");
}

function filamentMatchKey(p) {
  const t = listingTokens(p);
  if (!t) return null;
  // Family grouping is broader than price matching: retain physical SKU specs.
  return "f|" + brandKey(p) + "|" + (p.polymer || "") + "|" + t + "|" +
    [p.packaging || "unspecified", p.weight || "", p.diameter || ""].join("|");
}

function mergeGroup(list, keyFn) {
  const map = new Map();
  const leftover = [];
  list.forEach((p) => {
    // Keep each compared retailer's thumbnail instead of discarding it on merge.
    p = { ...p, offers: (p.offers || []).map((offer) => ({
      ...offer, image: offer.image || p.image || ""
    })) };
    const k = keyFn(p);
    if (!k) {
      leftover.push(p);
      return;
    }
    if (!map.has(k)) {
      map.set(k, {
        ...p,
        matchKey: k,
        offers: (p.offers || []).slice()
      });
      return;
    }
    const dest = map.get(k);
    const incomingStore = ((p.offers || [])[0] || {}).store;
    if (incomingStore && dest.offers.some((x) => x.store === incomingStore)) {
      leftover.push(p);
      return;
    }
    (p.offers || []).forEach((o) => {
      if (!dest.offers.some((x) => x.store === o.store && x.url === o.url)) dest.offers.push(o);
    });
    dest.offers.sort((a, b) => a.price - b.price);
    if (p.preorder) dest.preorder = dest.preorder || p.preorder;
    if (p.sourceId === "rhino") {
      dest.name = p.name;
      dest.id = p.id;
      if (p.image) dest.image = p.image;
    } else if (!dest.image && p.image) dest.image = p.image;
    dest.source = dest.offers.map((o) => o.store).join(" · ");
  });
  return leftover.concat(Array.from(map.values()));
}

function mergeSimilar(printers, filaments) {
  // These two bundle alternatives share one browsing card by explicit request.
  const bundleNames = new Set([
    "elegoo centauri carbon 2 combo 3d yazici beta filament bundle",
    "elegoo centauri carbon 2 combo 3d yazici r3d kurutucu bundle"
  ]);
  const bundles = printers.filter(p => bundleNames.has(fold(p.name)));
  const remaining = printers.filter(p => !bundleNames.has(fold(p.name)));
  if (bundles.length) {
    const offers = bundles.flatMap(p => p.offers.map(o => ({ ...o, image: o.image || p.image, bundleName: p.name })));
    offers.sort((a, b) => a.price - b.price);
    remaining.push({ ...bundles[0], name: "ELEGOO Centauri Carbon 2 Combo — Bundles", bundleOptions: true,
      image: offers[0].image, offers });
  }
  return {
    products: mergeGroup(remaining, printerMatchKey),
    filaments: mergeGroup(filaments, filamentMatchKey)
  };
}

module.exports = { mergeSimilar, printerMatchKey, filamentMatchKey, isPreorder };
