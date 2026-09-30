#!/usr/bin/env node
"use strict";

// Rebuilds scripts/fixtures/pages/rhino-filament-cesitleri.html: Rhino's filament category page.
//
// Nobody saved that page while it was live, but a real Rhino filament run did save every listing it
// read (work/local-store/jobs.json, job-mun1qh3x-6znj10: 328 cards with the shop's own title, URL,
// image and price). This puts those listings back into Rhino's real category-card markup, cloned
// from the saved printer category page next to this file, so a filament shop run can be replayed
// end to end. Like the live shop, the cards stamp "Bambu Lab" as the brand of RhinoLab and Filamix
// spools. Stock is in-stock (the run only kept buyable listings).
//
//   node scripts/fixtures/pages/build-rhino-filament-page.cjs [count]

const fs = require("node:fs");
const path = require("node:path");

const HERE = __dirname;
const ROOT = path.join(HERE, "..", "..", "..");
const COUNT = Number(process.argv[2]) || 48;

const printerPage = fs.readFileSync(path.join(HERE, "rhino-3d-yazicilar.html"), "utf8");
const COL = '<div class="col-6 col-sm-6 col-md-6 col-lg-3 col-xl-3 col-list-p-v-1">';
const TITLE = "Bambu Lab A1 Mini Combo 3D Yazıcı - STOKTAN";
const URL = "https://www.rhino3dprinter.com/bambu-lab-a1-mini-combo-3d-printer";

const at = printerPage.indexOf(TITLE);
const start = printerPage.lastIndexOf(COL, at);
const end = printerPage.indexOf(COL, at);
const card = printerPage.slice(start, end);
const firstCard = printerPage.indexOf(COL);
const lastCard = printerPage.lastIndexOf(COL);
const gridEnd = printerPage.indexOf(COL, lastCard) >= 0
  ? printerPage.indexOf("</div></div></div></div></div>", printerPage.indexOf("Sepete Ekle", lastCard)) + "</div></div></div></div></div>".length
  : lastCard;

const job = JSON.parse(fs.readFileSync(path.join(ROOT, "work", "local-store", "jobs.json"), "utf8"))
  .find((j) => j.id === "job-mun1qh3x-6znj10");
if (!job) throw new Error("the saved Rhino filament run is not in work/local-store/jobs.json");

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const price = (n) => new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) + " TL";

// A spread of materials, brands and colours, deterministic.
const rows = Object.values(job.cards)
  .filter((c) => c.sourceTitle && c.url && c.price > 0 && c.image)
  .sort((a, b) => a.url.localeCompare(b.url));
const picked = [];
const seenFamily = new Map();
for (const c of rows) {
  const family = [c.brand, c.polymer, c.variant].join("|");
  if ((seenFamily.get(family) || 0) >= 3) continue;
  seenFamily.set(family, (seenFamily.get(family) || 0) + 1);
  picked.push(c);
  if (picked.length >= COUNT) break;
}

const cards = picked.map((c, i) => {
  const shopBrand = /rhinolab|filamix/i.test(c.sourceTitle) ? "Bambu Lab" : (c.brand || "Bambu Lab");
  return card
    .split(URL).join(c.url)
    .split(TITLE).join(esc(c.sourceTitle))
    .replace(/(<div class="brand">\s*)Bambu Lab(\s*<\/div>)/, "$1" + esc(shopBrand) + "$2")
    .replace("20.408,05 TL", price(c.price))
    .replace(/data-src="[^"]*"/g, 'data-src="' + esc(c.image) + '"')
    .split("5855").join(String(90000 + i));
});

const html = printerPage.slice(0, firstCard)
  .replace(/3D Yazıcılar/g, "Filament Çeşitleri")
  + cards.join("")
  + printerPage.slice(gridEnd);

const out = path.join(HERE, "rhino-filament-cesitleri.html");
fs.writeFileSync(out, html);
console.log("wrote " + path.relative(ROOT, out) + ": " + cards.length + " filament cards from " + job.id);
