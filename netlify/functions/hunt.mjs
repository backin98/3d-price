import store from "../../lib/netlify-store.cjs";
import catalogUnion from "../../lib/catalog-union.cjs";
import search from "../../lib/search-match.cjs";
import boardLib from "../../lib/baseline-board.cjs";
import merchLib from "../../lib/storefront-merch.cjs";
import productType from "../../lib/product-type.cjs";

const { readJSON } = store;
const { collapseByMagellan, pricesToTry } = catalogUnion;

// Token search over the row and its offers (see lib/search-match.cjs): a family query finds a
// branched row even when its own name is only a slug.
const { filterSearch } = search;
const { applyBaselineImages } = boardLib;
const { storefrontMerch } = merchLib;
const { classifyProductType } = productType;

// The shop is printers and filament. Rows published before parts were told apart from printers
// (hotends, fans, upgrade kits and AMS units on the printer shelf) stay in the admin catalog, where
// they are flagged, but never reach a shelf. "other" is an unknown brand, not a part: it stays.
function onShelf(row, shelf) {
  const type = classifyProductType(row && row.name, row && row.brand);
  return type === shelf || type === "other";
}

function filterList(list, q) {
  if (!q) return list || [];
  return filterSearch(list, q);
}

// Collapsing the catalog is quadratic and costs seconds of CPU per call, yet its inputs change
// only when the admin or the worker saves. A warm instance keeps its last answer, keyed by the
// exact stored content, so a repeat visit skips the work and an edit is still picked up on the
// very next request. Nothing downstream mutates the cached catalog (filterSearch only filters).
let memo = { key: "", catalog: null };

function servedCatalog(raw, baseline) {
  const key = JSON.stringify([raw, baseline]);
  if (memo.key !== key || !memo.catalog) {
    const catalog = pricesToTry(collapseByMagellan(raw)); // stored prices are already KDV-inclusive
    applyBaselineImages(catalog, baseline);
    catalog.products = (catalog.products || []).filter((p) => onShelf(p, "printer"));
    catalog.filaments = (catalog.filaments || []).filter((p) => onShelf(p, "filament"));
    memo = { key, catalog };
  }
  return memo.catalog;
}

export default async (req) => {
  const q = new URL(req.url).searchParams.get("q")?.trim().toLowerCase() || "";
  const [raw, baseline, desk] = await Promise.all([
    readJSON("catalog.json", {
      source: { id: "desk", name: "Published catalog" },
      products: [],
      filaments: []
    }),
    readJSON("baseline.json", { items: [] }),
    readJSON("desk.json", {})
  ]);
  const catalog = servedCatalog(raw, baseline);
  const products = filterList(catalog.products, q);
  const filaments = filterList(catalog.filaments, q);
  return Response.json(
    {
      source: catalog.source || { id: "desk", name: "Published catalog" },
      queried: q,
      count: products.length,
      filamentCount: filaments.length,
      products,
      filaments,
      // Storefront banners, pins and shop names from the admin — only the public fields.
      ...storefrontMerch(desk)
    },
    { headers: { "cache-control": "no-store" } }
  );
};
