#!/usr/bin/env node
"use strict";

// Score the current deterministic matcher (Magellan) against docs/laya-eval.jsonl.
//
// This is the number anything else has to beat. Measured the same way Laya will be measured, on the
// same pairs, so the comparison means something:
//   accuracy        overall
//   false-merge     said "same" when they differ  <- the expensive error, welds two printers into one
//   false-split     said "different" when they match <- annoying, creates a duplicate row
//
//   node scripts/eval-magellan.cjs

const fs = require("node:fs");
const path = require("node:path");
const { decidePair } = require("../lib/product-match.cjs");

const FILE = path.join(__dirname, "..", "docs", "laya-eval.jsonl");
const pairs = fs.readFileSync(FILE, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));

const rows = [];
for (const p of pairs) {
  let predicted = "different";
  let why = "";
  try {
    const d = decidePair({ name: p.a, kind: "printer" }, { name: p.b, kind: "printer" });
    // "review" is the gray band: not an automatic merge. Counted as a non-merge, which is what the
    // pipeline does with it today (it holds for a human) unless a help toggle escalates it.
    predicted = d.action === "merge" ? "same" : "different";
    why = d.action + (d.reason ? ": " + d.reason : "");
  } catch (err) {
    why = "threw " + err.message;
  }
  rows.push({ ...p, predicted, why });
}

const n = rows.length;
const correct = rows.filter((r) => r.predicted === r.label).length;
const same = rows.filter((r) => r.label === "same");
const diff = rows.filter((r) => r.label === "different");
const fm = diff.filter((r) => r.predicted === "same");   // false merge
const fs_ = same.filter((r) => r.predicted === "different"); // false split
const pct = (x, y) => (y ? ((x / y) * 100).toFixed(1) + "%" : "n/a");

console.log("MAGELLAN on " + n + " labeled pairs");
console.log("  accuracy      : " + correct + "/" + n + "  (" + pct(correct, n) + ")");
console.log("  false-merge   : " + fm.length + "/" + diff.length + "  (" + pct(fm.length, diff.length) + ")  <- the expensive error");
console.log("  false-split   : " + fs_.length + "/" + same.length + "  (" + pct(fs_.length, same.length) + ")");
console.log();

// Per-kind, so the hand-written edges are visible rather than averaged away.
const kinds = {};
for (const r of rows) {
  const k = r.kind.split("/")[0];
  kinds[k] = kinds[k] || { n: 0, ok: 0 };
  kinds[k].n += 1;
  if (r.predicted === r.label) kinds[k].ok += 1;
}
console.log("by kind:");
for (const k of Object.keys(kinds).sort()) {
  console.log("  " + k.padEnd(16) + kinds[k].ok + "/" + kinds[k].n + "  " + pct(kinds[k].ok, kinds[k].n));
}

const handWritten = rows.filter((r) => !/^(surface|cross-identity)/.test(r.kind));
console.log();
console.log("hand-written hard edges (" + handWritten.length + "):");
for (const r of handWritten) {
  const ok = r.predicted === r.label ? "ok  " : "MISS";
  console.log("  " + ok + " [" + r.label + "->" + r.predicted + "] " + r.kind + " | " + r.why.slice(0, 70));
}
