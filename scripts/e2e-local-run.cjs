#!/usr/bin/env node
"use strict";

// End to end on this machine, no network: shop run -> review board -> publish -> storefront.
//
// Starts the local host (scripts/local-server.mjs, what `npm run local` runs) on a throwaway store and
// the real worker (worker/online-worker.cjs) pointed at it with ONLINE_URL, replaying saved shop pages
// (lib/page-archive.cjs). Queues shop runs through the admin API like the Shop runs tab, then works the
// admin page in a real browser the way you would: discard the listings a run held out as another
// category, Select all -> Save & publish selected on the review board, then Force publish all on
// Uncertain (confirming the new products). Checks /api/hunt (what the storefront shows) and runs each
// shop a second time to see that nothing changes and nothing duplicates.
//
//   node scripts/e2e-local-run.cjs                  # report in work/e2e/<time>/report.md
//   node scripts/e2e-local-run.cjs --out DIR --screens
//
// Needs Playwright's Chromium (the worker needs it anyway). Exit code 1 when a check fails.
// Pages come from scripts/fixtures/pages. A listing whose product page was never saved cannot be
// replayed; it is reported as "not archived", not as a failure (a live run reads it).

const fs = require("node:fs");
const path = require("node:path");
const archive = require("../lib/page-archive.cjs");
const { classifyProductType } = require("../lib/product-type.cjs");
const { harvestCategory } = require("../lib/harvest.js");
const { decidePair } = require("../lib/product-match.cjs");
const { hostOf, startStack, runShop: queueRun } = require("./local-stack.cjs");

const ROOT = path.join(__dirname, "..");
const PAGES = path.join(__dirname, "fixtures", "pages");
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
const OUT = path.resolve(option("--out", path.join(ROOT, "work", "e2e", new Date().toISOString().replace(/[:.]/g, "-"))));

const RUNS = [
  { shop: "Rhino 3D Printer", kind: "printer", url: "https://www.rhino3dprinter.com/3d-yazicilar", page: "rhino-3d-yazicilar.html" },
  { shop: "3D Teknomarket", kind: "printer", url: "https://www.3dteknomarket.com/collections/fdm-yazicilar", page: "teknomarket-fdm-yazicilar.html" },
  { shop: "Rhino 3D Printer", kind: "filament", url: "https://www.rhino3dprinter.com/filament-cesitleri", page: "rhino-filament-cesitleri.html" }
];
const PRICE_RANGE = { printer: [3000, 1000000], filament: [100, 20000] };

const checks = [];
function check(ok, text, detail) {
  checks.push({ ok: !!ok, text, detail: detail || "" });
  console.log((ok ? "  ok   " : "  FAIL ") + text + (detail && !ok ? " — " + detail : ""));
}
const notes = [];
function note(text) { notes.push(text); console.log("  note " + text); }

const notArchived = (c) => /Not in the replay archive/.test(String(c.error || ""));
const heldOut = (c) => !!(c.mismatch || c.error === "category_mismatch");

// --- the admin page, driven like a person would ---------------------------------------------------
async function openAdmin(browser, site, password) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on("dialog", (d) => d.accept().catch(() => {}));
  // Fonts come from Google; they do not matter here and must not hold a page load.
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  await page.goto(site + "/admin/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#login:not([hidden]), #app:not([hidden])", { timeout: 30000 });
  if (await page.isVisible("#login")) {
    await page.fill("#password", password);
    await page.click("#login-form button[type=submit]");
  }
  await page.waitForSelector("#app:not([hidden])", { timeout: 30000 });
  return page;
}

async function toastAfter(page, act) {
  await page.evaluate(() => { const t = document.querySelector("#toast"); if (t) { t.textContent = ""; t.hidden = true; } });
  await act();
  await page.waitForFunction(() => { const t = document.querySelector("#toast"); return t && !t.hidden && t.textContent.trim(); }, null, { timeout: 120000 });
  return (await page.textContent("#toast")).trim();
}

