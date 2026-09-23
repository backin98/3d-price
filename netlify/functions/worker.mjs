// /api/worker — local worker bridge for online shop runs (Netlify Functions v2).
import store from "../../lib/netlify-store.cjs";
import auth from "../../lib/netlify-auth.cjs";
import stock from "../../lib/stock-refresh.cjs";

const { readJSON, writeJSON } = store;
const { workerAuth } = auth;
const { rollupProductStock } = stock;

function json(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}

function toHeaders(req) {
  const out = {};
  for (const [key, value] of req.headers.entries()) out[key] = value;
  return out;
}

async function getJobs() {
  const jobs = await readJSON("jobs.json", []);
  return Array.isArray(jobs) ? jobs : [];
}

async function saveJobs(jobs) {
  jobs.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  await writeJSON("jobs.json", jobs);
}

function nameFromUrl(url) {
  try {
    const last = decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).pop() || "");
    return last.replace(/[-_]+/g, " ").replace(/\.(html?|php)$/i, "") || url;
  } catch (_) {
    return String(url || "");
  }
}

function unionCatalog(live, candidate) {
  const products = [...((live && live.products) || [])];
  const filaments = [...((live && live.filaments) || [])];
  if (!candidate) return { ...live, products, filaments };
  const byId = new Map();
  const byUrl = new Map();
  for (const p of [...products, ...filaments]) {
    if (p && p.id) byId.set(p.id, p);
    for (const o of p.offers || []) if (o && o.url) byUrl.set(o.url, p);
  }
  const add = (p) => {
    if (!p || !p.id) return;
    const hit = byId.get(p.id) || (p.offers || []).map((o) => byUrl.get(o.url)).find(Boolean);
    if (hit) {
      hit.offers = hit.offers || [];
      for (const o of p.offers || []) {
        if (o && o.url && !hit.offers.some((e) => e.url === o.url)) hit.offers.push(o);
      }
      return;
    }
    (p.kind === "filament" ? filaments : products).push(p);
    byId.set(p.id, p);
    for (const o of p.offers || []) if (o && o.url) byUrl.set(o.url, p);
  };
  for (const p of candidate.products || []) add(p);
  for (const p of candidate.filaments || []) add(p);
  return { ...live, products, filaments, productCount: products.length, filamentCount: filaments.length };
}

function mergeCards(job, incoming) {
  job.cards = job.cards && typeof job.cards === "object" ? job.cards : {};
  const dropped = new Set(job.dropped || []);
  for (const ev of incoming || []) {
    for (const url of ev.urls || []) {
      if (typeof url !== "string" || dropped.has(url)) continue;
      if (!job.cards[url]) job.cards[url] = { name: nameFromUrl(url), url };
    }
    for (const it of ev.items || []) {
      if (!it || typeof it.url !== "string" || dropped.has(it.url)) continue;
      const prev = job.cards[it.url] || { url: it.url };
      job.cards[it.url] = {
        ...prev,
        url: it.url,
        name: it.name || prev.name || nameFromUrl(it.url),
        image: it.image || prev.image || ""
      };
    }
    if (ev.card && ev.card.url) {
      if (dropped.has(ev.card.url)) continue;
      const prev = job.cards[ev.card.url] || {};
      job.cards[ev.card.url] = {
        ...prev,
        ...ev.card,
        decision: ev.decision || prev.decision,
        compared: ev.compared || prev.compared,
        error: ev.error || prev.error
      };
    } else if (ev.url) {
      if (dropped.has(ev.url)) continue;
      const prev = job.cards[ev.url] || { name: nameFromUrl(ev.url), url: ev.url };
      job.cards[ev.url] = { ...prev, error: ev.error || ev.text || prev.error };
    }
  }
}

