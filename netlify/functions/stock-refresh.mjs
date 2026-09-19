import store from "../../lib/netlify-store.cjs";
import auth from "../../lib/netlify-auth.cjs";
import stock from "../../lib/stock-refresh.cjs";

const { readJSON, writeJSON } = store;
const { ownerFromHeaders } = auth;
const { refreshStock, planStockChecks } = stock;

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" }
  });

// Re-checks stock on the offers we already link to, so vendors that ran out leave the
// comparison. Owner only, budgeted so the request finishes inside the function limit: press
// it again to continue with the next batch (it always starts at the oldest check).
export default async (req) => {
  const url = new URL(req.url);
  const headers = Object.fromEntries(req.headers);
  if (!ownerFromHeaders(headers)) return json(401, { error: "Unauthorized" });

  const dry = url.searchParams.get("dry") === "1";
  const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit")) || 25, 100));
  const staleHours = Number(url.searchParams.get("staleHours")) || 12;
  const budgetMs = Math.max(2000, Math.min(Number(url.searchParams.get("budgetMs")) || 22000, 50000));

  const catalog = await readJSON("catalog.json", null);
  if (!catalog) return json(404, { error: "No published catalog yet" });

  if (dry) {
    const plan = planStockChecks(catalog, { staleHours, limit });
    return json(200, { ok: true, dry: true, stale: plan.total, wouldCheck: plan.due });
  }

  const started = Date.now();
  const { catalog: next, summary, results } = await refreshStock({ catalog, limit, staleHours, budgetMs });
  if (summary.checked) await writeJSON("catalog.json", next);
  console.log(
    "[stock] checked " + summary.checked + "/" + summary.stale + " stale offers in " + (Date.now() - started) + "ms — " +
      summary.changed + " changed, " + summary.outOfStock + " newly out of stock, " + summary.unverified + " unverified" +
      (summary.skipped ? ", " + summary.skipped + " left for the next press" : "")
  );

  return json(200, {
    ok: true,
    model: null,
    ms: Date.now() - started,
    summary,
    // Only what changed, so the admin can show something useful without a wall of rows.
    changes: results.filter((r) => r.before !== r.after).slice(0, 40)
  });
};
