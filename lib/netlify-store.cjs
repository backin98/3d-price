// Shared Netlify Blobs persistence WITHOUT depending on the external
// @netlify/blobs package at runtime. Netlify Functions v2 injects
// globalThis.netlifyBlobsContext (or NETLIFY_BLOBS_CONTEXT); this module
// talks directly to the same edge/API endpoint using that context.

const STORE_NAME = "3d-price";
const STORE_PREFIX = "site:";

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

async function readJSON(key, fallback = null) {
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
  const res = await request(key, { method: "PUT", body, strong: true });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error("Blob write failed (" + res.status + "): " + text.slice(0, 300));
  }
  return value;
}

async function readBytes(key) {
  try {
    const res = await request(key, { method: "GET", strong: true });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch (_) {
    return null;
  }
}

async function writeBytes(key, value) {
  const res = await request(key, { method: "PUT", body: value, strong: true });
  if (!res.ok) throw new Error("Blob write failed (" + res.status + ")");
  return value;
}

async function deleteKey(key) {
  try {
    await request(key, { method: "DELETE", strong: true });
  } catch (_) {
    // Ignore missing keys
  }
}

module.exports = { STORE_NAME, readJSON, writeJSON, readBytes, writeBytes, deleteKey, blobsContext };