export default async (req) => {
  const headers = toHeaders(req);
  if (!workerAuth({ headers })) return json(401, { error: "Unauthorized" });

  const url = new URL(req.url);
  const action = url.searchParams.get("action") || "";
  try {
    if (req.method === "GET" && action === "catalog") {
      const catalog = await readJSON("catalog.json", null);
      if (!catalog || !Array.isArray(catalog.products) || !Array.isArray(catalog.filaments)) return json(503, { error: "Online catalog unavailable; matching cannot proceed" });
      const candidate = await readJSON("candidate.json", null);
      const baseline = await readJSON("baseline.json", { items: [] });
      return json(200, { catalog: unionCatalog(catalog, candidate), baseline });
    }
    if (req.method === "GET" && action === "stock-catalog") {
      const catalog = await readJSON("catalog.json", null);
      if (!catalog || !Array.isArray(catalog.products) || !Array.isArray(catalog.filaments)) return json(503, { error: "Online catalog unavailable" });
      return json(200, { catalog });
    }
    if (req.method === "GET" && (action === "poll" || url.pathname.endsWith("/poll"))) {
      const jobs = await getJobs();
      const now = Date.now();
      let dirty = false;
      for (const j of jobs) {
        if (j.status === "running" && j.updatedAt && now - Date.parse(j.updatedAt) > 180000) {
          j.status = "queued";
          j.progress = "Requeued after worker stall";
          dirty = true;
        }
      }
      const queued = jobs.find((j) => j.status === "queued");
      const running = jobs.find((j) => j.status === "running");
      const job = queued || running || null;
      if (queued) {
        queued.status = "running";
        queued.startedAt = queued.startedAt || new Date().toISOString();
        queued.updatedAt = new Date().toISOString();
        queued.progress = "Claimed by the local worker";
        queued.events = queued.events || [];
        queued.events.push({ type: "log", at: new Date().toISOString(), text: "Worker claimed this job." });
        dirty = true;
      }
      if (dirty) await saveJobs(jobs);
      const desk = await readJSON("desk.json", { modelUrl: "", workerUrl: "", shops: [], banners: [], promoted: [] });
      return json(200, { ok: true, job, desk, heartbeat: await readJSON("heartbeat.json", null) });
    }

    const body = await req.json().catch(() => ({}));

    if (req.method === "POST" && action === "stock") {
      const catalog = await readJSON("catalog.json", null);
      if (!catalog || !Array.isArray(catalog.products) || !Array.isArray(catalog.filaments)) return json(503, { error: "Online catalog unavailable" });
      const allowed = new Set(["in_stock", "out_of_stock", "preorder", "dropshipping", "unknown"]);
      const incoming = new Map((Array.isArray(body.results) ? body.results : []).slice(0, 100)
        .filter((r) => r && typeof r.url === "string" && allowed.has(r.after))
        .map((r) => [r.url, r]));
      const now = Date.now();
      let updated = 0;
      for (const product of [...catalog.products, ...catalog.filaments]) {
        let touched = false;
        for (const offer of product.offers || []) {
          const result = incoming.get(offer.url);
          if (!result) continue;
          Object.assign(offer, {
            stockStatus: result.after,
            stockVerified: result.verified === true && result.after !== "unknown",
            stockCheckedAt: result.checkedAt || new Date(now).toISOString(),
            stockCheckMethod: String(result.method || "worker").slice(0, 80),
            stockPolicyVersion: 3
          });
          touched = true;
          updated += 1;
        }
        if (touched) rollupProductStock(product, now);
      }
      catalog.savedAt = new Date(now).toISOString();
      await writeJSON("catalog.json", catalog);
      return json(200, { ok: true, updated });
    }

    if (req.method === "POST" && (action === "heartbeat" || url.pathname.endsWith("/heartbeat"))) {
      await writeJSON("heartbeat.json", { at: new Date().toISOString(), model: typeof body.model === "string" ? body.model.slice(0, 300) : null, connection: body.connection ? { checkedAt: String(body.connection.checkedAt || "").slice(0, 40), modelUrl: String(body.connection.modelUrl || "").slice(0, 2000), checkId: String(body.connection.checkId || "").slice(0, 100), error: String(body.connection.error || "").slice(0, 500), models: Array.isArray(body.connection.models) ? body.connection.models.filter(x => typeof x === "string").slice(0, 50) : [], loadedVerified: body.connection.loadedVerified === true } : null });
      return json(200, { ok: true });
    }

    if (req.method === "POST" && (action === "progress" || url.pathname.endsWith("/progress"))) {
      const jobs = await getJobs();
      const job = jobs.find((j) => j.id === body.jobId);
      if (!job) return json(404, { error: "Job not found" });
      if (job.status === "aborted") return json(200, { ok: true, aborted: true });
      if (!["queued", "running"].includes(job.status)) return json(200, { ok: true });
      if (!body.events?.length && !body.event && !body.progress) return json(200, { ok: true });
      job.status = "running";
      job.events = job.events || [];
      const incoming = Array.isArray(body.events) ? body.events : body.event ? [body.event] : [];
      job.events.push(...incoming);
      if (job.events.length > 2000) job.events = job.events.slice(-2000);
      mergeCards(job, incoming);
      if (body.progress) job.progress = String(body.progress).slice(0, 500);
      job.updatedAt = new Date().toISOString();
      await saveJobs(jobs);
      return json(200, { ok: true });
    }

    if (req.method === "POST" && (action === "complete" || url.pathname.endsWith("/complete"))) {
      const jobs = await getJobs();
      const job = jobs.find((j) => j.id === body.jobId);
      if (!job) return json(404, { error: "Job not found" });
      if (job.status === "aborted") return json(200, { ok: true, aborted: true });
      if (body.error) {
        job.status = "failed";
        job.error = String(body.error).slice(0, 2000);
        job.progress = "Failed";
      } else {
        job.status = "complete";
        job.progress = "Complete — ready to review/publish";
        job.summary = body.summary || null;
        if (body.candidate) {
          await writeJSON("candidate.json", body.candidate);
          const live = await readJSON("catalog.json", { products: [], filaments: [] });
          const liveUrls = new Set();
          const liveIds = new Set();
          [...(live.products || []), ...(live.filaments || [])].forEach((p) => {
            if (p.id) liveIds.add(p.id);
            (p.offers || []).forEach((o) => { if (o.url) liveUrls.add(o.url); });
          });
          job.cards = job.cards && typeof job.cards === "object" ? job.cards : {};
          const extras = [];
          for (const p of [...(body.candidate.products || []), ...(body.candidate.filaments || [])]) {
            for (const o of p.offers || []) {
              if (!o.url) continue;
              if (!job.cards[o.url] && liveUrls.has(o.url)) continue;
              extras.push({
                card: {
                  name: p.name, brand: p.brand, kind: p.kind, price: o.price, url: o.url,
                  image: o.image || p.image, polymer: p.polymer, variant: p.variant, color: p.color,
                  weight: p.weight, diameter: p.diameter, packaging: p.packaging
                },
                // Merge or new is decided by the ROW the offer landed on, not by whether this
                // shop's offer URL is new: a first-time offer on an existing printer is a
                // merge, and calling it "new" made the review board contradict the placement.
                decision: { action: liveIds.has(p.id) ? "merge" : "create", candidateId: p.id, candidateName: p.name, shelf: p.kind }
              });
            }
          }
          mergeCards(job, extras);
        }
      }
      job.events = job.events || [];
      job.events.push({ type: "log", at: new Date().toISOString(), text: body.error ? `Failed: ${body.error}` : "Job finished and candidate uploaded." });
      job.updatedAt = new Date().toISOString();
      job.finishedAt = new Date().toISOString();
      await saveJobs(jobs);
      return json(200, { ok: true });
    }

    return json(404, { error: "Unknown worker endpoint" });
  } catch (err) {
    return json(500, { error: err.message || "Worker request failed" });
  }
};
