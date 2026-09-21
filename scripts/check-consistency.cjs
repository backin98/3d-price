#!/usr/bin/env node
"use strict";

// Fails loudly when the storefront and the worker disagree about the catalog.
//
// Two different things are legitimately true at once, and conflating them is what made a 32-vs-0
// gap look like a bug for an hour:
//   published -> catalog.json, what /api/hunt serves and customers see
//   working   -> published + candidate.json, what the worker matches against
// They are SUPPOSED to differ while a candidate is waiting for publish. They are NOT supposed to
// differ by silence. So this prints both, and exits non-zero when there are unpublished candidates
// (loud, with the fix: publish them) or when the published catalog is empty (the storefront is
// blank and every run matches against nothing).
//
// Run after every deploy:  node scripts/check-consistency.cjs

const fs = require("node:fs");
const path = require("node:path");

const SITE = (process.env.ONLINE_URL || "https://3d-price.netlify.app").replace(/\/+$/, "");

function envToken() {
  if (process.env.INGEST_TOKEN) return process.env.INGEST_TOKEN;
  try {
    const raw = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8");
    const m = raw.match(/^INGEST_TOKEN=(.*)$/m);
    return m ? m[1].trim().replace(/^["']|["']$/g, "") : "";
  } catch { return ""; }
}

async function get(url, token) {
  const res = await fetch(url, { headers: token ? { Authorization: "Bearer " + token } : {}, signal: AbortSignal.timeout(20000) });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

(async () => {
  const token = envToken();
  const problems = [];

  const pub = await get(SITE + "/api/hunt", "");
  if (pub.status !== 200) problems.push("published catalog endpoint returned HTTP " + pub.status);
  const published = Array.isArray(pub.body.products) ? pub.body.products.length : 0;

  let working = null;
  if (!token) problems.push("INGEST_TOKEN not found (checked env and .env) - cannot read the worker view");
  else {
    const w = await get(SITE + "/.netlify/functions/worker?action=catalog", token);
    if (w.status !== 200) problems.push("worker catalog endpoint returned HTTP " + w.status);
    else working = Array.isArray(w.body.catalog && w.body.catalog.products) ? w.body.catalog.products.length : 0;
  }

  console.log("site          : " + SITE);
  console.log("published     : " + published + " products   (catalog.json - what customers see)");
  console.log("worker sees   : " + (working === null ? "unavailable" : working + " products   (published + candidate.json)"));

  if (working !== null && working !== published) {
    console.log("pending       : " + (working - published) + " unpublished candidate product(s)");
    problems.push((working - published) + " product(s) are published to nobody: they exist in candidate.json only. Publish them (see below) or the storefront stays empty.");
  }
  if (published === 0) problems.push("published catalog is EMPTY - the storefront shows nothing and workers match against nothing");

  if (problems.length) {
    console.log("\nINCONSISTENT:");
    for (const p of problems) console.log("  - " + p);
    console.log("\nFix: Admin -> Catalog tab -> \"Publish candidate to live catalog\".");
    process.exit(1);
  }
  console.log("\nCONSISTENT: storefront and worker agree.");
})().catch((err) => { console.error("consistency check failed:", err.message); process.exit(2); });
