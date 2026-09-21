#!/usr/bin/env node
"use strict";

// Collect every raw shop listing on disk into docs/real-listings.jsonl.
//
// The live catalogue is not a usable source right now (0 published products), so this walks the
// snapshots and run outputs instead: work/*.json, data/qwen-employee/*.json, data/*.json. Shop runs
// write catalogue shapes, candidate shapes and job/audit shapes, and they nest differently, so rather
// than guess a schema this walks the JSON generically and picks up anything that looks like a listing
// (an object with a name/title), recording the file it came from.
//
// Deduplicated by shop+URL, or shop+title when there is no URL, because the same listing appears in
// several snapshots as a run progresses.
//
//   node scripts/mine-listings.cjs

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "docs", "real-listings.jsonl");

const SKIP_DIRS = new Set(["node_modules", ".git", ".netlify", "graphify-out", ".venv-laya", "sources"]);

function jsonFiles(dir, acc = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) jsonFiles(full, acc); continue; }
    if (e.name.toLowerCase().endsWith(".json") || e.name.toLowerCase().endsWith(".jsonl")) acc.push(full);
  }
  return acc;
}

// Walk any shape. `products[].offers[]`, `listings[]`, `events[].listing`, and anything else that
// carries a title all get found by the same rule instead of a schema per file type.
function collect(node, file, out, depth = 0) {
  if (depth > 12 || node === null || node === undefined) return;
  if (Array.isArray(node)) { for (const v of node) collect(v, file, out, depth + 1); return; }
  if (typeof node !== "object") return;

  const title = node.name || node.title || node.listingName;
  if (typeof title === "string" && title.trim().length > 3) {
    out.push({
      title: title.trim(),
      shop: String(node.store || node.shop || node.site || node.source || node.siteId || "").trim(),
      url: String(node.url || node.link || node.href || "").trim(),
      price: typeof node.price === "number" ? node.price : null,
      file
    });
  }
  for (const value of Object.values(node)) {
    if (value && typeof value === "object") collect(value, file, out, depth + 1);
  }
}

function main() {
  const files = jsonFiles(ROOT).filter((f) => !f.includes(path.join("docs", "real-")));
  const raw = [];
  for (const file of files) {
    const rel = path.relative(ROOT, file);
    let text;
    try { text = fs.readFileSync(file, "utf8"); } catch { continue; }
    if (text.length > 40 * 1024 * 1024) continue;
    if (file.endsWith(".jsonl")) {
      for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        try { collect(JSON.parse(line), rel, raw); } catch { /* not a record */ }
      }
      continue;
    }
    try { collect(JSON.parse(text), rel, raw); } catch { /* not JSON, skip */ }
  }

  const seen = new Set();
  const listings = [];
  for (const l of raw) {
    // A record with neither a shop nor a URL is a source descriptor ("Rhino · Metatech · ..."), not a
    // listing. The generic walk picks those up because they are objects with a name.
    if (!l.url && !l.shop) continue;
    const key = l.url ? (l.shop + "|" + l.url).toLowerCase() : (l.shop + "|" + l.title).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    listings.push(l);
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, listings.map((l) => JSON.stringify(l)).join("\n") + "\n");

  const shops = new Set(listings.map((l) => l.shop).filter(Boolean));
  const byFile = {};
  for (const l of listings) byFile[l.file] = (byFile[l.file] || 0) + 1;
  console.log("wrote", path.relative(ROOT, OUT));
  console.log("files scanned:", files.length, "| raw listings seen:", raw.length);
  console.log("after dedupe by shop+url:", listings.length);
  console.log("distinct shops:", shops.size, "->", [...shops].slice(0, 12).join(", "));
  console.log("with a url:", listings.filter((l) => l.url).length, "| with a price:", listings.filter((l) => l.price !== null).length);
  console.log("top source files:");
  for (const [f, n] of Object.entries(byFile).sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log("   " + n + "  " + f);
}

main();
