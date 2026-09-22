import store from "../../lib/netlify-store.cjs";
import catalogUnion from "../../lib/catalog-union.cjs";
import search from "../../lib/search-match.cjs";
import boardLib from "../../lib/baseline-board.cjs";

const { readJSON } = store;
const { collapseByMagellan, pricesToTry } = catalogUnion;

// Token search over the row and its offers (see lib/search-match.cjs): a family query finds a
// branched row even when its own name is only a slug.
const { filterSearch } = search;
const { applyBaselineImages } = boardLib;

function filterList(list, q) {
  if (!q) return list || [];
  return filterSearch(list, q);
}

export default async (req) => {
  const q = new URL(req.url).searchParams.get("q")?.trim().toLowerCase() || "";
  const raw = await readJSON("catalog.json", {
    source: { id: "desk", name: "Published catalog" },
    products: [],
    filaments: []
  });
  const catalog = pricesToTry(collapseByMagellan(raw)); // stored prices are already KDV-inclusive
  applyBaselineImages(catalog, await readJSON("baseline.json", { items: [] }));
  const products = filterList(catalog.products, q);
  const filaments = filterList(catalog.filaments, q);
  return Response.json(
    {
      source: catalog.source || { id: "desk", name: "Published catalog" },
      queried: q,
      count: products.length,
      filamentCount: filaments.length,
      products,
      filaments
    },
    { headers: { "cache-control": "no-store" } }
  );
};
