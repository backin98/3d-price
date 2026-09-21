// Local online worker for 3D Price.
//
//   node worker/online-worker.cjs
//
// Listens on 127.0.0.1:8788 by default. Admin → AI connection only needs the LM Studio URL.
//
// Required to poll the live site:
//   INGEST_TOKEN      - matches the Netlify site's INGEST_TOKEN
// Optional:
//   ONLINE_URL        - site origin if you want poll-without-admin
//   LOCAL_AI_URL      - fallback AI server if desk has none
//   WORKER_PORT       - HTTP listen port (default 8788)
//   WORKER_HOST       - HTTP bind host (default 127.0.0.1)

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { runWebsiteJob } = require("../lib/qwen-website-job.cjs");
const { setEndpoint, ping, discover } = require("../scripts/local-qwen.cjs");

function loadDotEnv() {
  try {
    const raw = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!m || process.env[m[1]]) continue;
      process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  } catch (_) { /* optional */ }
}
loadDotEnv();

let siteUrl = String(process.env.ONLINE_URL || "https://3d-price.netlify.app").replace(/\/+$/, "");
const TOKEN = process.env.INGEST_TOKEN || "";
const WORKER_NAME = process.env.WORKER_NAME || "local-qwen-worker";
const POLL_MS = Number(process.env.POLL_MS || 5000);
const WORKER_HOST = process.env.WORKER_HOST || "127.0.0.1";
const WORKER_PORT = Number(process.env.WORKER_PORT || 8788);
const hasToken = TOKEN.length >= 16;

if (!hasToken) {
  console.warn("INGEST_TOKEN is not set. Health and Save & connect still work. Polling the live site needs INGEST_TOKEN.");
}

function setSite(raw) {
  const next = String(raw || "").trim().replace(/\/+$/, "");
  if (!next) return siteUrl;
  try {
    const u = new URL(next);
    if (u.protocol !== "http:" && u.protocol !== "https:") return siteUrl;
    siteUrl = u.origin;
  } catch (_) { /* keep previous */ }
  return siteUrl;
}

async function api(search, options = {}) {
  if (!hasToken) throw new Error("INGEST_TOKEN is not set");
  const res = await fetch(siteUrl + "/.netlify/functions/worker?action=" + search, {
    signal: AbortSignal.timeout(10000),
    ...options,
    headers: {
      Authorization: "Bearer " + TOKEN,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || ("Worker HTTP " + res.status));
  return data;
}

async function poll() {
  return api("poll");
}

async function postProgress(jobId, events, progress) {
  return api("progress", {
    method: "POST",
    body: JSON.stringify({ jobId, events, progress })
  });
}

let connection = null;
let detectedModel = null;
let lastCheck = 0;

async function detectModel(desk, opts = {}) {
  const preferred = String((desk && desk.modelUrl) || process.env.LOCAL_AI_URL || "").trim();
  const scan = opts.scan === true || !preferred;
  if (
    !scan
    && connection
    && connection.modelUrl
    && connection.checkId === (desk && desk.modelCheckId)
    && !connection.error
    && Date.now() - lastCheck < 30000
  ) return;
  connection = { modelUrl: preferred, checkId: desk && desk.modelCheckId, models: [], loadedVerified: false, error: "" };
  detectedModel = null;
  try {
    const info = preferred && !scan
      ? await ping(preferred).catch(() => discover(preferred))
      : await discover(preferred);
    const origin = info.origin || preferred;
    setEndpoint(origin);
    connection.modelUrl = origin;
    connection.models = info.usable || [];
    connection.loadedVerified = info.loadedVerified === true;
    connection.flavor = info.flavor || "";
    detectedModel = info.picked || null;
    if (!detectedModel) connection.error = "No loaded chat model. Load a model in your AI server.";
  } catch (err) { connection.error = err.message || "Cannot reach the local AI server"; }
  lastCheck = Date.now();
  connection.checkedAt = new Date(lastCheck).toISOString();
  await postHeartbeat().catch(() => {});
}

async function postHeartbeat() {
  try {
    await api("heartbeat", {
      method: "POST",
      body: JSON.stringify({ model: detectedModel, connection, worker: WORKER_NAME, at: new Date().toISOString() })
    });
  } catch (err) {
    console.warn("Heartbeat failed:", err.message);
  }
}

async function postComplete(jobId, payload) {
  return api("complete", { method: "POST", body: JSON.stringify({ jobId, ...payload }) });
}

function nameFromUrl(url) {
  try {
    const last = decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).pop() || "");
    return last.replace(/[-_]+/g, " ").replace(/\.(html?|php)$/i, "") || url;
  } catch (_) {
    return String(url || "");
  }
}

