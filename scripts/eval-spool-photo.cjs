#!/usr/bin/env node
"use strict";

// How well does the photo tell cardboard from plastic? Runs the spool reader on the product photo of every card where YOU set
// the spool material by hand, and compares. Prints, per confidence level, how many cards it would fill and how often it is right,
// plus the confusion table and the furthest misses (with the photo URL) so the reader can be tuned from real photos.
//
//   npm run eval-spool-photo                 # all hand-labelled cards that have a photo (downloads them; needs the internet)
//   npm run eval-spool-photo -- --limit 60   # the first 60
//   npm run eval-spool-photo -- --worst 12   # show 12 misses (default 10)
//   npm run eval-spool-photo -- --selftest   # no network: generated spools, checks the decode path
//
// The run fills the spool field from PHOTO_SPOOL_SURE (0.85 unless PHOTO_SPOOL_SURE is set); choose it from the table below.

const fs = require("node:fs");
const path = require("node:path");
const P = require("../lib/photo-readings.cjs");
const IM = require("../lib/image-match.cjs");

const args = process.argv.slice(2);
const flag = (name, dflt) => (args.includes(name) ? Number(args[args.indexOf(name) + 1]) || dflt : null);
const limit = flag("--limit", 40);
const worstN = flag("--worst", 10) || 10;

(async () => {
  try {
    if (args.includes("--selftest")) {
      const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
      const browser = await chromium.launch();
      const page = await browser.newPage();
      const url = await page.evaluate(() => {
        const c = document.createElement("canvas"); c.width = c.height = 96; const x = c.getContext("2d");
        x.fillStyle = "#fff"; x.fillRect(0, 0, 96, 96);
        x.fillStyle = "#b28b5c"; x.beginPath(); x.arc(48, 48, 44, 0, 7); x.fill();
        x.fillStyle = "#2e6fd0"; x.beginPath(); x.arc(48, 48, 34, 0, 7); x.fill();
        x.fillStyle = "#b9976a"; x.beginPath(); x.arc(48, 48, 14, 0, 7); x.fill();
        return c.toDataURL("image/png");
      });
      await browser.close();
      // data: URLs are not downloadable by the normal path; decode through the same function the run uses
      const http = require("node:http");
      const buf = Buffer.from(url.split(",")[1], "base64");
      const server = http.createServer((q, r) => { r.writeHead(200, { "content-type": "image/png" }); r.end(buf); });
      await new Promise((r) => server.listen(0, "127.0.0.1", r));
      const px = await IM.pixelsFromUrl("http://127.0.0.1:" + server.address().port + "/spool.png", { size: 96 });
      server.close();
      const reading = P.readPixels(px);
      console.log("selftest: " + JSON.stringify(reading && reading.spool) + (reading && reading.spool && reading.spool.value === "cardboard" ? "  OK" : "  WRONG"));
      process.exitCode = reading && reading.spool && reading.spool.value === "cardboard" ? 0 : 1;
      return;
    }
    const store = process.env.LOCAL_STORE || path.join(__dirname, "..", "work", "local-store");
    const jobs = JSON.parse(fs.readFileSync(path.join(store, "jobs.json"), "utf8"));
    const rows = [];
    const seen = new Set();
    for (const job of jobs) {
      for (const card of Object.values(job.cards || {})) {
        if (!card || !card.handEdited || seen.has(card.url)) continue;
        const truth = String(card.spoolMaterial || "").toLowerCase();
        if (!["cardboard", "plastic"].includes(truth) || card.spoolSource === "photo" || !/^https?:/.test(card.image || "")) continue;
        seen.add(card.url);
        rows.push({ card, truth });
      }
    }
    const take = limit ? rows.slice(0, limit) : rows;
    console.log("Cards where you set the spool material and that have a photo: " + rows.length + (limit ? " (checking " + take.length + ")" : "") + "\n");
    const results = [];
    for (const { card, truth } of take) {
      const px = await IM.pixelsFromUrl(card.image, { size: 96 });
      if (!px) { results.push({ card, truth, failed: true }); process.stdout.write("x"); continue; }
      const r = P.readPixels(px);
      results.push({ card, truth, guess: r && r.spool });
      process.stdout.write(r && r.spool ? "." : "-");
    }
    console.log("\n");
    const read = results.filter((r) => !r.failed);
    console.log("photos read: " + read.length + " (" + results.filter((r) => r.failed).length + " failed to load); the reader had an opinion on " + read.filter((r) => r.guess).length);
    const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
    console.log("\nconfidence >=   fills       right");
    for (const floor of [0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9]) {
      const said = read.filter((r) => r.guess && r.guess.confidence >= floor);
      const right = said.filter((r) => r.guess.value === r.truth).length;
      console.log("  " + floor.toFixed(2) + "        " + String(pct(said.length, read.length)).padStart(5) + "%   " + String(pct(right, said.length)).padStart(5) + "%" + (floor === P.PHOTO_SPOOL_SURE ? "   <- the run fills the field from here" : ""));
    }
    const conf = { "cardboard->cardboard": 0, "cardboard->plastic": 0, "plastic->plastic": 0, "plastic->cardboard": 0, "-> no opinion": 0 };
    for (const r of read) conf[r.guess ? r.truth + "->" + r.guess.value : "-> no opinion"]++;
    console.log("\nyou said -> the photo said:");
    Object.entries(conf).forEach(([k, v]) => console.log("  " + k.padEnd(24) + v));
    const wrong = read.filter((r) => r.guess && r.guess.value !== r.truth).sort((a, b) => b.guess.confidence - a.guess.confidence);
    console.log("\nFurthest misses (send these back so the reader can be tuned):");
    wrong.slice(0, worstN).forEach((r) => console.log("  you: " + r.truth.padEnd(9) + " photo: " + r.guess.value.padEnd(9) + " (" + Math.round(r.guess.confidence * 100) + "%)  " + String(r.card.sourceTitle || r.card.name).slice(0, 56) + "\n       " + r.card.image));
  } finally {
    await IM.shutdown();
  }
})().catch((e) => { console.error(e); process.exit(1); });
