// Cloudflare Worker entry point for the 3d Price online API.
//
// Every Netlify function in netlify/functions/ is already a Fetch handler
// (`export default async (req) => Response`), so there is no adapter layer:
// the router below just forwards the Request straight through.
//
// Route map mirrors the old netlify.toml redirect `/api/* -> /.netlify/functions/:splat`.

import store from "../lib/netlify-store.cjs";

import admin from "../netlify/functions/admin.mjs";
import auth from "../netlify/functions/auth.mjs";
import hunt from "../netlify/functions/hunt.mjs";
import productImage from "../netlify/functions/product-image.mjs";
import stockPreview from "../netlify/functions/stock-preview.mjs";
import stockRefresh from "../netlify/functions/stock-refresh.mjs";
import worker from "../netlify/functions/worker.mjs";

const ROUTES = {
  "/api/admin": admin,
  "/api/auth": auth,
  "/api/hunt": hunt,
  "/api/product-image": productImage,
  "/api/stock-preview": stockPreview,
  "/api/stock-refresh": stockRefresh,
  "/api/worker": worker
};

function notFound(pathname) {
  return new Response(JSON.stringify({ error: "Not found", path: pathname }), {
    status: 404,
    headers: { "content-type": "application/json", "cache-control": "no-store" }
  });
}

export default {
  async fetch(request, env) {
    // KV bindings are only reachable through `env`, but the storage seam
    // (lib/netlify-store.cjs) is CommonJS and cannot import cloudflare:workers.
    // Hand it the live binding for this request. `env` is infrastructure
    // config — identical for every request in an isolate — so this is not
    // request-scoped state and cannot leak between users.
    store.setEnv(env);

    const { pathname } = new URL(request.url);
    const route = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;

    const handler = ROUTES[route];
    if (!handler) return notFound(pathname);

    return handler(request);
  }
};
