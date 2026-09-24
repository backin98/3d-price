// Local host for the 3d Price storefront + online API, running entirely on this PC.
//
// Why this exists: the API is CPU-heavy. Cloudflare Workers Free allows 10 ms of
// CPU per request and /api/hunt measurably needs ~0.4-2 s (86% of requests were
// killed with `exceededCpu`). Running locally has no CPU cap, no quota, and no
// cloud dependency.
//
// Every handler in netlify/functions/ is already a Fetch handler
// (`export default async (req) => Response`), and Node 18+ ships Request/Response
// as globals, so nothing needs adapting: we build a Request, call the handler,
// and write the Response back out.
//
// Storage: lib/netlify-store.cjs is put into "local file store" mode, so the same
// readJSON/writeJSON/readBytes/writeBytes/deleteKey surface is backed by files
// under work/local-store/ instead of Netlify Blobs or Cloudflare KV.
//
// Run:  node scripts/local-server.mjs
// Site: http://127.0.0.1:8890/        Admin: http://127.0.0.1:8890/admin/

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import store from "../lib/netlify-store.cjs";

import admin from "../netlify/functions/admin.mjs";
import auth from "../netlify/functions/auth.mjs";
import hunt from "../netlify/functions/hunt.mjs";
import productImage from "../netlify/functions/product-image.mjs";
import stockPreview from "../netlify/functions/stock-preview.mjs";
import stockRefresh from "../netlify/functions/stock-refresh.mjs";
import worker from "../netlify/functions/worker.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = path.join(ROOT, "public");
const STORE_DIR = path.join(ROOT, "work", "local-store");

// 8890 on purpose: WORKER_PORT (8788) belongs to worker/online-worker.cjs.
const HOST = process.env.SITE_HOST || "127.0.0.1";
const PORT = Number(process.env.SITE_PORT || 8890);

// --- environment ----------------------------------------------------------
// Load .env then .dev.vars, without clobbering anything already set.
function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith("#") || !s.includes("=")) continue;
    const i = s.indexOf("=");
    const key = s.slice(0, i).trim();
    const value = s.slice(i + 1).trim().replace(/^["']|["']$/g, "");
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}
loadEnvFile(path.join(ROOT, ".env"));
loadEnvFile(path.join(ROOT, ".dev.vars"));

// --- storage --------------------------------------------------------------
fs.mkdirSync(STORE_DIR, { recursive: true });
store.setLocalStore(STORE_DIR);

// First run: seed from the local mirrors so the storefront has something to show.
const SEED = [
  ["catalog.json", "data/online-catalog.json"],
  ["baseline.json", "data/online-baseline.json"]
];
for (const [key, rel] of SEED) {
  const dest = path.join(STORE_DIR, key);
  const src = path.join(ROOT, rel);
  if (!fs.existsSync(dest) && fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    console.log(`[seed] ${key} <- ${rel}`);
  }
}

// --- routes ---------------------------------------------------------------
const ROUTES = {
  "/api/admin": admin,
  "/api/auth": auth,
  "/api/hunt": hunt,
  "/api/product-image": productImage,
  "/api/stock-preview": stockPreview,
  "/api/stock-refresh": stockRefresh,
  "/api/worker": worker
};

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml"
};

function resolveStatic(pathname) {
  let clean;
  try {
    clean = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (clean.includes("\0") || clean.split("/").includes("..")) return null;
  const rel = clean.replace(/^\/+/, "");
  const candidates = rel === ""
    ? ["index.html"]
    : [rel, rel + ".html", path.posix.join(rel, "index.html")];
  for (const c of candidates) {
    const full = path.resolve(PUBLIC, c);
    if (!full.startsWith(PUBLIC)) continue; // never escape public/
    try {
      if (fs.statSync(full).isFile()) return full;
    } catch { /* try next */ }
  }
  return null;
}

async function toRequest(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const url = `http://${req.headers.host || `${HOST}:${PORT}`}${req.url}`;
  const init = { method: req.method, headers: req.headers };
  if (body && req.method !== "GET" && req.method !== "HEAD") {
    init.body = body;
    init.duplex = "half";
  }
  return new Request(url, init);
}

async function sendResponse(res, response) {
  const headers = {};
  for (const [key, value] of response.headers) {
    if (key.toLowerCase() !== "set-cookie") headers[key] = value;
  }
  // getSetCookie() preserves multiple Set-Cookie headers (the owner login cookie).
  const cookies = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [];
  if (cookies.length) headers["set-cookie"] = cookies;
  const buf = Buffer.from(await response.arrayBuffer());
  res.writeHead(response.status, headers);
  res.end(buf);
}

const server = http.createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, `http://${req.headers.host || "localhost"}`).pathname;
    let route = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;

    // Netlify Functions compatibility. worker/online-worker.cjs calls
    // `/.netlify/functions/worker`, so map that prefix onto the same handlers
    // as /api/*. This lets the existing worker talk to the local host without
    // changing a single line of the worker or the functions.
    if (route.startsWith("/.netlify/functions/")) {
      route = "/api/" + route.slice("/.netlify/functions/".length);
    }

    if (route.startsWith("/api/")) {
      const handler = ROUTES[route];
      if (!handler) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "Not found", path: pathname }));
        return;
      }
      await sendResponse(res, await handler(await toRequest(req)));
      return;
    }

    const file = resolveStatic(pathname);
    if (!file) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("404 Not Found");
      return;
    }
    res.writeHead(200, {
      "content-type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
      "cache-control": "no-cache"
    });
    fs.createReadStream(file).pipe(res);
  } catch (err) {
    console.error("[error]", req.method, req.url, err);
    if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Local server error", detail: String(err && err.message || err) }));
  }
});

server.listen(PORT, HOST, () => {
  console.log("");
  console.log("  3d Price — local host");
  console.log(`  storefront : http://${HOST}:${PORT}/`);
  console.log(`  admin      : http://${HOST}:${PORT}/admin/`);
  console.log(`  storage    : ${STORE_DIR}`);
  console.log(`  auth ready : ${!!(process.env.OWNER_PASSWORD_HASH && process.env.SESSION_SECRET)}`);
  if (!process.env.OWNER_PASSWORD_HASH) {
    console.log("  ! OWNER_PASSWORD_HASH is unset - admin login will return 401.");
  }
  console.log("");
});