async function publishBoard(page, jobId) {
  await page.click('[data-tab="runs"]');
  await page.waitForSelector("#review-job-select", { timeout: 30000 });
  await toastAfter(page, () => page.selectOption("#review-job-select", jobId));
  await page.waitForSelector("#select-all", { timeout: 30000 });
  // The listings the run held out as another category (the ⚠ cards): Discard, like a person would.
  let discarded = 0;
  for (let guard = 0; guard < 60; guard++) {
    const btn = await page.$("[data-mismatch-discard]");
    if (!btn) break;
    await toastAfter(page, () => btn.click());
    discarded += 1;
  }
  await page.click("#select-all");
  const selected = Number(((await page.textContent("#publish-selected")) || "").replace(/\D+/g, "")) || 0;
  const text = selected ? await toastAfter(page, () => page.click("#publish-selected")) : "nothing selected";
  const published = Number((text.match(/(\d+) published/) || [])[1] || 0);
  const deferred = Number((text.match(/(\d+) sent to Uncertain/) || [])[1] || 0);
  const skipped = Number((text.match(/(\d+) skipped/) || [])[1] || 0);
  return { discarded, selected, published, deferred, skipped, text };
}

async function publishUncertain(page) {
  await page.click('[data-tab="uncertain"]');
  await page.waitForSelector("#uncertain-publish-all", { timeout: 30000 });
  const label = (await page.textContent("#uncertain-publish-all")) || "";
  const waiting = Number(label.replace(/\D+/g, "")) || 0;
  if (!waiting || await page.isDisabled("#uncertain-publish-all")) return { waiting: 0, published: 0, text: "nothing on Uncertain" };
  const names = await page.$$eval("#tab-uncertain .uncertain-card", (els) => els.map((el) => (el.querySelector('[data-uncertain-field="name"]') || {}).value || el.dataset.uncertainUrl));
  const text = await toastAfter(page, () => page.click("#uncertain-publish-all"));
  return { waiting, names, published: Number((text.match(/(\d+) published/) || [])[1] || 0), text };
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  console.log("e2e: " + path.relative(ROOT, OUT));
  let chromium;
  try { ({ chromium } = require("playwright")); } catch (err) { throw new Error("Playwright is needed for the admin steps: npm install (" + err.message + ")"); }

  // 1. Replay archive: the saved shop pages under the URLs the runs will open.
  const pages = {};
  for (const run of RUNS) pages[run.url] = fs.readFileSync(path.join(PAGES, run.page), "utf8");
  archive.writeArchive(path.join(OUT, "archive"), pages);

  // What each saved category page shows, read straight from the page: the yardstick for the runs.
  for (const run of RUNS) {
    const shown = await harvestCategory({ categoryUrl: run.url, kind: run.kind, html: pages[run.url], inStockOnly: true });
    run.expected = new Map(shown.inScope.map((p) => [p.url, p]));
    run.heldOut = shown.mismatches.map((m) => m.url);
  }

  // 2. The local host and the real worker on a throwaway store (your desk and baseline, an empty
  // catalog), the worker replaying the saved pages.
  let browser = null;
  const stack = await startStack({ out: OUT, workerEnv: { SCRAPE_REPLAY_DIR: path.join(OUT, "archive") } });
  const { site, password, admin } = stack;
  check(true, "owner sign-in on the local host");
  try {
    browser = await chromium.launch();
    const desk = await openAdmin(browser, site, password);
    check(true, "admin page signs in and loads");

    async function runShop(run, label) {
      const res = await queueRun(admin, run, { minutes: 10 });
      console.log("\n" + label + ": " + run.shop + " " + run.kind + " — " + res.job.status + " in " + res.seconds + "s, " + res.cards.length + " cards");
      return res;
    }

    function checkRun(run, res, label) {
      const { job, cards } = res;
      const name = run.shop + " " + run.kind + (label ? " (" + label + ")" : "");
      check(job.status === "complete", name + " run completes", job.error || job.progress);
      const listed = cards.filter((c) => !notArchived(c) && !heldOut(c));
      const missing = cards.filter(notArchived);
      if (missing.length) note(name + ": " + missing.length + " listings need their product page, which is not in the saved pages (a live run reads them): " + missing.map((c) => c.name).join(", "));
      const found = new Set(cards.map((c) => c.url));
      const lost = [...run.expected.keys()].filter((u) => !found.has(u));
      check(!lost.length, name + ": every buyable listing on the category page reaches the board (" + run.expected.size + ")", lost.slice(0, 4).join(", "));
      const extra = cards.filter((c) => !run.expected.has(c.url) && !heldOut(c));
      check(!extra.length, name + ": no card that is not a listing on the page", extra.slice(0, 4).map((c) => c.url).join(", "));
      const foreign = cards.filter((c) => hostOf(c.url) !== hostOf(run.url));
      check(!foreign.length, name + ": cards are all from " + hostOf(run.url), foreign.slice(0, 3).map((c) => c.url).join(", "));
      const held = cards.filter(heldOut).map((c) => c.url).sort();
      check(JSON.stringify(held) === JSON.stringify([...run.heldOut].sort()), name + ": parts and modules held out as another category (" + run.heldOut.length + ")", "held " + held.join(", "));
      const wrong = listed.filter((c) => { const t = classifyProductType(c.sourceTitle || c.name, c.brand); return t !== run.kind && t !== "other"; });
      check(!wrong.length, name + ": every listing is a " + run.kind, wrong.slice(0, 3).map((c) => c.sourceTitle || c.name).join(", "));
      const [lo, hi] = PRICE_RANGE[run.kind];
      const badPrice = listed.filter((c) => { const p = Number(c.price); const shown = run.expected.get(c.url); return !(p >= lo && p <= hi) || (shown && Math.abs(p - shown.price) > 0.01); });
      check(!badPrice.length, name + ": prices are the page's full price", badPrice.slice(0, 3).map((c) => c.name + " " + c.price).join(", "));
      const noImage = listed.filter((c) => !/^https?:\/\//.test(String(c.image || "")));
      check(!noImage.length, name + ": every listing has its image", noImage.slice(0, 3).map((c) => c.name).join(", "));
      if (run.kind === "filament") {
        const odd = listed.filter((c) => !c.polymer || !/^\d+ g$/.test(String(c.weight || "")) || !/^\d\.\d+ mm$/.test(String(c.diameter || "")));
        check(!odd.length, name + ": every spool has polymer, weight and diameter", odd.slice(0, 3).map((c) => [c.name, c.polymer, c.weight, c.diameter].join(" / ")).join(", "));
        const noColour = listed.filter((c) => !c.color && !c.multicolor);
        if (noColour.length) note(name + ": no colour read for " + noColour.map((c) => c.sourceTitle || c.name).join(", "));
      }
      return listed;
    }

    const results = [];
    const boards = [];
    for (const run of RUNS) {
      const res = await runShop(run, "run");
      results.push({ run, ...res });
      checkRun(run, res);
      const board = await publishBoard(desk, res.job.id);
      boards.push({ run, ...board });
      console.log("  board: " + board.text + (board.discarded ? " · discarded " + board.discarded : ""));
      check(board.published + board.deferred + board.skipped === board.selected && board.selected > 0, run.shop + " " + run.kind + ": Save & publish accounts for every selected card (" + board.selected + ")", board.text);
    }
    const uncertain = await publishUncertain(desk);
    console.log("\nUncertain: " + uncertain.text);

    // 6. What the storefront gets.
    const hunt = await (await fetch(site + "/api/hunt")).json();
    const products = hunt.products || [];
    const filaments = hunt.filaments || [];
    console.log("\nstorefront: " + products.length + " printers, " + filaments.length + " filaments");
    const listedPrinters = results.filter((r) => r.run.kind === "printer").flatMap((r) => r.cards.filter((c) => !notArchived(c) && !heldOut(c)));
    const listedSpools = results.filter((r) => r.run.kind === "filament").flatMap((r) => r.cards.filter((c) => !notArchived(c) && !heldOut(c)));
    const offerUrls = (list) => new Set(list.flatMap((p) => (p.offers || []).map((o) => o.url)));
    const shownPrinters = offerUrls(products);
    const shownSpools = offerUrls(filaments);
    const printerGap = listedPrinters.filter((c) => !shownPrinters.has(c.url));
    check(!printerGap.length, "every printer listing is on the storefront (" + listedPrinters.length + ")", printerGap.slice(0, 4).map((c) => c.name).join(", "));
    const spoolGap = listedSpools.filter((c) => !shownSpools.has(c.url));
    check(!spoolGap.length, "every spool is on the storefront (" + listedSpools.length + " spools in " + filaments.length + " filament cards)", spoolGap.slice(0, 4).map((c) => c.sourceTitle || c.name).join(", "));
    // The same printer at two shops is one product with two prices, wherever both listings replay.
    const crossShop = products.filter((p) => new Set((p.offers || []).map((o) => hostOf(o.url))).size > 1);
    const asListing = (c) => ({ id: c.url, name: c.sourceTitle || c.name, brand: c.brand, kind: "printer" });
    const samePrinter = [];
    for (const a of listedPrinters) {
      for (const b of listedPrinters) {
        if (a.url < b.url && hostOf(a.url) !== hostOf(b.url) && decidePair(asListing(a), asListing(b)).action === "merge") samePrinter.push([a, b]);
      }
    }
    if (!samePrinter.length) note("no printer model is replayable at both shops (the overlaps need product pages the saved pages lack), so no cross-shop comparison is expected here; scripts/match-rules.test.cjs covers 1,000+ real cross-shop pairs");
    for (const [a, b] of samePrinter) {
      const row = products.find((p) => (p.offers || []).some((o) => o.url === a.url));
      check(row && row.offers.some((o) => o.url === b.url), "compared across shops: " + a.name + " = " + b.name);
    }
    const printerParts = products.filter((p) => !["printer", "other"].includes(classifyProductType(p.name, p.brand)));
    check(!printerParts.length, "no part, module or laser on the printer shelf", printerParts.map((p) => p.name).join(", "));
    const filamentOdd = filaments.filter((p) => !p.polymer);
    check(!filamentOdd.length, "every filament card has a polymer", filamentOdd.slice(0, 3).map((p) => p.name).join(", "));
    const spoolOffers = filaments.flatMap((p) => p.offers || []);
    const noWeight = spoolOffers.filter((o) => !/^\d+ g$/.test(String(o.weight || "")));
    check(!noWeight.length, "every spool offer carries its weight", noWeight.length + " of " + spoolOffers.length + " without");
    const noColourName = spoolOffers.filter((o) => !o.colorName && !/rainbow/i.test(o.sourceTitle || ""));
    if (noColourName.length) note("spool offers without a colour name: " + noColourName.map((o) => o.sourceTitle).join(", "));
    const bundles = products.filter((p) => /bundle|enclosed kit/i.test(p.name));
    for (const b of bundles) {
      const bare = products.find((p) => p !== b && (p.offers || []).some((o) => (b.offers || []).some((x) => x.url === o.url)));
      check(!bare, "bundle stays its own product: " + b.name);
    }

    // 7. The same shops again: same listings, same prices, nothing new on the shelf.
    const before = { products: products.length, filaments: filaments.length, offers: products.flatMap((p) => p.offers || []).length + spoolOffers.length };
    const again = [];
    for (const run of [RUNS[0], RUNS[2]]) {
      const res = await runShop(run, "run again");
      again.push({ run, ...res, again: true });
      checkRun(run, res, "again");
      const first = results.find((r) => r.run === run);
      const key = (c) => c.url + "|" + c.price;
      const a = new Set(first.cards.filter((c) => !notArchived(c)).map(key));
      const b = new Set(res.cards.filter((c) => !notArchived(c)).map(key));
      const diff = [...a].filter((x) => !b.has(x)).concat([...b].filter((x) => !a.has(x)));
      check(!diff.length, run.shop + " " + run.kind + ": a second run finds the same listings at the same prices", diff.slice(0, 4).join(" · "));
      const fresh = res.cards.filter((c) => c.decision && (c.decision.action === "create" || c.decision.action === "held") && !notArchived(c) && !heldOut(c));
      check(!fresh.length, run.shop + " " + run.kind + ": the second run lands on what the first published (no new or held cards)", fresh.slice(0, 4).map((c) => c.name + " (" + c.decision.action + ": " + (c.decision.reason || "") + ")").join(", "));
      const board = await publishBoard(desk, res.job.id);
      boards.push({ run, again: true, ...board });
      console.log("  board: " + board.text);
    }
    const huntAgain = await (await fetch(site + "/api/hunt")).json();
    const after = { products: (huntAgain.products || []).length, filaments: (huntAgain.filaments || []).length, offers: [...(huntAgain.products || []), ...(huntAgain.filaments || [])].flatMap((p) => p.offers || []).length };
    check(JSON.stringify(after) === JSON.stringify(before), "publishing the second runs changes nothing on the storefront", JSON.stringify(before) + " → " + JSON.stringify(after));

    // 8. Screens of the storefront and the admin board, for a human look.
    if (flag("--screens")) {
      const shot = async (url, file, width, height, js) => {
        const p = await browser.newPage({ viewport: { width, height } });
        await p.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
        await p.goto(url, { waitUntil: "networkidle" }).catch(() => {});
        if (js) await p.evaluate(js).catch(() => {});
        await p.waitForTimeout(800);
        await p.screenshot({ path: path.join(OUT, file) });
        await p.close();
      };
      await shot(site + "/", "storefront-printers.png", 1440, 900, "window.scrollTo(0, 560)");
      await shot(site + "/", "storefront-filament.png", 1440, 900, "document.querySelector('[data-world=filament]')?.click(); window.scrollTo(0, 560)");
      await desk.click('[data-tab="catalog"]').catch(() => {});
      await desk.waitForTimeout(800);
      await desk.screenshot({ path: path.join(OUT, "admin-catalog.png") });
    }

    // 9. Report.
    const lines = ["# End-to-end shop run (replayed pages)", "", "When: " + new Date().toISOString(), ""];
    lines.push("| Run | Status | Seconds | Cards | Merged | Created | Held | Not archived | Board: published / to Uncertain |", "|---|---|---|---|---|---|---|---|---|");
    for (const r of [...results, ...again]) {
      const n = (a) => r.cards.filter((c) => c.decision && c.decision.action === a).length;
      const board = boards.find((b) => b.run === r.run && !!b.again === !!r.again) || {};
      lines.push(`| ${r.run.shop} ${r.run.kind}${r.again ? " (again)" : ""} | ${r.job.status} | ${r.seconds} | ${r.cards.length} | ${n("merge") + n("updated")} | ${n("create")} | ${n("held")} | ${r.cards.filter(notArchived).length} | ${board.published || 0} / ${board.deferred || 0} |`);
    }
    lines.push("", "Uncertain: " + uncertain.text + (uncertain.names && uncertain.names.length ? " — " + uncertain.names.join(", ") : ""));
    lines.push("", "Storefront: " + products.length + " printers (" + crossShop.length + " compared across shops), " + filaments.length + " filament cards with " + spoolOffers.length + " spools.", "", "## Checks", "");
    for (const c of checks) lines.push("- " + (c.ok ? "✅" : "❌") + " " + c.text + (c.detail && !c.ok ? " — " + c.detail : ""));
    if (notes.length) lines.push("", "## Notes", "", ...notes.map((n) => "- " + n));
    fs.writeFileSync(path.join(OUT, "report.md"), lines.join("\n") + "\n");
    fs.writeFileSync(path.join(OUT, "hunt.json"), JSON.stringify(huntAgain, null, 1));
  } finally {
    if (browser) await browser.close().catch(() => {});
    stack.stop();
  }
  const failed = checks.filter((c) => !c.ok);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " checks passed · " + path.relative(ROOT, path.join(OUT, "report.md")));
  process.exitCode = failed.length ? 1 : 0;
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
