"use strict";

// What the product photo says: the true tone of the filament (or the stops of a gradient) and what the spool is made of.
// The run reads every filament listing's photo once, remembers the answer per image URL (work/photo-readings.json), and
// fills what is still empty, with its evidence in listing.guess. It never replaces a value a person set, and a spool type
// the photo is only fairly sure of is offered as a hint, not filled in.

const fs = require("node:fs");
const path = require("node:path");
const SC = require("../public/admin/swatch-colours.js");

const root = path.join(__dirname, "..");
const cacheFile = () => process.env.PHOTO_READINGS_FILE || path.join(root, "work", "photo-readings.json");
// The photo fills the spool field from this confidence; below it, it is a hint. (npm run eval-spool-photo measures it.)
const PHOTO_SPOOL_SURE = Number(process.env.PHOTO_SPOOL_SURE) || 0.85;
// And the tone replaces the generic / learned colour from this confidence.
const PHOTO_TONE_MIN = 0.45;
const READING_VERSION = 2; // bump when the reader changes: old cached answers are read again

let cache = null;
function store() {
  if (!cache) {
    try { cache = JSON.parse(fs.readFileSync(cacheFile(), "utf8")); } catch { cache = null; }
    // A missing, unreadable or old-version file (even the text "null") starts a fresh store.
    if (!cache || typeof cache !== "object" || cache.__version !== READING_VERSION) cache = { __version: READING_VERSION };
  }
  return cache;
}
function saveStore() {
  if (!cache) return;
  try { fs.mkdirSync(path.dirname(cacheFile()), { recursive: true }); fs.writeFileSync(cacheFile(), JSON.stringify(cache)); } catch { /* a cache is an optimisation */ }
}
function resetStore() { cache = null; }

// Pixels → what the reader sees. Pure: this is what the tests and the evaluation call.
function readPixels(px) {
  if (!px || !px.data) return null;
  const tone = SC.tone(px.data, px.w, px.h);
  const stops = SC.gradientStops(px.data, px.w, px.h, { max: 6 });
  const spool = SC.spoolType(px.data, px.w, px.h);
  return { tone, stops, spool };
}

// One image URL → reading (cached; null when the photo cannot be read; "tried" is remembered too).
async function readPhoto(url, opts = {}) {
  const s = store();
  if (url in s) return s[url];
  const load = opts.pixels || require("./image-match.cjs").pixelsFromUrl;
  const px = await load(url, { signal: opts.signal, size: 96 });
  if (opts.signal && opts.signal.aborted) return null; // a cancel is not an answer
  // A photo that could not be downloaded is not remembered as "unusable": a hiccup must not stop it from ever being read.
  if (!px) return null;
  const reading = readPixels(px);
  s[url] = reading;
  return reading;
}

// Fill the photo-based fields of every filament listing. Mutates and returns the listings.
async function applyPhotoReadings(listings, opts = {}) {
  const read = opts.read || readPhoto;
  const log = opts.log || (() => {});
  const todo = (listings || []).filter((l) => l && l.kind === "filament" && /^https?:/i.test(String(l.image || "")));
  const counts = { photos: 0, tones: 0, gradients: 0, spoolFilled: 0, spoolHints: 0 };
  for (let at = 0; at < todo.length; at += 4) {
    await Promise.all(todo.slice(at, at + 4).map(async (l) => {
      opts.signal?.throwIfAborted();
      let r = null;
      try { r = await read(l.image, { signal: opts.signal }); } catch (e) { if (opts.signal?.aborted) throw e; r = null; }
      if (!r) return;
      counts.photos++;
      const guess = { ...(l.guess || {}) };
      // Tone: a gradient takes its distinct stops; a single colour takes the true tone of the filament.
      if (l.multicolor) {
        if (r.stops && r.stops.length >= 2 && !(Array.isArray(l.colorHexes) && l.colorHexes.length > 1 && l.colorHexSource === "eyedropper")) {
          l.colorHexes = r.stops.map((x) => x.hex);
          l.colorHexSource = "photo";
          guess.colorHex = { value: l.colorHexes[0], from: "photo", stops: r.stops.length };
          counts.gradients++;
        }
      } else if (r.tone && r.tone.confidence >= PHOTO_TONE_MIN && l.colorHexSource !== "eyedropper") {
        l.colorHex = r.tone.hex;
        l.colorHexSource = "photo";
        guess.colorHex = { value: r.tone.hex, from: "photo", confidence: r.tone.confidence };
        counts.tones++;
      }
      // Spool material: what the text and your labels said stands when it is sure; the photo fills the rest.
      if (r.spool && !l.spoolMaterial) {
        const prior = guess.spoolMaterial;
        const better = !prior || r.spool.confidence > (prior.confidence || 0);
        if (better) {
          guess.spoolMaterial = { value: r.spool.value, confidence: r.spool.confidence, from: "photo", detail: { flange: r.spool.shellKraft, core: r.spool.midKraft } };
          if (r.spool.confidence >= PHOTO_SPOOL_SURE) { l.spoolMaterial = r.spool.value; l.spoolSource = "photo"; counts.spoolFilled++; } else counts.spoolHints++;
        }
      }
      if (Object.keys(guess).length) l.guess = guess;
    }));
  }
  if (counts.photos) saveStore();
  log({ type: "log", stage: "extract", text: "Photos read: " + counts.photos + " of " + todo.length + " · tones " + counts.tones + " · gradients " + counts.gradients + " · spool filled " + counts.spoolFilled + ", hints " + counts.spoolHints });
  return listings;
}

module.exports = { readPixels, readPhoto, applyPhotoReadings, resetStore, PHOTO_SPOOL_SURE, PHOTO_TONE_MIN };
