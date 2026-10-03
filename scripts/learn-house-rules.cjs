#!/usr/bin/env node
"use strict";

// Learn from what you fix by hand. Reads the cards you edited (work/local-store/jobs.json) and your approved baseline
// (work/local-store/baseline.json), writes data/house-rules.json (spool material by line, sub-brand lines, the
// shades you eyedropped), then scores itself honestly: each card is left out, predicted from the others, and
// compared with what you actually set.
//
//   npm run learn              # learn, write the rules, print the scores
//   npm run learn -- --check   # print the scores only, write nothing
//
// Run it again after a good editing session: the run uses the new rules at its next start.

const path = require("node:path");
const R = require("../lib/house-rules.cjs");
const S = require("../lib/house-rules-store.cjs");

const root = path.join(__dirname, "..");
const store = process.env.LOCAL_STORE || path.join(root, "work", "local-store");
const checkOnly = process.argv.includes("--check");

const { labels } = { labels: S.labelsFromStore(store) };
const cards = labels.cards;
const items = labels.baselineItems;
const rules = R.learnRules({ cards, baselineItems: items });

// ---- score: leave one out ----------------------------------------------------------------------------------------
const labelled = cards.filter((c) => ["plastic", "cardboard"].includes(R.fold(c.spoolMaterial)));
const rows = labelled.map((card) => {
  const others = cards.filter((c) => c !== card);
  const r = R.learnRules({ cards: others, baselineItems: items });
  const title = card.sourceTitle || card.name;
  const probe = { brand: card.brand, polymer: card.polymer, variant: card.variant, subBrand: R.subBrandOf(card.brand, title, r) };
  return { title, truth: R.fold(card.spoolMaterial), guess: R.predictSpool(r, probe, { minShare: 0.6 }) };
});
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
console.log("Learned from " + cards.length + " hand-edited cards (" + labelled.length + " with a spool type), " + items.length + " baseline models.\n");
console.log("SPOOL MATERIAL, each card predicted from all the others (leave-one-out):");
for (const floor of [0.5, 0.6, 0.7, 0.8, 0.9]) {
  const said = rows.filter((r) => r.guess && r.guess.confidence >= floor);
  const right = said.filter((r) => r.guess.value === r.truth).length;
  console.log("  confidence >= " + floor.toFixed(1) + ":  fills " + pct(said.length, rows.length) + "% of cards, right " + pct(right, said.length) + "% of the time" + (floor === R.SURE ? "   <- the run fills the field from here" : ""));
}
const wrongSure = rows.filter((r) => r.guess && r.guess.confidence >= R.SURE && r.guess.value !== r.truth);
if (wrongSure.length) {
  console.log("  wrong while sure (" + wrongSure.length + "):");
  wrongSure.slice(0, 6).forEach((r) => console.log("    " + r.title.slice(0, 64).padEnd(64) + " you: " + r.truth + "  guess: " + r.guess.value + " (" + r.guess.level + ", n=" + r.guess.n + ")"));
}

// sub-brand: does the title rule find what you typed?
const subRows = cards.filter((c) => String(c.subBrand || "").trim());
const subHit = subRows.filter((c) => R.fold(R.subBrandOf(c.brand, c.sourceTitle || c.name, rules)) === R.fold(String(c.subBrand).split(",")[0]));
console.log("\nSUB-BRAND: found " + subHit.length + " of the " + subRows.length + " you typed.");

// tone: your earlier pick of the same colour against the generic table colour
const table = require("../data/filament-taxonomy.json").colours;
const toneRows = cards.filter((c) => /^#[0-9a-f]{6}$/i.test(c.colorHex || "") && !c.multicolor);
const learned = [], generic = [];
for (const card of toneRows) {
  const r = R.learnRules({ cards: cards.filter((c) => c !== card), baselineItems: items });
  const tone = R.toneFor(r, card);
  const row = table[card.color];
  if (row) generic.push(R.labDist(R.hexToLab(card.colorHex), R.hexToLab(row.hex)));
  if (tone) learned.push(R.labDist(R.hexToLab(card.colorHex), R.hexToLab(tone.hex)));
}
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? Math.round(s[Math.floor(s.length / 2)] * 10) / 10 : null; };
console.log("\nSWATCH TONE (distance to the shade you picked; under 5 is hard to see, over 15 is clearly another colour):");
console.log("  generic table colour:   median " + median(generic) + "  (" + generic.length + " cards)");
console.log("  your earlier picks:     median " + median(learned) + "  (" + learned.length + " of " + toneRows.length + " cards have an earlier pick)");

if (!checkOnly) {
  const wrote = S.save(rules);
  console.log("\n" + (wrote ? "Wrote " : "Rules unchanged: ") + path.relative(root, S.rulesFile()));
}
