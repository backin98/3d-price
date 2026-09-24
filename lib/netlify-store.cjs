// Shared persistence seam for the online 3d Price API.
//
// Three backends behind one five-function surface:
//
//   • Local (scripts/local-server.mjs) — files under a directory on this PC. Used
//     when the API is hosted locally, where there is no CPU cap or quota.
//   • Cloudflare Workers — the KV namespace bound as `STORE`. Bindings are only
//     reachable through the `env` object, and this file is CommonJS (so it cannot
//     `import { env } from "cloudflare:workers"`), therefore the Worker entry
//     point hands over the live binding with setEnv() on every request.
//   • Netlify Functions v2 — Netlify Blobs, using the context Netlify injects
//     (globalThis.netlifyBlobsContext or NETLIFY_BLOBS_CONTEXT) and talking to
//     the edge/API endpoint directly, without the @netlify/blobs package.
//
// Precedence: local -> Cloudflare -> Netlify. Only one is configured at a time,
// so the later paths stay intact as fallbacks.

const nodeFs = require("node:fs");
const nodePath = require("node:path");

const STORE_NAME = "3d-price";
const STORE_PREFIX = "site:";
const CF_BINDING = "STORE";
const CF_CACHE_TTL = 30;

// --- Local file store backend ---------------------------------------------

let localDir = null;

function setLocalStore(dir) {
  localDir = dir;
}

// Keys look like "catalog.json" or "product-images/abc.jpg". Preserve that shape
// on disk, but sanitise each segment so a key can never escape the store dir.
function localFile(key) {
  if (!localDir) return null;
  const root = nodePath.resolve(localDir);
  const rel = String(key)
    .split("/")
    .map((s) => s.replace(/[^A-Za-z0-9._-]/g, "_"))
    .join(nodePath.sep);
  const full = nodePath.resolve(root, rel);
  return full.startsWith(root) ? full : null;
}

// --- Cloudflare KV backend -------------------------------------------------

let cfEnv = null;

// Called once per request by src/index.js with the Worker's `env`.
function setEnv(env) {
  cfEnv = env;
}

function kv() {
  return (cfEnv && cfEnv[CF_BINDING]) || null;
}

// --- Netlify Blobs backend (behaviour unchanged from the original) ---------

function blobsContext() {
  const raw =
    (typeof globalThis !== "undefined" && globalThis.netlifyBlobsContext) ||
    process.env.NETLIFY_BLOBS_CONTEXT;
  if (!raw) {
    const err = new Error("Netlify Blobs environment is not configured");
    err.name = "MissingBlobsEnvironmentError";
    throw err;
  }
  return JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
}

function encodeKey(key) {
  return encodeURIComponent(String(key));
}

async function request(key, { method = "GET", body, strong = true } = {}) {
  const ctx = blobsContext();
  const siteID = ctx.siteID;
  const token = ctx.token;
  if (!siteID || !token) {
    const err = new Error("Netlify Blobs context is missing siteID/token");
    err.name = "MissingBlobsEnvironmentError";
    throw err;
  }

  const path = `/${siteID}/${STORE_PREFIX}${STORE_NAME}${key ? "/" + encodeKey(key) : ""}`;
  const headers = { authorization: `Bearer ${token}` };
  const edgeURL = strong && ctx.uncachedEdgeURL ? ctx.uncachedEdgeURL : ctx.edgeURL;

  if (edgeURL) {
    const url = new URL(path, edgeURL);
    if (body !== undefined) headers["content-type"] = "application/octet-stream";
    if (method === "PUT") headers["cache-control"] = "max-age=0, stale-while-revalidate=60";
    const res = await fetch(url.toString(), {
      method,
      headers,
      body: body === undefined ? undefined : body
    });
    return res;
  }

  // API fallback (used outside production Functions v2): Blobs API requires a
  // signed URL for reads/writes of an object.
  const apiBase = ctx.apiURL || "https://api.netlify.com";
  const apiURL = new URL(`/api/v1/blobs${path}`, apiBase);
  if (method === "DELETE" || method === "HEAD") {
    return fetch(apiURL.toString(), { method, headers });
  }
  const signed = await fetch(apiURL.toString(), {
    method,
    headers: { ...headers, accept: "application/json;type=signed-url" }
  });
  if (!signed.ok) {
    const err = new Error("Netlify Blobs signed URL request failed: HTTP " + signed.status);
    err.status = signed.status;
    throw err;
  }
  const { url: signedURL } = await signed.json();
  const userHeaders = {};
  if (body !== undefined) userHeaders["content-type"] = "application/octet-stream";
  return fetch(signedURL, { method, headers: userHeaders, body: body === undefined ? undefined : body });
}