function compactEvent(ev) {
  const out = { type: ev.type || "log", at: ev.at || new Date().toISOString() };
  if (ev.text) out.text = String(ev.text).slice(0, 1000);
  if (ev.error) out.text = String(ev.error || ev.text || "").slice(0, 1000);
  if (ev.stage) out.stage = ev.stage;
  if (ev.url) out.url = ev.url;
  if (Array.isArray(ev.urls)) out.urls = ev.urls.filter((u) => typeof u === "string").slice(0, 80);
  if (Array.isArray(ev.items)) {
    out.items = ev.items.slice(0, 80).map((it) => ({
      url: String(it.url || "").slice(0, 500),
      name: String(it.name || "").slice(0, 160),
      image: String(it.image || "").slice(0, 500)
    }));
    if (!out.urls) out.urls = out.items.map((it) => it.url).filter(Boolean);
  }
  if (ev.done != null) out.done = ev.done;
  if (ev.total != null) out.total = ev.total;
  if (ev.accepted != null) out.accepted = ev.accepted;
  if (ev.held != null) out.held = ev.held;
  if (ev.pages != null) out.pages = ev.pages;
  if (ev.products != null) out.products = ev.products;
  if (ev.queued != null) out.queued = ev.queued;
  if (ev.listing && ev.listing.name) {
    out.name = ev.listing.name;
    const l = ev.listing;
    out.card = {
      name: l.name || "",
      brand: l.brand || "",
      price: l.price,
      url: l.url || "",
      image: l.image || "",
      kind: l.kind || "",
      polymer: l.polymer || "",
      variant: l.variant || "",
      color: l.color || "",
      weight: l.weight || "",
      diameter: l.diameter || "",
      packaging: l.packaging || ""
    };
    out.decision = {
      action: ev.action || "",
      candidateId: ev.candidateId || "",
      candidateName: ev.candidateName || "",
      shelf: ev.shelf || l.kind || "",
      rule: ev.rule || "",
      matchPath: ev.matchPath || ev.rule || ""
    };
    if (Array.isArray(ev.compared)) {
      out.compared = ev.compared.slice(0, 8).map((c) => ({
        store: String(c.store || "").slice(0, 80),
        price: c.price,
        url: String(c.url || "").slice(0, 500),
        name: String(c.name || "").slice(0, 160)
      }));
    }
  } else if (ev.url) {
    out.card = { name: nameFromUrl(ev.url), url: ev.url, image: "", kind: "", brand: "" };
  }
  return out;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function runClaimedJob(job, desk) {
  console.log(`[${job.id}] Starting ${job.kind} run for ${job.url}`);
  const events = [];
  const abort = new AbortController();
  let flushing = false;
  let flushTimer;
  const flush = async () => {
    if (flushing || abort.signal.aborted) return;
    flushing = true;
    const batch = events.splice(0, events.length);
    try {
      const r = await postProgress(job.id, batch);
      if (r && r.aborted) abort.abort(new Error("Job aborted from the online admin"));
    } catch (err) {
      console.warn("Progress upload failed:", err.message);
      if (!abort.signal.aborted) events.unshift(...batch);
    } finally { flushing = false; }
  };

  const emit = (ev) => {
    const compact = compactEvent(ev);
    console.log("•", compact.text || compact.type || JSON.stringify(compact).slice(0, 200));
    events.push(compact);
    if (events.length >= 12) flush().catch(() => {});
  };

  let beatTimer;
  try {
    // Point local Qwen at the address saved in the online desk.
    try {
      if (desk && desk.modelUrl) setEndpoint(desk.modelUrl);
    } catch (_) { /* keep default */ }

    emit({ type: "log", stage: "boot", text: "Worker claimed this job. Opening " + job.url + " (no model wait)." });
    await flush();
    abort.signal.throwIfAborted();
    flushTimer = setInterval(() => flush().catch(() => {}), 1500);
    beatTimer = setInterval(() => postHeartbeat(), 20000);

    const baseline = await api("catalog", { signal: AbortSignal.any([abort.signal, AbortSignal.timeout(30000)]) });
    abort.signal.throwIfAborted();
    if (!Array.isArray(baseline.catalog?.products) || !Array.isArray(baseline.catalog?.filaments)) throw new Error("Online catalog unavailable; refusing to match against stale local data");
    // ONLINE_CATALOG_FILE lets tests (and anyone running a probe run) point the cache
    // somewhere disposable instead of the working copy.
    const catalogFile = process.env.ONLINE_CATALOG_FILE || path.join(__dirname, "..", "data", "online-catalog.json");
    fs.mkdirSync(path.dirname(catalogFile), { recursive: true });
    fs.writeFileSync(catalogFile, JSON.stringify(baseline.catalog));
    emit({ type: "log", stage: "compare", text: "Loaded current online catalog: " + baseline.catalog.products.length + " products and " + baseline.catalog.filaments.length + " filaments" });
    const shopHost = (() => { try { return new URL(job.url).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; } })();
    const shop = (desk.shops || []).find((s) => s.id === shopHost || (s.url && (() => { try { return new URL(s.url).hostname.replace(/^www\./, "").toLowerCase() === shopHost; } catch { return false; } })()));
    const summary = await runWebsiteJob({
      url: job.url,
      kind: job.kind,
      site: desk && desk.id ? desk.id : undefined,
      vat: job.vat || (shop && shop.vat) || "included",
      maxPages: Number(job.maxPages || 40),
      maxProducts: Number(job.maxProducts || 400),
      catalog: catalogFile,
      applyToCatalog: false,
      autoLlmMatch: (job.autoLlmMatch === undefined ? desk && desk.autoLlmMatch === true : job.autoLlmMatch === true),
      visualMatch: job.visualMatch !== false,
      signal: abort.signal
    }, emit);

    await flush();
    abort.signal.throwIfAborted();
    console.log(`[${job.id}] Run complete — reading candidate from ${summary.candidateFile}`);
    let candidate = null;
    if (summary.candidateFile && fs.existsSync(summary.candidateFile)) {
      candidate = JSON.parse(fs.readFileSync(summary.candidateFile, "utf8"));
    }
    const completed = await postComplete(job.id, { summary, candidate });
    if (completed.aborted) { console.log(`[${job.id}] Aborted; candidate rejected.`); return; }
    console.log(`[${job.id}] Candidate uploaded. Review at ${siteUrl}/admin/`);
  } catch (err) {
    await flush().catch(() => {});
    if (abort.signal.aborted) { console.log(`[${job.id}] Aborted; local work stopped.`); return; }
    const message = err.message || String(err);
    console.error(`[${job.id}] Failed:`, message);
    await postComplete(job.id, { error: message });
  } finally {
    clearInterval(flushTimer);
    clearInterval(beatTimer);
  }
}

let busy = false;

async function claimAndRun() {
  if (busy || !siteUrl || !hasToken) return false;
  let data;
  try {
    data = await poll();
  } catch (err) {
    console.warn("Poll failed:", err.message);
    return false;
  }
  const job = data.job;
  if (!job || job.status === "aborted") return false;
  busy = true;
  try {
    console.log(`[${job.id}] Claimed ${job.status} ${job.kind} ${job.url}`);
    await runClaimedJob(job, data.desk || {});
    return true;
  } finally {
    busy = false;
  }
}

async function kickRun() {
  for (let i = 0; i < 8; i += 1) {
    const ran = await claimAndRun();
    if (ran) return true;
    await sleep(700);
  }
  console.warn("Run requested but no queued job was claimed.");
  return false;
}

function corsHeaders(req) {
  const origin = req.headers.origin || "*";
  const requested = req.headers["access-control-request-headers"];
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": requested || "Content-Type",
    "Access-Control-Allow-Private-Network": "true",
    "Access-Control-Max-Age": "600",
    "Cache-Control": "no-store"
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let n = 0;
    req.on("data", (c) => {
      n += c.length;
      if (n > 1e6) {
        req.destroy();
        reject(new Error("body too large"));
      } else chunks.push(c);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (err) { reject(err); }
    });
    req.on("error", reject);
  });
}

