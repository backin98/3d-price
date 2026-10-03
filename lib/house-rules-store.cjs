"use strict";

// The file side of lib/house-rules.cjs (kept apart so the pure rules can be bundled for the Cloudflare API, which has no
// filesystem): read the labels you left in the local store, write data/house-rules.json, and hand the run the current rules.

const fs = require("node:fs");
const path = require("node:path");
const R = require("./house-rules.cjs");

const root = path.join(__dirname, "..");
const rulesFile = () => process.env.HOUSE_RULES_FILE || path.join(root, "data", "house-rules.json");
const readJson = (f, dflt) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return dflt; } };

// The cards you fixed by hand and your approved filament models.
function labelsFromStore(dir) {
  const jobs = readJson(path.join(dir, "jobs.json"), []);
  const baseline = readJson(path.join(dir, "baseline.json"), { items: [] });
  const cards = [];
  const seen = new Set();
  for (const job of Array.isArray(jobs) ? jobs : []) {
    for (const [url, card] of Object.entries(job.cards || {})) {
      if (!card || !card.handEdited || seen.has(url)) continue;
      seen.add(url);
      cards.push(card);
    }
  }
  return { cards, baselineItems: (baseline.items || []).filter((i) => i && i.category === "filaments") };
}

function learnFromStore(dir) {
  const labels = labelsFromStore(dir);
  return { labels, rules: R.learnRules(labels) };
}

function save(rules) {
  const file = rulesFile();
  const keep = readJson(file, null);
  const snapshot = { ...rules, learnedAt: new Date().toISOString() };
  const same = keep && JSON.stringify({ ...keep, learnedAt: 0 }) === JSON.stringify({ ...snapshot, learnedAt: 0 });
  if (!same) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(snapshot, null, 1) + "\n"); }
  return !same;
}

// At start-up: if you edited cards since the rules were last learned, learn again (a few tens of milliseconds). Never:
//   - never from a scratch copy of the store (SITE_STORE_DIR): that is for click-testing, not for teaching;
//   - never when the labels would shrink: a store with fewer hand-edited cards than the rules were learned from is
//     a different or emptied store, and replacing good rules with it would throw your edits away.
// (`npm run learn` is the deliberate way to relearn, and can replace anything.)
function learnIfStale(dir, opts = {}) {
  if (process.env.SITE_STORE_DIR && !opts.force) return { learned: false, why: "scratch store" };
  const newest = ["jobs.json", "baseline.json"].map((f) => { try { return fs.statSync(path.join(dir, f)).mtimeMs; } catch { return 0; } });
  let at = 0;
  try { at = fs.statSync(rulesFile()).mtimeMs; } catch { at = 0; }
  if (Math.max(...newest) <= at) return { learned: false };
  const { labels, rules } = learnFromStore(dir);
  const before = readJson(rulesFile(), null);
  const had = before && before.trainedOn ? (before.trainedOn.cards || 0) : 0;
  if (!opts.force && labels.cards.length < had) return { learned: false, why: "fewer labels than the rules were learned from", cards: labels.cards.length };
  return { learned: save(rules), cards: labels.cards.length };
}

// The rules the run uses. Re-read when the file changes (checked at most every few seconds), so a relearn applies to the
// next listing without restarting the worker.
let cache = { at: 0, mtime: -1, rules: null };
function current() {
  const now = Date.now();
  if (cache.at && now - cache.at < 4000) return cache.rules;
  cache.at = now;
  let mtime = 0;
  try { mtime = fs.statSync(rulesFile()).mtimeMs; } catch { mtime = 0; }
  if (mtime !== cache.mtime) { cache.mtime = mtime; cache.rules = mtime ? readJson(rulesFile(), null) : null; }
  return cache.rules;
}

module.exports = { labelsFromStore, learnFromStore, learnIfStale, save, current, rulesFile };
