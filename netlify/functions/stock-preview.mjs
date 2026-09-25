import store from "../../lib/netlify-store.cjs";
import stock from "../../lib/stock-refresh.cjs";
import catalogUnion from "../../lib/catalog-union.cjs";

const { readJSON } = store;
const { checkOfferStock } = stock;
const { collapseByMagellan } = catalogUnion;
const cache = new Map();
const CACHE_MS = 2 * 60 * 1000;

export default async (req) => {
  const ids = new Set((new URL(req.url).searchParams.get("ids") || "").split(",").filter(Boolean).slice(0, 4));
  if (!ids.size) return Response.json({ products: [] });

  const catalog = collapseByMagellan(await readJSON("catalog.json", { products: [], filaments: [] }));
  const products = [...(catalog.products || []), ...(catalog.filaments || [])].filter((p) => ids.has(String(p.id)));
  const targets = products.flatMap((product) => (product.offers || [])
    .filter((offer) => /^https:\/\//i.test(offer.url || ""))
    .sort((a, b) => (Number(a.price) || Infinity) - (Number(b.price) || Infinity))
    .map((offer) => ({ product, offer })));

  const now = Date.now();
  const results = await Promise.all(targets.map(async ({ product, offer }) => {
    const cacheKey = `${offer.url}\n${product.kind || "printer"}\n${offer.vatAdded === true}`;
    let result = cache.get(cacheKey);
    if (!result || now - result.at > CACHE_MS) {
      result = { ...(await checkOfferStock(offer.url, {
        timeoutMs: 2500,
        retries: 0,
        kind: product.kind || "printer",
        vatAdded: offer.vatAdded === true
      })), at: now };
      if (cache.size >= 500) cache.clear();
      cache.set(cacheKey, result);
    }
    return {
      id: product.id,
      url: offer.url,
      status: result.status,
      verified: result.verified === true,
      price: Number.isFinite(result.price) && result.price > 0 ? result.price : undefined,
      priceSource: result.priceSource || undefined
    };
  }));

  return Response.json({ products: results }, { headers: { "cache-control": "no-store" } });
};
