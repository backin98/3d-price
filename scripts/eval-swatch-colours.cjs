#!/usr/bin/env node
"use strict";

// How close does the photo reader get to the shade YOU picked? Runs public/admin/swatch-colours.js on the product photo of
// every card where you used the eyedropper, and prints the distance (CIEDE2000: under 5 is hard to see, over 15 is another
// colour) next to the distance of the generic table colour the swatch used to show.
//
//   npm run eval-colours                 # all cards with a picked shade (downloads the photos, needs the internet)
//   npm run eval-colours -- --limit 40   # the first 40
//   npm run eval-colours -- --worst 12   # show the 12 furthest misses (default 8)
//   npm run eval-colours -- --selftest   # no network: checks the browser decode path on two generated images
//
// Needs Playwright's Chromium (the same one npm test uses) to decode JPEG / PNG / WebP.

const fs = require("node:fs");
const path = require("node:path");
const SC = require("../public/admin/swatch-colours.js");
const table = require("../data/filament-taxonomy.json").colours;

const args = process.argv.slice(2);
const flag = (name, dflt) => (args.includes(name) ? Number(args[args.indexOf(name) + 1]) || dflt : null);
const limit = flag("--limit", 40);
const worstN = flag("--worst", 8) || 8;
const selftest = args.includes("--selftest");

async function decode(browser, buf, mime) {
  const page = await browser.newPage();
  try {
    return await page.evaluate(async ({ b64, type }) => {
      const img = new Image();
      img.src = "data:" + type + ";base64," + b64;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 96;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, 96, 96);
      return Array.from(ctx.getImageData(0, 0, 96, 96).data);
    }, { b64: buf.toString("base64"), type: mime });
  } finally {
    await page.close().catch(() => {});
  }
}
const mimeOf = (b) => (b[0] === 0x89 ? "image/png" : b[0] === 0xff ? "image/jpeg" : b.subarray(0, 4).toString("latin1") === "RIFF" ? "image/webp" : b[0] === 0x47 ? "image/gif" : "image/jpeg");

(async () => {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
  const browser = await chromium.launch();
  try {
    if (selftest) {
      // A 4×4 red PNG and a gradient, drawn by the browser itself.
      const page = await browser.newPage();
      const urls = await page.evaluate(() => {
        const mk = (draw) => { const c = document.createElement("canvas"); c.width = c.height = 96; const x = c.getContext("2d"); draw(x); return c.toDataURL("image/png"); };
        return [
          mk((x) => { x.fillStyle = "#fff"; x.fillRect(0, 0, 96, 96); x.fillStyle = "#262626"; x.beginPath(); x.arc(48, 48, 44, 0, 7); x.fill(); x.fillStyle = "#c0392b"; x.beginPath(); x.arc(48, 48, 34, 0, 7); x.fill(); x.fillStyle = "#fff"; x.beginPath(); x.arc(48, 48, 14, 0, 7); x.fill(); })
        ];
      });
      await page.close();
      const buf = Buffer.from(urls[0].split(",")[1], "base64");
      const px = await decode(browser, buf, "image/png");
      const t = SC.tone(px, 96, 96);
      const d = SC.deltaE(t.hex, "#c0392b");
      console.log("selftest: tone " + t.hex + " for a #c0392b spool, distance " + d.toFixed(1) + (d < 10 ? "  OK" : "  TOO FAR"));
      process.exit(d < 10 ? 0 : 1);
    }
    const jobs = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "work", "local-store", "jobs.json"), "utf8"));
    const rows = [];
    const seen = new Set();
    for (const job of jobs) {
      for (const card of Object.values(job.cards || {})) {
        if (!card || !card.handEdited || seen.has(card.url)) continue;
        if (card.colorHexSource === "photo" || !/^#[0-9a-f]{6}$/i.test(card.colorHex || "") || card.multicolor || !/^https?:/.test(card.image || "")) continue;
        seen.add(card.url);
        rows.push(card);
      }
    }
    const take = limit ? rows.slice(0, limit) : rows;
    console.log("Cards with a shade you picked and a photo: " + rows.length + (limit ? " (checking " + take.length + ")" : "") + "\n");
    const results = [];
    for (const card of take) {
      try {
        const res = await fetch(card.image, { redirect: "follow", headers: { accept: "image/*" }, signal: AbortSignal.timeout(10000) });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const buf = Buffer.from(await res.arrayBuffer());
        const px = await decode(browser, buf, mimeOf(buf));
        const t = SC.tone(px, 96, 96);
        if (!t) { results.push({ card, none: true }); continue; }
        const generic = table[card.color] ? SC.deltaE(card.colorHex, table[card.color].hex) : null;
        results.push({ card, tone: t, d: SC.deltaE(card.colorHex, t.hex), generic });
        process.stdout.write(".");
      } catch (e) {
        results.push({ card, error: e.message });
        process.stdout.write("x");
      }
    }
    console.log("\n");
    const ok = results.filter((r) => r.d != null);
    const med = (a) => { const s = a.slice().sort((x, y) => x - y); return s.length ? Math.round(s[Math.floor(s.length / 2)] * 10) / 10 : null; };
    const pct = (f) => Math.round((ok.filter(f).length / Math.max(1, ok.length)) * 100);
    console.log("read " + ok.length + " photos (" + results.filter((r) => r.error).length + " failed to load, " + results.filter((r) => r.none).length + " had no usable colour)");
    console.log("photo reader vs your pick:  median " + med(ok.map((r) => r.d)) + "   within 5: " + pct((r) => r.d <= 5) + "%   within 10: " + pct((r) => r.d <= 10) + "%   over 15: " + pct((r) => r.d > 15) + "%");
    const gen = ok.filter((r) => r.generic != null);
    console.log("generic table colour:       median " + med(gen.map((r) => r.generic)) + "   (" + gen.length + " cards)");
    const confident = ok.filter((r) => r.tone.confidence >= 0.6);
    console.log("when it is 60%+ sure:       median " + med(confident.map((r) => r.d)) + "   (" + confident.length + " of " + ok.length + " photos)");
    console.log("\nFurthest misses (send these back so the reader can be tuned):");
    ok.sort((a, b) => b.d - a.d).slice(0, worstN).forEach((r) => console.log("  " + r.d.toFixed(0).padStart(3) + "  you " + r.card.colorHex + "  reader " + r.tone.hex + " (" + Math.round(r.tone.confidence * 100) + "%)  " + String(r.card.sourceTitle || r.card.name).slice(0, 52) + "\n       " + r.card.image));
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