// --- public surface -------------------------------------------------------

async function readJSON(key, fallback = null) {
  const file = localFile(key);
  if (file) {
    try {
      return JSON.parse(nodeFs.readFileSync(file, "utf8"));
    } catch (_) {
      return fallback;
    }
  }

  const ns = kv();
  if (ns) {
    try {
      const value = await ns.get(String(key), { type: "json", cacheTtl: CF_CACHE_TTL });
      return value === null || value === undefined ? fallback : value;
    } catch (_) {
      return fallback;
    }
  }
  try {
    const res = await request(key, { method: "GET", strong: true });
    if (res.status === 404) return fallback;
    if (!res.ok) return fallback;
    return await res.json();
  } catch (_) {
    return fallback;
  }
}

// Catalog-shaped blobs are price-checked on the way out, in one place: an offer whose number
// cannot be real (over the cap for its currency, or ten times the rest of its row) is stamped
// priceSuspect so the storefront never lets it win best price. Nothing else is touched.
const { flagPriceOutliers } = require("./parse-money.cjs");
const PRICE_CHECKED_KEYS = new Set(["catalog.json", "candidate.json"]);

function checked(key, value) {
  if (!PRICE_CHECKED_KEYS.has(String(key))) return value;
  if (!value || (!value.products && !value.filaments)) return value;
  try {
    flagPriceOutliers([...(value.products || []), ...(value.filaments || [])]);
  } catch (_) {
    /* never let a price check block a save */
  }
  return value;
}

async function writeJSON(key, value) {
  const body = JSON.stringify(checked(key, value));

  const file = localFile(key);
  if (file) {
    nodeFs.mkdirSync(nodePath.dirname(file), { recursive: true });
    nodeFs.writeFileSync(file, body);
    return value;
  }

  const ns = kv();
  if (ns) {
    await ns.put(String(key), body);
    return value;
  }

  const res = await request(key, { method: "PUT", body, strong: true });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error("Blob write failed (" + res.status + "): " + text.slice(0, 300));
  }
  return value;
}

async function readBytes(key) {
  const file = localFile(key);
  if (file) {
    try {
      return nodeFs.readFileSync(file);
    } catch (_) {
      return null;
    }
  }

  const ns = kv();
  if (ns) {
    try {
      const buf = await ns.get(String(key), { type: "arrayBuffer" });
      return buf === null || buf === undefined ? null : Buffer.from(buf);
    } catch (_) {
      return null;
    }
  }
  try {
    const res = await request(key, { method: "GET", strong: true });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch (_) {
    return null;
  }
}

async function writeBytes(key, value) {
  const file = localFile(key);
  if (file) {
    nodeFs.mkdirSync(nodePath.dirname(file), { recursive: true });
    nodeFs.writeFileSync(file, value);
    return value;
  }

  const ns = kv();
  if (ns) {
    await ns.put(String(key), value);
    return value;
  }
  const res = await request(key, { method: "PUT", body: value, strong: true });
  if (!res.ok) throw new Error("Blob write failed (" + res.status + ")");
  return value;
}

async function deleteKey(key) {
  const file = localFile(key);
  if (file) {
    try {
      nodeFs.unlinkSync(file);
    } catch (_) {
      // Ignore missing keys
    }
    return;
  }

  const ns = kv();
  if (ns) {
    try {
      await ns.delete(String(key));
    } catch (_) {
      // Ignore missing keys
    }
    return;
  }
  try {
    await request(key, { method: "DELETE", strong: true });
  } catch (_) {
    // Ignore missing keys
  }
}

module.exports = {
  STORE_NAME,
  setEnv,
  setLocalStore,
  readJSON,
  writeJSON,
  readBytes,
  writeBytes,
  deleteKey,
  blobsContext
};
