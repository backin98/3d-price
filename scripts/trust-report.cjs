#!/usr/bin/env node
"use strict";

// How far can the algorithm be trusted? Every card you fixed by hand (work/local-store/jobs.json, handEdited) is a
// label: what the run produced from the listing title versus what you set. Prints, per field, how often they agree.
//
//   npm run trust-report                 # agreement on every hand-edited card
//   npm run trust-report -- --misses 8   # also show the first misses of each field
//   npm run trust-report -- --json       # machine readable
//
// Spool material and sub-brand are scored when the run predicts one. Not predicting counts as a miss for
// "coverage" and is reported apart from "wrong when it did predict", so a cautious model is not punished as a wrong one.

const fs = require("node:fs");
const path = require("node:path");
const { normalizeFilamentListing } = require("../lib/qwen-website-job.cjs");

const args = process.argv.slice(2);
const showMisses = args.includes("--misses") ? Number(args[args.indexOf("--misses") + 1]) || 5 : 0;
const asJson = args.includes("--json");
const file = path.join(__dirname, "..", "work", "local-store", "jobs.json");
const jobs = JSON.parse(fs.readFileSync(file, "utf8"));

const fold = (v) => String(v == null ? "" : v).toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/ı/g, "i").replace(/\s+/g, " ").trim();
const grams = (v) => { const m = String(v || "").match(/([\d.,]+)\s*(kg|g)/i); if (!m) return ""; const n = Number(m[1].replace(",", ".")); return String(Math.round(/kg/i.test(m[2]) ? n * 1000 : n)); };
const lists = (v) => fold(Array.isArray(v) ? v.join("+") : v).split(/[+,]/).map((x) => x.trim()).filter(Boolean).sort().join("+");

// field → [label, truth, guess] normalisers; a field is scored only when the truth has a value
const FIELDS = {
  brand: (c) => fold(c.brand),
  polymer: (c) => fold(c.polymer),
  variant: (c) => lists(c.variant),
  color: (c) => lists(fold(c.color).replace(/[-_]/g, " ")),
  weight: (c) => grams(c.weight),
  diameter: (c) => fold(c.diameter).replace(/\s*mm$/, ""),
  packaging: (c) => fold(c.packaging),
  spoolMaterial: (c) => fold(c.spoolMaterial),
  subBrand: (c) => lists(c.subBrand)
};

const rows = [];
for (const job of jobs) {
  for (const card of Object.values(job.cards || {})) {
    if (!card || !card.handEdited || !(card.sourceTitle || card.name)) continue;
    rows.push({ shop: job.site || "", truth: card });
  }
}

const stat = Object.fromEntries(Object.keys(FIELDS).map((k) => [k, { scored: 0, agree: 0, predicted: 0, wrong: 0, truthEmpty: 0, falseFill: 0, misses: [] }]));
for (const { shop, truth } of rows) {
  const title = truth.sourceTitle || truth.name;
  const guess = normalizeFilamentListing({ name: title, sourceTitle: title, url: truth.url, price: truth.price, kind: "filament", brand: truth.brand, image: truth.image });
  for (const [field, get] of Object.entries(FIELDS)) {
    const want = get(truth);
    const got = get(guess);
    const s = stat[field];
    if (!want) { s.truthEmpty++; if (got) s.falseFill++; continue; }
    s.scored++;
    if (got) s.predicted++;
    if (got === want) s.agree++;
    else {
      if (got) s.wrong++;
      if (s.misses.length < 200) s.misses.push({ title, want, got: got || "(none)", shop });
    }
  }
}

const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);
const report = Object.fromEntries(Object.entries(stat).map(([k, s]) => [k, {
  cards: s.scored,
  agree: pct(s.agree, s.scored),
  coverage: pct(s.predicted, s.scored),
  wrongWhenPredicted: pct(s.wrong, s.predicted),
  filledWhereYouLeftEmpty: s.falseFill
}]));
if (asJson) {
  console.log(JSON.stringify({ cards: rows.length, report }, null, 2));
  process.exit(0);
}
console.log("Hand-edited cards: " + rows.length + "  (what the run makes from the listing title, against what you set)\n");
console.log("field".padEnd(15) + "cards".padStart(6) + "agree %".padStart(10) + "covered %".padStart(11) + "wrong|predicted %".padStart(19));
for (const [k, r] of Object.entries(report)) {
  console.log(k.padEnd(15) + String(r.cards).padStart(6) + String(r.agree == null ? "-" : r.agree).padStart(10) + String(r.coverage == null ? "-" : r.coverage).padStart(11) + String(r.wrongWhenPredicted == null ? "-" : r.wrongWhenPredicted).padStart(19));
}
console.log("\nNote: spool material and sub-brand were learned from these same cards, so their scores here are generous.");
console.log("The honest score (each card predicted from all the others) is printed by: npm run learn -- --check");
if (showMisses) {
  for (const [k, s] of Object.entries(stat)) {
    if (!s.misses.length) continue;
    console.log("\n" + k + " — first " + Math.min(showMisses, s.misses.length) + " misses:");
    s.misses.slice(0, showMisses).forEach((m) => console.log("  " + m.title.slice(0, 70).padEnd(70) + "  you: " + m.want + "  run: " + m.got));
  }
}