function send(req, res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { ...corsHeaders(req), "Content-Type": "application/json; charset=utf-8" });
  res.end(payload);
}

function listenUrl() {
  const host = WORKER_HOST === "0.0.0.0" ? "127.0.0.1" : WORKER_HOST;
  return "http://" + host + ":" + WORKER_PORT;
}

function startHttp() {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://worker.local");
    if (req.method === "OPTIONS") {
      res.writeHead(204, corsHeaders(req));
      res.end();
      return;
    }
    try {
      if (url.searchParams.get("site")) setSite(url.searchParams.get("site"));
      if ((url.pathname === "/" || url.pathname === "/health") && req.method === "GET") {
        send(req, res, 200, {
          ok: true,
          worker: WORKER_NAME,
          listen: listenUrl(),
          site: siteUrl || null,
          model: detectedModel,
          connection,
          busy
        });
        return;
      }
      if (url.pathname === "/detect" && req.method === "GET") {
        const modelUrl = url.searchParams.get("modelUrl") || "";
        const desk = { modelUrl, modelCheckId: url.searchParams.get("modelCheckId") || "admin" };
        await detectModel(desk, { scan: url.searchParams.get("scan") === "1" || !modelUrl });
        send(req, res, 200, { ok: true, model: detectedModel, connection, listen: listenUrl() });
        return;
      }
      if (url.pathname === "/run" && req.method === "GET") {
        send(req, res, 202, { ok: true, accepted: true, busy, site: siteUrl });
        kickRun().catch((err) => console.warn("Run failed:", err.message));
        return;
      }
      const body = req.method === "POST" ? await readBody(req) : {};
      if (body.site) setSite(body.site);
      if (url.pathname === "/detect" && req.method === "POST") {
        const modelUrl = body.modelUrl || "";
        const desk = { modelUrl, modelCheckId: body.modelCheckId || "admin" };
        await detectModel(desk, { scan: body.scan === true || !modelUrl });
        send(req, res, 200, { ok: true, model: detectedModel, connection, listen: listenUrl() });
        return;
      }
      if (url.pathname === "/rematch" && req.method === "POST") {
        // Aggressive LLM help. The deterministic pass has already run: this asks the local
        // model about the cards it could not sort (or the ones the admin selected), using
        // the current catalog as the candidate pool. Nothing is published here.
        const cards = Array.isArray(body.cards) ? body.cards : [];
        if (!cards.length) {
          send(req, res, 400, { error: "No cards to ask about" });
          return;
        }
        if (busy) {
          send(req, res, 409, { error: "The worker is busy with a run — try again when it finishes" });
          return;
        }
        const catalogFile = process.env.ONLINE_CATALOG_FILE || path.join(__dirname, "..", "data", "online-catalog.json");
        let catalog;
        try {
          catalog = JSON.parse(fs.readFileSync(catalogFile, "utf8"));
        } catch (err) {
          send(req, res, 400, { error: "No local catalog to match against yet (" + err.message + ")" });
          return;
        }
        const { gemmaPick } = require("../lib/qwen-place.cjs");
        const dir = path.join(path.dirname(catalogFile), "qwen-employee");
        const limit = Math.max(1, Math.min(Number(body.limit) || 200, 500));
        const started = Date.now();
        const results = [];
        busy = true;
        try {
          for (const card of cards.slice(0, limit)) {
            const listing = {
              name: String(card.name || "").slice(0, 200),
              brand: String(card.brand || ""),
              kind: card.kind === "filament" ? "filament" : "printer",
              price: Number(card.price) || 0,
              url: String(card.url || ""),
              image: String(card.image || "")
            };
            if (!listing.name || !listing.url) continue;
            const pool = (listing.kind === "filament" ? catalog.filaments : catalog.products) || [];
            const pick = await gemmaPick(listing, pool, { dir });
            results.push({ url: card.url, ...pick });
            console.log("[rematch] " + listing.name.slice(0, 46) + " -> " + pick.action + (pick.matchId ? " " + pick.matchId : "") + (pick.reason ? " — " + pick.reason : ""));
          }
        } finally {
          busy = false;
        }
        send(req, res, 200, { ok: true, asked: results.length, ms: Date.now() - started, model: detectedModel, results });
        return;
      }
      if (url.pathname === "/run" && req.method === "POST") {
        send(req, res, 202, { ok: true, accepted: true, busy, site: siteUrl });
        kickRun().catch((err) => console.warn("Run failed:", err.message));
        return;
      }
      send(req, res, 404, { error: "Unknown worker endpoint" });
    } catch (err) {
      send(req, res, 500, { error: err.message || "Worker request failed" });
    }
  });
  server.listen(WORKER_PORT, WORKER_HOST, () => {
    console.log("Worker listening at " + listenUrl());
  });
  server.on("error", (err) => {
    console.error("Worker HTTP listen failed:", err.message);
  });
}

