"use strict";

// The local host (scripts/local-server.mjs, what `npm run local` runs) and the real worker
// (worker/online-worker.cjs) on a throwaway store, with secrets made up for this run only.
// Used by scripts/e2e-local-run.cjs (replayed pages) and scripts/shop-report.cjs (live shops).
// Your own store (work/local-store) is only ever read: the files are copied.

const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
  });
}

async function waitFor(url, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try { const r = await fetch(url, { signal: AbortSignal.timeout(2000) }); if (r.ok) return true; } catch { /* not up yet */ }
    await sleep(300);
  }
  throw new Error("timed out waiting for " + url);
}

// out: the folder for the store, logs and pages. copy: store files taken from work/local-store
// (catalog.json left out = an empty catalog). workerEnv: extra worker settings (SCRAPE_REPLAY_DIR ...).
async function startStack({ out, copy = ["desk.json", "baseline.json"], workerEnv = {}, from = path.join(ROOT, "work", "local-store") }) {
  const store = path.join(out, "store");
  fs.mkdirSync(store, { recursive: true });
  for (const key of copy) fs.copyFileSync(path.join(from, key), path.join(store, key));
  if (!copy.includes("catalog.json")) fs.writeFileSync(path.join(store, "catalog.json"), JSON.stringify({ source: { id: "local", name: "local" }, products: [], filaments: [] }));
  fs.writeFileSync(path.join(store, "jobs.json"), "[]");

  const password = crypto.randomBytes(12).toString("hex");
  const salt = crypto.randomBytes(16).toString("hex");
  const secrets = {
    OWNER_PASSWORD_HASH: salt + ":" + crypto.scryptSync(password, salt, 64).toString("hex"),
    SESSION_SECRET: crypto.randomBytes(32).toString("hex"),
    INGEST_TOKEN: crypto.randomBytes(24).toString("hex")
  };
  const sitePort = await freePort();
  const workerPort = await freePort();
  const site = "http://127.0.0.1:" + sitePort;
  const children = [];
  const start = (name, script, env, logFile) => {
    const log = fs.openSync(logFile, "a");
    const child = spawn(process.execPath, [script], { cwd: ROOT, env: { ...process.env, ...env }, stdio: ["ignore", log, log] });
    child.on("exit", (code) => { if (code && !child.stopping) console.log("  " + name + " exited with " + code + " (see " + logFile + ")"); });
    children.push(child);
    return child;
  };
  const stop = () => children.forEach((c) => { if (c.exitCode == null) { c.stopping = true; c.kill("SIGINT"); } });
  process.on("exit", stop);

  start("local host", path.join("scripts", "local-server.mjs"), { ...secrets, SITE_PORT: String(sitePort), SITE_STORE_DIR: store }, path.join(out, "site.log"));
  await waitFor(site + "/", 30000);
  start("worker", path.join("worker", "online-worker.cjs"), {
    INGEST_TOKEN: secrets.INGEST_TOKEN, ONLINE_URL: site, WORKER_PORT: String(workerPort), POLL_MS: "1000",
    ONLINE_CATALOG_FILE: path.join(out, "worker", "online-catalog.json"), ...workerEnv
  }, path.join(out, "worker.log"));
  await waitFor("http://127.0.0.1:" + workerPort + "/health", 30000);

  const login = await fetch(site + "/api/auth", { method: "POST", headers: { "content-type": "application/json", origin: site }, body: JSON.stringify({ password }) });
  const cookie = (login.headers.getSetCookie ? login.headers.getSetCookie() : [login.headers.get("set-cookie")]).map((c) => String(c).split(";")[0]).join("; ");
  if (!login.ok || !cookie) throw new Error("could not sign in to the local host (" + login.status + ")");
  const admin = async (body) => {
    const r = await fetch(site + "/api/admin", { method: body ? "POST" : "GET", headers: { cookie, origin: site, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((body && body.action) + ": " + (data.error || r.status));
    return data;
  };
  return { site, store, password, admin, stop };
}

// Queue a shop run the way the Shops tab does and wait for the worker to finish it.
async function runShop(admin, run, { minutes = 30 } = {}) {
  const { job } = await admin({ action: "createJob", type: "shop", url: run.url, kind: run.kind });
  const started = Date.now();
  let current = job;
  while (Date.now() - started < minutes * 60000) {
    await sleep(2000);
    current = ((await admin()).jobs || []).find((j) => j.id === job.id) || current;
    if (["complete", "failed", "aborted"].includes(current.status)) break;
  }
  if (!["complete", "failed", "aborted"].includes(current.status)) {
    await admin({ action: "abortJob", id: job.id }).catch(() => {});
    current = { ...current, status: "timed out after " + minutes + " min" };
  }
  return { job: current, cards: Object.values(current.cards || {}), seconds: Math.round((Date.now() - started) / 1000) };
}

// What a category says about itself: the categories on a shop in the desk, with the run kind the admin
// would pick for them (lib: public/admin/admin.js kindForCategory).
function kindForCategory(name) {
  const c = String(name || "").toLowerCase();
  if (c.includes("filament")) return "filament";
  if (c.includes("printer") || c.includes("yaz")) return "printer";
  return "both";
}

module.exports = { ROOT, sleep, hostOf, freePort, waitFor, startStack, runShop, kindForCategory };
