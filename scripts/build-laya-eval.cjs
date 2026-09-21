#!/usr/bin/env node
"use strict";

// Builds the labeled pair set for evaluating Laya (and anything else) against Magellan.
//
// Labels are DERIVED FROM IDENTITY, not from my opinion. A pair is "same" only when both titles come
// from one baseline row's identity (aliases plus surface variants of that same row); "different" only
// when the two rows carry different identityIds. That way the answer key cannot drift with my mood,
// and the hard edges are written out by hand where identity alone can't express them (an accessory
// shares a brand and model name with the printer it fits, and is still not the printer).
//
// Deterministic and offline: no network, no model. Rerun to regenerate:
//   node scripts/build-laya-eval.cjs
//
// Output: docs/laya-eval.jsonl  {a, b, label, kind, why}

const fs = require("node:fs");
const path = require("node:path");

const baseline = require("../lib/baseline-catalog.js");
const norm = require("../lib/title-normalize.js");

const rows = baseline.loadBaseline();
const byId = new Map();
for (const r of rows) if (!byId.has(r.identityId)) byId.set(r.identityId, r);
const unique = [...byId.values()];

// Surface variants of ONE identity. Every one of these is the same product written differently:
// a shop's casing, its Turkish characters, its marketing noise, and its word order.
const foldTurkish = (s) => s.replace(/ı/g, "i").replace(/İ/g, "I").replace(/ş/g, "s").replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ö/g, "o").replace(/ç/g, "c");
function titleOf(row) {
  const brand = row.brand.replace(/^\w/, (c) => c.toUpperCase());
  const model = (row.aliases && row.aliases[0]) || row.modelCore;
  let t = brand + " " + model;
  if (row.comboAxis === "combo") t += " Combo";
  if (row.feederGen) t += " " + String(row.feederGen).replace(/-/g, " ");
  if (row.laserWatts) t += " Lazer " + row.laserWatts + "W";
  if (row.kitForm) t += " " + row.kitForm;
  return t + " 3D Yazıcı";
}

function variants(row) {
  const base = titleOf(row);
  const words = base.split(" ");
  const swapped = words.length > 3 ? [...words.slice(0, 2), ...words.slice(2).reverse()].join(" ") : base;
  const out = [];
  out.push({ title: base, why: "canonical" });
  out.push({ title: base.toUpperCase(), why: "upper-cased" });
  out.push({ title: foldTurkish(base), why: "Turkish chars folded" });
  out.push({ title: base + " Kargo Bedava 2 Yıl Garanti", why: "marketing noise added" });
  out.push({ title: swapped, why: "token order shuffled" });
  return out;
}

const pairs = [];
const add = (a, b, label, kind, why) => pairs.push({ a, b, label, kind, why });

// ---- hand-written hard edges -------------------------------------------------------
// These are the cases the task names, where a wrong answer is expensive.
const HARD = [
  ["Bambu Lab H2C 10 Watt Combo 3D Yazıcı", "Bambu Lab H2C Combo Laser 10 Watt 3D Yazıcı", "same", "word-order", "same machine, tokens reordered"],
  ["Bambu Lab H2C Combo Laser 10 Watt", "Bambu Lab H2C Laser 10 Watt Combo", "same", "word-order", "tokens reordered again"],
  ["Bambu Lab H2C 3D Yazıcı", "Bambu Lab H2C Combo 3D Yazıcı", "different", "combo-vs-bare", "combo is a different pack"],
  ["Bambu Lab H2S 3D Yazıcı", "Bambu Lab H2S AMS 2 Pro Combo 3D Yazıcı", "different", "combo-vs-bare", "AMS bundle is a different pack"],
  ["Creality K2 Plus Combo 10W Lazer", "Creality K2 Plus Combo 40W Lazer", "different", "laser-watt", "40W is not 10W"],
  ["Creality K2 Plus 10W Lazer", "Creality K2 Plus 40W Lazer", "different", "laser-watt", "40W is not 10W"],
  ["Bambu Lab A1 tarzı 3D Yazıcı", "Bambu Lab A1 3D Yazıcı", "different", "knockoff", "\"tarzı\" = a clone, not the genuine article"],
  ["Bambu Lab A1 muadil yazıcı", "Bambu Lab A1 3D Yazıcı", "different", "knockoff", "\"muadil\" = equivalent/knockoff"],
  ["Bambu Lab A1 nozzle uyumlu yedek parça", "Bambu Lab A1 3D Yazıcı", "different", "accessory", "a nozzle is not the printer"],
  ["Bambu Lab A1 için manyetik plaka", "Bambu Lab A1 3D Yazıcı", "different", "accessory", "a build plate is not the printer"],
  ["Creality Falcon 40W Lazer Modülü", "Creality K2 Plus Combo 3D Yazıcı", "different", "accessory", "a standalone laser module is not a printer"],
  ["Bambu Lab H2S 3D Yazıcı Yedek Nozul Seti", "Bambu Lab H2S 3D Yazıcı", "different", "accessory", "spare nozzles are not the printer"],
  ["Bambu Lab H2C 10W Combo", "Bambu Lab H2D 10W Combo", "different", "model", "different model core"],
  ["Elegoo Saturn 4 Ultra", "Elegoo Saturn 4 Ultra 16K", "different", "variant", "16K is a different variant"],
  ["Bambu Lab P1S Combo", "Bambu LAB P1S COMBO 3D YAZICI", "same", "fold", "same title, different casing"],
];
for (const [a, b, label, kind, why] of HARD) add(a, b, label, kind, why);

