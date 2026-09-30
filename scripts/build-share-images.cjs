#!/usr/bin/env node
"use strict";

// The storefront's link-preview picture and app icons, drawn from the brand (the favicon's shapes, the
// site's colours and fonts) with Playwright's Chromium:
//
//   public/assets/og-image.png                 1200×630, what a shared link shows (og:image)
//   public/assets/icons/apple-touch-icon.png   180×180
//   public/assets/icons/icon-192.png           site.webmanifest
//   public/assets/icons/icon-512.png           site.webmanifest (maskable: the mark sits in the safe zone)
//
// Re-run after a brand change:  node scripts/build-share-images.cjs

const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..");
const ASSETS = path.join(ROOT, "public", "assets");
const FONTS = "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@500;600&family=Sora:wght@600;700;800&family=Source+Sans+3:wght@400;600&display=block";
const INK = "#121820";
const TICKET = "#ffc43d";

// The favicon's mark without its rounded background square (public/assets/favicon.svg).
const MARK = `<path d="M7 8h14l4 8-4 8H7V8Z" fill="${TICKET}"/><path d="M7 8v16l-2.2-1.2V9.2L7 8Z" fill="#C49212"/><circle cx="19" cy="16" r="1.6" fill="${INK}"/>`;

const og = `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${FONTS}"><style>
  body { margin: 0; width: 1200px; height: 630px; background: ${INK}; color: #fffdf8; font-family: "Source Sans 3", sans-serif; position: relative; overflow: hidden; }
  .grid { position: absolute; inset: 0; background-image: linear-gradient(rgba(255,255,255,.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.035) 1px, transparent 1px); background-size: 42px 42px; }
  .glow { position: absolute; width: 760px; height: 760px; right: -260px; top: -250px; background: radial-gradient(circle, rgba(255,196,61,.20), rgba(255,196,61,0) 62%); }
  .brand { position: absolute; left: 72px; top: 62px; display: flex; align-items: center; gap: 16px; font-family: Sora; font-weight: 800; font-size: 38px; letter-spacing: -.5px; }
  .brand svg { width: 58px; height: 58px; background: #1c2733; border-radius: 12px; }
  h1 { position: absolute; left: 72px; top: 168px; width: 640px; margin: 0; font-family: Sora; font-weight: 700; font-size: 60px; line-height: 1.06; letter-spacing: -1.5px; }
  h1 em { font-style: normal; color: ${TICKET}; }
  p { position: absolute; left: 72px; top: 430px; width: 600px; margin: 0; font-size: 27px; line-height: 1.35; color: #d3dce4; }
  .foot { position: absolute; left: 72px; bottom: 54px; font-family: "IBM Plex Mono"; font-weight: 500; font-size: 18px; color: #8b98a6; letter-spacing: .4px; }
  .card { position: absolute; right: 70px; top: 128px; width: 392px; background: #fffdf8; color: ${INK}; border-radius: 18px; padding: 24px 26px 14px; box-shadow: 0 34px 70px rgba(0,0,0,.42); transform: rotate(-2.2deg); }
  .card h2 { font-family: Sora; font-weight: 700; font-size: 21px; margin: 0 0 4px; }
  .card small { display: block; font-size: 16px; color: #5c6b78; margin-bottom: 12px; }
  .row { display: flex; align-items: center; justify-content: space-between; padding: 13px 0; border-top: 1px solid #cdd6de; font-family: "IBM Plex Mono"; font-weight: 500; font-size: 20px; }
  .shop { display: flex; align-items: center; gap: 10px; font-family: "Source Sans 3"; font-weight: 600; font-size: 20px; }
  .dot { width: 11px; height: 11px; border-radius: 50%; background: #8b98a6; }
  .best .dot { background: #15803d; }
  .pill { margin-left: 8px; background: ${TICKET}; color: #3a2a00; border-radius: 999px; padding: 3px 10px; font-family: Sora; font-weight: 700; font-size: 13px; }
</style></head><body>
  <div class="grid"></div><div class="glow"></div>
  <div class="brand"><svg viewBox="0 0 32 32">${MARK}</svg>3D Price</div>
  <h1>Every 3D printer and filament price, <em>side by side</em></h1>
  <p>Türkiye'deki mağazaların fiyatları tek sayfada · KDV&nbsp;dahil, stok&nbsp;kontrollü</p>
  <div class="foot">3D PRINTERS · FILAMENT · TÜRKİYE</div>
  <div class="card">
    <h2>One printer, three shops</h2><small>the lowest price first</small>
    <div class="row best"><span class="shop"><i class="dot"></i>Shop 1<span class="pill">BEST</span></span><span>24.990 TL</span></div>
    <div class="row"><span class="shop"><i class="dot"></i>Shop 2</span><span>25.749 TL</span></div>
    <div class="row"><span class="shop"><i class="dot"></i>Shop 3</span><span>26.300 TL</span></div>
  </div>
</body></html>`;

const icon = (size, scale) => `<!doctype html><html><head><meta charset="utf-8"><style>
  html, body { margin: 0; width: ${size}px; height: ${size}px; background: ${INK}; }
  body { display: grid; place-items: center; }
  svg { width: ${Math.round(size * scale)}px; height: ${Math.round(size * scale)}px; }
</style></head><body><svg viewBox="4 6 22 20">${MARK}</svg></body></html>`;

async function main() {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    // Fonts are fetched by Node and handed to the page: the same bytes wherever this runs, and no
    // browser certificate setup needed behind a proxy.
    await context.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/, async (route) => {
      try {
        const r = await fetch(route.request().url(), { headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36" } });
        await route.fulfill({ status: r.status, headers: { "content-type": r.headers.get("content-type") || "", "access-control-allow-origin": "*" }, body: Buffer.from(await r.arrayBuffer()) });
      } catch { await route.abort(); }
    });
    const shoot = async (html, width, height, file) => {
      const page = await context.newPage({ viewport: { width, height } });
      await page.setContent(html, { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      await page.screenshot({ path: file, clip: { x: 0, y: 0, width, height } });
      await page.close();
      console.log("wrote " + path.relative(ROOT, file));
    };
    await shoot(og, 1200, 630, path.join(ASSETS, "og-image.png"));
    await shoot(icon(180, 0.74), 180, 180, path.join(ASSETS, "icons", "apple-touch-icon.png"));
    await shoot(icon(192, 0.74), 192, 192, path.join(ASSETS, "icons", "icon-192.png"));
    await shoot(icon(512, 0.58), 512, 512, path.join(ASSETS, "icons", "icon-512.png"));
  } finally {
    await browser.close();
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
