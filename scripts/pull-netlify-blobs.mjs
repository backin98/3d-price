// Pull every key from the Netlify Blobs store into the local file store.
//
// Why this exists: the local host was seeded from disk mirrors, which only ever
// covered catalog.json and baseline.json. Everything else — desk.json (shops),
// jobs.json, candidate.json, baseline-recommendations.json, heartbeat.json,
// last-publish.json, backups/* and product-images/* — still lives in Netlify
// Blobs. The account being over quota affects *serving*, not the Blobs API.
//
// Auth: create a personal access token at
//   Netlify -> User settings -> Applications -> Personal access tokens
// then add it to .env (gitignored) as:
//   NETLIFY_TOKEN=nfp_xxxxxxxxxxxx
//
// Usage:  npm run pull-blobs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEST = path.join(ROOT, "work", "local-store");

// Matches STORE_PREFIX + STORE_NAME in lib/netlify-store.cjs.
const STORE_NAME = "site:3d-price";
const API = "https://api.netlify.com/api/v1/blobs";

// --- env ------------------------------------------------------------------
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

// Fall back to the token the Netlify CLI already stored, so this works without
// setting NETLIFY_TOKEN by hand once `netlify login` has been run.
function netlifyCliToken() {
  const candidates = [
    process.env.APPDATA && path.join(process.env.APPDATA, "netlify", "Config", "config.json"),
    path.join(process.env.HOME || "", "AppData", "Roaming", "netlify", "Config", "config.json"),
    path.join(process.env.HOME || "", ".netlify", "config.json")
  ].filter(Boolean);
  for (const file of candidates) {
    try {
      const cfg = JSON.parse(fs.readFileSync(file, "utf8"));
      for (const user of Object.values(cfg.users || {})) {
        const token = user && user.auth && user.auth.token;
        if (token) return token;
      }
    } catch { /* try the next location */ }
  }
  return "";
}

const TOKEN = process.env.NETLIFY_TOKEN || process.env.NETLIFY_AUTH_TOKEN || netlifyCliToken();

let SITE_ID = process.env.NETLIFY_SITE_ID || "";
if (!SITE_ID) {
  try {
    SITE_ID = JSON.parse(fs.readFileSync(path.join(ROOT, ".netlify", "state.json"), "utf8")).siteId || "";
  } catch { /* fall through to the error below */ }
}

if (!TOKEN) {
  console.error("No Netlify token. Add NETLIFY_TOKEN=... to .env (see the header of this file).");
  process.exit(1);
}
if (!SITE_ID) {
  console.error("No site id. Set NETLIFY_SITE_ID or check .netlify/state.json.");
  process.exit(1);
}

const auth = { Authorization: `Bearer ${TOKEN}` };
const storeUrl = `${API}/${SITE_ID}/${encodeURIComponent(STORE_NAME)}`;

// --- key listing (paginates, recurses into pseudo-directories) -------------
async function listAll(prefix = "") {
  const keys = [];
  let cursor;
  do {
    const url = new URL(storeUrl);
    if (prefix) url.searchParams.set("prefix", prefix);
    if (cursor) url.searchParams.set("cursor", cursor);
    const res = await fetch(url, { headers: auth });
    if (!res.ok) throw new Error(`list ${prefix || "/"} failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    for (const blob of data.blobs || []) keys.push(blob.key);
    for (const dir of data.directories || []) keys.push(...(await listAll(dir)));
    cursor = data.cursor;
  } while (cursor);
  return keys;
}

// Same key -> path mapping the local store uses, so lookups line up.
function localPath(key) {
  const rel = String(key)
    .split("/")
    .map((s) => s.replace(/[^A-Za-z0-9._-]/g, "_"))
    .join(path.sep);
  const full = path.resolve(DEST, rel);
  if (!full.startsWith(path.resolve(DEST))) throw new Error(`unsafe key: ${key}`);
  return full;
}

// Blobs has no direct "download" — ask for a signed URL, then fetch it.
async function download(key) {
  const res = await fetch(`${storeUrl}/${encodeURIComponent(key)}`, {
    headers: { ...auth, accept: "application/json;type=signed-url" }
  });
  if (!res.ok) throw new Error(`signed url for ${key} failed: HTTP ${res.status}`);
  const { url } = await res.json();
  const blob = await fetch(url);
  if (!blob.ok) throw new Error(`fetch ${key} failed: HTTP ${blob.status}`);
  return Buffer.from(await blob.arrayBuffer());
}

// --- run ------------------------------------------------------------------
fs.mkdirSync(DEST, { recursive: true });

console.log(`site ${SITE_ID}\nstore ${STORE_NAME}\n`);
const keys = [...new Set(await listAll())].sort();
if (!keys.length) {
  console.log("No keys returned. The store may be empty, or the token may lack access.");
  process.exit(0);
}
console.log(`${keys.length} keys found:\n`);

let ok = 0;
const failed = [];
for (const key of keys) {
  try {
    const buf = await download(key);
    const file = localPath(key);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, buf);
    ok += 1;
    console.log(`  ok    ${key}  (${buf.length} bytes)`);
  } catch (err) {
    failed.push(key);
    console.log(`  FAIL  ${key}  ${err.message}`);
  }
}

console.log(`\n${ok}/${keys.length} pulled into ${DEST}`);
if (failed.length) {
  console.log(`failed: ${failed.join(", ")}`);
  process.exitCode = 1;
}
