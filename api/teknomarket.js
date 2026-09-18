const BASE = "https://www.3dteknomarket.com";
const STORE = "3D Teknomarket";

function parseProducts(products, kind) {
  return products.flatMap((p) => {
    const brands = { "beta filament": "Beta", "r3d filament": "R3D", "elegoo": "Elegoo", "flashforge": "Flashforge", "bambu lab": "Bambu Lab" };
    const brand = brands[String(p.vendor || "").toLowerCase()] || p.vendor || "";
    return (p.variants || []).flatMap((v) => {
      const price = Number(v.price);
      if (!v.available || !Number.isFinite(price) || price <= 0) return [];
      const option = v.title && v.title !== "Default Title" ? v.title : "";
      const name = p.title + (option ? " - " + option : "");
      const url = BASE + "/products/" + p.handle + "?variant=" + v.id;
      const image = (v.featured_image || {}).src || (p.images || []).find(i => (i.variant_ids || []).includes(v.id))?.src || p.images?.[0]?.src || "";
      const was = Number(v.compare_at_price);
      const aisle = kind === "filament" ? "filament"
        : /\bams\b/i.test(name) && !/combo|yaz[iı]c[iı]|printer/i.test(name) ? "renk-modulu" : "fdm";
      return [{ id: "tekno-" + v.id, sourceId: "teknomarket", source: STORE,
        kind, aisle, name, brand, unit: brand, image, url,
        currency: { code: "TRY", symbol: "TL", position: "after", decimals: 2 },
        offers: [{ store: STORE, price, was: was > price ? was : undefined, km: null, url, image }]
      }];
    });
  });
}

async function collection(handle, kind) {
  const items = new Map();
  for (let page = 1; page <= 20; page++) {
    const response = await fetch(`${BASE}/collections/${handle}/products.json?limit=250&page=${page}`, {
      headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new Error("3D Teknomarket HTTP " + response.status);
    const { products } = await response.json();
    if (!Array.isArray(products)) throw new Error("Invalid 3D Teknomarket feed");
    parseProducts(products, kind).forEach(p => items.set(p.id, p));
    if (products.length < 250) return [...items.values()];
  }
  throw new Error("3D Teknomarket pagination exceeded limit");
}

async function huntTeknomarket(kind) {
  const handles = kind === "printer" ? ["fdm-yazicilar"] : ["filament-markalarimiz", "filament-turleri"];
  const results = await Promise.allSettled(handles.map(h => collection(h, kind)));
  const good = results.filter(r => r.status === "fulfilled");
  if (!good.length) throw results[0].reason;
  return [...new Map(good.flatMap(r => r.value).map(p => [p.id, p])).values()];
}

module.exports = { huntTeknomarket, parseProducts };
