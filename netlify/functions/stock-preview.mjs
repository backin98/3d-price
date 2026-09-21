import store from "../../lib/netlify-store.cjs";
import stock from "../../lib/stock-refresh.cjs";

const { readJSON } = store;
const { checkOfferStock } = stock;
const cache = new Map();
const CACHE_MS = 2 * 60 * 1000;

export default async (req) => {
  const ids = new Set((new URL(req.url).searchParams.get("ids") || "").split(",").filter(Boolean).slice(0, 4));
  if (!ids.size) return Response.json({ products: [] });

  const catalog = await readJSON("catalog.json", { products: [], filaments: [] });
  const products = [...(catalog.products || []), ...(catalog.filaments || [])].filter((p) => ids.has(String(p.id)));
  const targets = products.flatMap((product) => (product.offers || [])
    .filter((offer) => /^https:\/\//i.test(offer.url || ""))
    .sort((a, b) => (Number(a.price) || Infinity) - (Number(b.price) || Infinity))
    .slice(0, 3)
    .map((offer) => ({ product, offer }))).slice(0, 12);

  const now = Date.now();
  const results = await Promise.all(targets.map(async ({ product, offer }) => {
    let result = cache.get(offer.url);
    if (!result || now - result.at > CACHE_MS) {
      result = { ...(await checkOfferStock(offer.url, { timeoutMs: 2500, retries: 0 })), at: now };
      if (cache.size >= 500) cache.clear();
      cache.set(offer.url, result);
    }
    return { id: product.id, url: offer.url, status: result.status, verified: result.verified === true };
  }));

  return Response.json({ products: results }, { headers: { "cache-control": "no-store" } });
};
