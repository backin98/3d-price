import store from "../../lib/netlify-store.cjs";
import catalogUnion from "../../lib/catalog-union.cjs";

const { readJSON } = store;
const { collapseByMagellan, pricesToTry } = catalogUnion;

function filterList(list, q) {
  if (!q) return list || [];
  return (list || []).filter((p) =>
    [p.name, p.brand, p.polymer, p.variant, p.color, p.unit]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(q)
  );
}

export default async (req) => {
  const q = new URL(req.url).searchParams.get("q")?.trim().toLowerCase() || "";
  const raw = await readJSON("catalog.json", {
    source: { id: "desk", name: "Published catalog" },
    products: [],
    filaments: []
  });
  const catalog = pricesToTry(collapseByMagellan(raw)); // stored prices are already KDV-inclusive
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