let backoffMs = Number(process.env.POLL_MS || 5000);
let pollFails = 0;

async function main() {
  startHttp();
  if (hasToken && siteUrl) console.log("Polling site " + siteUrl);
  else console.log("Waiting for the admin to send the site address (AI connection).");
  detectModel({ modelUrl: process.env.LOCAL_AI_URL || "" }, { scan: true }).catch((err) => {
    console.warn("AI auto-detect:", err.message);
  });
  setInterval(() => { if (hasToken && siteUrl) postHeartbeat().catch(() => {}); }, 45000);
  if (hasToken && siteUrl) await postHeartbeat().catch(() => {});
  const scheduleMs = Number(process.env.SCRAPE_EVERY_MS || 21600000);
  if (process.env.SCRAPE_SCHEDULE === '1') {
    console.log('Scheduled shop refresh every ' + scheduleMs + 'ms');
    setInterval(() => {
      if (busy || !hasToken) return;
      kickRun().catch((err) => console.warn('Scheduled scrape:', err.message));
    }, Math.max(scheduleMs, 600000));
  }
  while (true) {
    try {
      if (hasToken && siteUrl) await claimAndRun();
      backoffMs = POLL_MS;
      await sleep(POLL_MS);
    } catch (err) {
      // Exponential backoff, capped. A failed poll used to retry at a flat 2x POLL_MS forever, so a
      // deploy window (functions briefly 404 while Netlify swaps them) produced a wall of identical
      // lines and kept hammering. Now each consecutive failure doubles the wait to a 60s ceiling and
      // one line is logged per failure, including the attempt number and next delay.
      backoffMs = Math.min(Math.max(backoffMs * 2, POLL_MS * 2), 60000);
      pollFails += 1;
      console.warn("Poll failed (attempt " + pollFails + ", retrying in " + Math.round(backoffMs / 1000) + "s): " + err.message);
      await sleep(backoffMs);
      continue;
    }
    pollFails = 0;
    backoffMs = POLL_MS;
  }
}

process.on("SIGINT", () => {
  console.log("Worker stopping.");
  process.exit(0);
});

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