// ---- identity-derived pairs --------------------------------------------------------
for (const row of unique) {
  const vs = variants(row);
  for (let i = 1; i < vs.length; i++) {
    add(vs[0].title, vs[i].title, "same", "surface/" + vs[i].why, "same identity, " + vs[i].why);
  }
}

// Different identities, same brand: the dangerous pairs, because they share most of their tokens.
// Both titles are built from the full axes, so a bare-vs-combo or 10W-vs-40W pair really does read
// differently - and a pair whose titles still come out identical is dropped, because two rows that
// are indistinguishable on paper are not a fair test of anything.
const byBrand = new Map();
for (const r of unique) { if (!byBrand.has(r.brand)) byBrand.set(r.brand, []); byBrand.get(r.brand).push(r); }
for (const [brand, list] of byBrand) {
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      if (a.identityId === b.identityId) continue;
      const ta = titleOf(a), tb = titleOf(b);
      if (norm.fold(ta, "tr") === norm.fold(tb, "tr")) continue;
      add(ta, tb, "different", "cross-identity", a.identityId + " vs " + b.identityId);
    }
  }
}

// ---- write ------------------------------------------------------------------------
const seen = new Set();
const clean = [];
for (const p of pairs) {
  const key = norm.fold(p.a, "tr") + "\u0001" + norm.fold(p.b, "tr");
  if (!p.a.trim() || !p.b.trim() || key.split("\u0001")[0] === key.split("\u0001")[1]) continue;
  if (seen.has(key)) continue;
  seen.add(key);
  clean.push(p);
}
// Balance it. Unbalanced either way, the set is worthless: 437/12 and a model that always says
// "same" scores 97%; 643/4133 and one that always says "different" scores 86%. Every hand-written hard
// edge is kept in full, and the two generated groups are sampled to equal size with a fixed stride so
// the result is deterministic and rerunnable.
const hardCases = clean.filter((p) => !/^(surface|cross-identity)/.test(p.kind));
const sampled = (arr, n) => {
  if (arr.length <= n) return arr;
  const step = Math.floor(arr.length / n);
  const out = [];
  for (let i = 0; i < arr.length && out.length < n; i += step) out.push(arr[i]);
  return out;
};
const balanced = [
  ...hardCases,
  ...sampled(clean.filter((p) => p.kind.startsWith("surface")), 180),
  ...sampled(clean.filter((p) => p.kind.startsWith("cross-identity")), 180)
];
const OUT = path.join(__dirname, "..", "docs", "laya-eval.jsonl");
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, clean.map((p) => JSON.stringify(p)).join("\n") + "\n");
const same = balanced.filter((p) => p.label === "same").length;
console.log("wrote", path.relative(process.cwd(), OUT));
console.log("pairs:", balanced.length, "| same:", same, "| different:", balanced.length - same);
const kinds = {};
for (const p of balanced) kinds[p.kind.split("/")[0]] = (kinds[p.kind.split("/")[0]] || 0) + 1;
console.log("kinds:", JSON.stringify(kinds));
if (balanced.length < 200) { console.error("FAIL: fewer than 200 pairs"); process.exit(1); }
if (same < 100 || balanced.length - same < 100) { console.error("FAIL: set is not balanced enough to be meaningful"); process.exit(1); }
