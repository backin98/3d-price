"use strict";

// Record and replay shop pages, so a shop run can be repeated exactly without the network.
//
//   SCRAPE_RECORD_DIR=dir   every page a run fetches is also saved to dir (a live run on the PC)
//   SCRAPE_REPLAY_DIR=dir   pages come from dir instead of the network. A page that was never
//                           recorded fails like a dead link: a replayed run never goes online.
//
// dir/index.json maps each URL to its file and when it was fetched; the files are the HTML exactly
// as the scraper saw it (after scrolling, for category pages). Recording twice keeps the newest.
// Used by the end-to-end run test and by scripts/shop-report.cjs --record.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

function normalize(url) {
  try {
    const u = new URL(String(url));
    u.hash = "";
    u.hostname = u.hostname.toLowerCase();
    return u.href;
  } catch (_) {
    return String(url || "");
  }
}

function fileFor(url) {
  const u = normalize(url);
  let host = "page";
  try { host = new URL(u).hostname.replace(/^www\./, "").replace(/[^a-z0-9.-]/gi, "_"); } catch (_) { /* keep */ }
  return host + "-" + crypto.createHash("sha1").update(u).digest("hex").slice(0, 16) + ".html";
}

function readIndex(dir) {
  try {
    const index = JSON.parse(fs.readFileSync(path.join(dir, "index.json"), "utf8"));
    return index && typeof index === "object" ? index : {};
  } catch (_) {
    return {};
  }
}

const replayDir = () => process.env.SCRAPE_REPLAY_DIR || "";
const recordDir = () => process.env.SCRAPE_RECORD_DIR || "";

// undefined = replay is off (fetch normally). A string = the recorded page. Throws when replay is on
// and the page was never recorded.
function replay(url) {
  const dir = replayDir();
  if (!dir) return undefined;
  const key = normalize(url);
  const entry = readIndex(dir)[key];
  const file = path.join(dir, (entry && entry.file) || fileFor(key));
  try {
    return fs.readFileSync(file, "utf8");
  } catch (_) {
    const err = new Error("Not in the replay archive: " + key);
    err.code = "REPLAY_MISS";
    throw err;
  }
}

function record(url, html) {
  const dir = recordDir();
  if (!dir || typeof html !== "string") return;
  try {
    fs.mkdirSync(dir, { recursive: true });
    const key = normalize(url);
    const file = fileFor(key);
    fs.writeFileSync(path.join(dir, file), html);
    const index = readIndex(dir);
    index[key] = { file, fetchedAt: new Date().toISOString(), bytes: Buffer.byteLength(html) };
    fs.writeFileSync(path.join(dir, "index.json"), JSON.stringify(index, null, 1));
  } catch (err) {
    console.warn("[page-archive] could not record " + url + ": " + err.message);
  }
}

// Build an archive by hand (tests, fixtures): { url: html }.
function writeArchive(dir, pages) {
  fs.mkdirSync(dir, { recursive: true });
  const index = readIndex(dir);
  for (const [url, html] of Object.entries(pages)) {
    const key = normalize(url);
    const file = fileFor(key);
    fs.writeFileSync(path.join(dir, file), html);
    index[key] = { file, fetchedAt: new Date(0).toISOString(), bytes: Buffer.byteLength(html) };
  }
  fs.writeFileSync(path.join(dir, "index.json"), JSON.stringify(index, null, 1));
}

module.exports = { replay, record, replayDir, recordDir, writeArchive, normalize, fileFor };
