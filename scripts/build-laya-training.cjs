#!/usr/bin/env node
"use strict";

// Feed Laya what you have taught the admin. Laya's catalog head was trained on 87 printers and a few hand-written filament
// pairs; it has never seen your filament baseline or any of your decisions. This rebuilds its two training inputs:
//
//   data/laya-baseline.json       every baseline model (printers kept; every filament MODEL added, SKUs left out)
//   data/laya-learned-pairs.json  your decisions: "this listing title goes to this model" (same), and the nearest
//                                 other models of the same brand (different), so it learns where the lines split
//
// Then retrain on the PC that has the Laya environment:
//   .venv-laya\Scripts\python scripts\laya-match.py --train
//
//   npm run laya-data

const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const store = process.env.LOCAL_STORE || path.join(root, "work", "local-store");
const readJson = (f, dflt) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return dflt; } };
const fold = (v) => String(v == null ? "" : v).toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/ı/g, "i").replace(/[^a-z0-9]+/g, " ").trim();
const tokens = (v) => new Set(fold(v).split(" ").filter((t) => t.length > 1));

const board = readJson(path.join(store, "baseline.json"), { items: [] });
const old = readJson(path.join(root, "data", "laya-baseline.json"), { items: [] });
const jobs = readJson(path.join(store, "jobs.json"), []);

const isModel = (i) => i && i.name && !i.parentId && i.entityType !== "sku";
const filamentModels = board.items.filter((i) => i.category === "filaments" && isModel(i));
const byId = new Map(board.items.map((i) => [i.id, i]));
const keep = old.items.filter((i) => i.category !== "filaments");
const items = [...keep, ...filamentModels.map((i) => ({ id: i.id, category: "filaments", name: i.name, brand: String(i.brand || "").toLowerCase() }))];
const seenId = new Set();
const unique = items.filter((i) => (seenId.has(i.id) ? false : seenId.add(i.id)));

// Your decisions → pairs.
const pairs = [];
const seen = new Set();
for (const job of Array.isArray(jobs) ? jobs : []) {
  for (const card of Object.values(job.cards || {})) {
    if (!card || !card.handEdited || !/^merge:baseline:/.test(card.place || "")) continue;
    const model = byId.get(String(card.place).slice("merge:baseline:".length));
    const title = card.sourceTitle || card.name;
    if (!model || !title || model.category !== "filaments") continue;
    const key = fold(title) + "|" + model.id;
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push({ a: title, b: model.name, label: "same", why: "you put this listing on this model" });
    // The nearest other models of the same brand: the ones a careless matcher would confuse it with.
    const t = tokens(title);
    const near = filamentModels
      .filter((m) => m.id !== model.id && fold(m.brand) === fold(model.brand))
      .map((m) => { const mt = tokens(m.name); const inter = [...t].filter((x) => mt.has(x)).length; return { m, score: inter / (t.size + mt.size - inter || 1) }; })
      .sort((x, y) => y.score - x.score)
      .slice(0, 2);
    for (const { m } of near) pairs.push({ a: title, b: m.name, label: "different", why: "same brand, another model" });
  }
}

fs.writeFileSync(path.join(root, "data", "laya-baseline.json"), JSON.stringify({ updatedAt: new Date().toISOString(), categories: old.categories || [{ id: "printers", name: "Printers" }, { id: "filaments", name: "Filament" }], items: unique }, null, 1) + "\n");
fs.writeFileSync(path.join(root, "data", "laya-learned-pairs.json"), JSON.stringify({ description: "Pairs learned from your decisions in the admin (scripts/build-laya-training.cjs). Same = the listing was put on that baseline model; different = a close model of the same brand.", pairs }, null, 1) + "\n");
const same = pairs.filter((p) => p.label === "same").length;
console.log("laya-baseline.json: " + unique.length + " models (" + keep.length + " printers kept, " + filamentModels.length + " filament models added)");
console.log("laya-learned-pairs.json: " + pairs.length + " pairs from your decisions (" + same + " same, " + (pairs.length - same) + " different)");
console.log("\nNext, on the PC with the Laya environment:\n  .venv-laya\\Scripts\\python scripts\\laya-match.py --train");
