// /api/admin — unified online admin API backed by Netlify Blobs (Functions v2).
import store from "../../lib/netlify-store.cjs";
import auth from "../../lib/netlify-auth.cjs";

const { readJSON, writeJSON, deleteKey } = store;
const { ownerFromHeaders, authReady } = auth;

function sameOriginUrl(req) {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(req.url).origin;
  } catch (_) {
    return false;
  }
}

const DEFAULT_DESK = {
  modelUrl: "",
  workerUrl: "",
  autoLlmMatch: false,
  shops: [],
  categories: [],
  banners: [],
  promoted: []
};

function httpUrl(raw, name) {
  const url = new URL(String(raw || "").trim());
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Use an HTTP or HTTPS " + name + " without credentials");
  }
  url.hash = "";
  url.search = "";
  return url.href.replace(/\/+$/, "");
}

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

async function loadAll() {
  const desk = await readJSON("desk.json", DEFAULT_DESK);
  const catalog = await readJSON("catalog.json", { source: { id: "empty", name: "Empty catalog" }, savedAt: null, products: [], filaments: [] });
  const candidate = await readJSON("candidate.json", null);
  const jobs = await readJSON("jobs.json", []);
  return { desk, catalog, candidate, jobs };
}

async function saveJobList(jobs) {
  jobs.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  await writeJSON("jobs.json", jobs);
}

function listingId(url) {
  let h = 0;
  for (let i = 0; i < url.length; i++) h = (Math.imul(31, h) + url.charCodeAt(i)) | 0;
  return "sel-" + (h >>> 0).toString(36);
}

function cloneCatalog(src) {
  return {
    ...(src || {}),
    products: (src?.products || []).map((p) => ({ ...p, offers: (p.offers || []).map((o) => ({ ...o })) })),
    filaments: (src?.filaments || []).map((p) => ({ ...p, offers: (p.offers || []).map((o) => ({ ...o })) }))
  };
}

function findByUrl(catalog, url) {
  for (const shelf of ["products", "filaments"]) {
    const product = (catalog?.[shelf] || []).find((p) => p.id === url || (p.offers || []).some((o) => o.url === url));
    if (product) {
      const offer = (product.offers || []).find((o) => o.url === url) || (product.offers || [])[0];
      return { shelf, product, offer };
    }
  }
  return null;
}

function findById(catalog, id) {
  if (!id || !catalog) return null;
  for (const shelf of ["products", "filaments"]) {
    const product = (catalog[shelf] || []).find((p) => p.id === id);
    if (product) return { shelf, product };
  }
  return null;
}

function offerStore(url, card) {
  if (card && card.store) return card.store;
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch (_) { return ""; }
}

function applySelectedListings(live, candidate, items) {
  const next = cloneCatalog(live || { products: [], filaments: [] });
  let applied = 0;
  for (const item of items || []) {
    const card = item.card && typeof item.card === "object" ? item.card : {};
    const url = String(item.url || card.url || "");
    if (!url) continue;
    const found = findByUrl(candidate || {}, url);
    const offer = found?.offer
      ? { ...found.offer }
      : { store: offerStore(url, card), price: card.price, url, image: card.image || "" };
    const shelf = found?.shelf || (card.kind === "filament" ? "filaments" : "products");
    const dest = next[shelf];
    const mergeId = item.action === "merge" ? String(item.candidateId || "") : "";
    if (mergeId) {
      let target = findById(next, mergeId)?.product;
      if (!target) {
        const fromCand = findById(candidate || {}, mergeId)?.product;
        if (fromCand) {
          target = { ...fromCand, offers: (fromCand.offers || []).map((o) => ({ ...o })).filter((o) => o.url !== url) };
          dest.push(target);
        }
      }
      if (target) {
        if (!target.offers.some((o) => o.url === url)) target.offers.push(offer);
        applied += 1;
        continue;
      }
    }
    const srcId = found?.product?.id;
    const inLive = !!(srcId && dest.some((p) => p.id === srcId));
    const id = srcId && !inLive ? srcId : listingId(url);
    let target = dest.find((p) => p.id === id);
    if (!target) {
      const src = found?.product || {};
      target = {
        ...src,
        id,
        name: card.name || src.name || url,
        brand: card.brand || src.brand || "",
        kind: card.kind || src.kind || (shelf === "filaments" ? "filament" : "printer"),
        image: card.image || src.image || "",
        polymer: card.polymer || src.polymer,
        variant: card.variant || src.variant,
        color: card.color || src.color,
        weight: card.weight || src.weight,
        diameter: card.diameter || src.diameter,
        packaging: card.packaging || src.packaging,
        aisle: card.aisle || src.aisle || (shelf === "filaments" ? "filament" : "fdm"),
        offers: []
      };
      dest.push(target);
    }
    if (!target.offers.some((o) => o.url === url)) target.offers.push(offer);
    applied += 1;
  }
  next.savedAt = new Date().toISOString();
  next.productCount = next.products.length;
  next.filamentCount = next.filaments.length;
  next._applied = applied;
  return next;
}

function dropUrlsFromCatalog(catalog, urls) {
  const drop = new Set((urls || []).map(String));
  const strip = (list) => (list || [])
    .map((p) => ({ ...p, offers: (p.offers || []).filter((o) => !drop.has(o.url)) }))
    .filter((p) => (p.offers || []).length);
  if (!catalog) return catalog;
  return {
    ...catalog,
    products: strip(catalog.products),
    filaments: strip(catalog.filaments),
    productCount: strip(catalog.products).length,
    filamentCount: strip(catalog.filaments).length
  };
}

export default async (req) => {
  const headers = toHeaders(req);
  const owner = ownerFromHeaders(headers);
  if (!owner) return json(401, { error: "Unauthorized" });

  if (req.method === "GET") {
    const data = await loadAll();
    const catalog = data.catalog || { products: [], filaments: [] };
    return json(200, {
      configured: authReady(),
      desk: data.desk,
      catalog,
      candidate: data.candidate,
      jobs: data.jobs || [],
      heartbeat: await readJSON("heartbeat.json", null),
      counts: {
        products: (catalog.products || []).length,
        filaments: (catalog.filaments || []).length
      }
    });
  }

  if (req.method !== "POST" || !sameOriginUrl(req)) {
    return json(405, { error: "Method not allowed" });
  }

  try {
    const body = await req.json();
    const action = String(body.action || "");
    const data = await loadAll();
    const desk = data.desk;
    let catalog = data.catalog || { source: {}, savedAt: null, products: [], filaments: [] };
    let candidate = data.candidate;
    let jobs = data.jobs || [];

    switch (action) {
      case "saveModelConnection": {
        const modelUrl = httpUrl(body.url, "AI server URL");
        const workerRaw = String(body.workerUrl || desk.workerUrl || "http://127.0.0.1:8788").trim();
        const workerUrl = /:123[45](?:\/|$)/.test(workerRaw) || workerRaw.replace(/\/+$/, "") === modelUrl.replace(/\/+$/, "")
          ? "http://127.0.0.1:8788"
          : httpUrl(workerRaw, "worker address");
        const next = { ...desk, modelUrl, workerUrl, modelCheckId: crypto.randomUUID() };
        if (body.autoLlmMatch === true || body.autoLlmMatch === false) next.autoLlmMatch = body.autoLlmMatch === true;
        await writeJSON("desk.json", next);
        return json(200, { ok: true, desk: next });
      }
      case "saveMatchSettings": {
        const next = { ...desk, autoLlmMatch: body.autoLlmMatch === true };
        await writeJSON("desk.json", next);
        return json(200, { ok: true, desk: next });
      }
      case "saveDesk": {
        const next = body.desk;
        if (!next || typeof next !== "object") throw new Error("Invalid desk object");
        await writeJSON("desk.json", {
          ...desk,
          modelUrl: desk.modelUrl || "",
          workerUrl: desk.workerUrl || "",
          autoLlmMatch: desk.autoLlmMatch === true,
          shops: Array.isArray(next.shops) ? next.shops : desk.shops || [],
          categories: Array.isArray(next.categories) ? next.categories : desk.categories || [],
          banners: Array.isArray(next.banners) ? next.banners : desk.banners || [],
          promoted: Array.isArray(next.promoted) ? next.promoted : desk.promoted || []
        });
        return json(200, { ok: true });
      }

      case "saveCatalog": {
        catalog = body.catalog;
        if (!catalog || !Array.isArray(catalog.products) || !Array.isArray(catalog.filaments)) {
          throw new Error("Catalog must contain products and filaments arrays");
        }
        await writeJSON("catalog.json", catalog);
        return json(200, { ok: true, counts: { products: catalog.products.length, filaments: catalog.filaments.length } });
      }

      case "saveCandidate": {
        candidate = body.candidate;
        if (!candidate || !Array.isArray(candidate.products) || !Array.isArray(candidate.filaments)) {
          throw new Error("Candidate must contain products and filaments arrays");
        }
        await writeJSON("candidate.json", candidate);
        return json(200, { ok: true, counts: { products: candidate.products.length, filaments: candidate.filaments.length } });
      }

      case "publishCandidate": {
        candidate = candidate || (await readJSON("candidate.json", null));
        if (!candidate) throw new Error("No candidate snapshot to publish");
        await writeJSON("catalog.json", candidate);
        await writeJSON("last-publish.json", { publishedAt: new Date().toISOString(), savedAt: candidate.savedAt });
        return json(200, { ok: true, publishedAt: new Date().toISOString() });
      }

      case "publishSelected": {
        candidate = candidate || (await readJSON("candidate.json", null)) || { products: [], filaments: [] };
        const items = Array.isArray(body.placements) && body.placements.length
          ? body.placements
          : (Array.isArray(body.ids) ? body.ids.map((id) => ({ url: String(id), action: "create" })) : []);
        if (!items.length) throw new Error("Select at least one product");
        const next = applySelectedListings(catalog, candidate, items);
        const applied = next._applied || 0;
        delete next._applied;
        if (!applied) throw new Error("None of the selected products could be published");
        await writeJSON("catalog.json", next);
        await writeJSON("last-publish.json", { publishedAt: new Date().toISOString(), savedAt: next.savedAt });
        const urls = items.map((it) => String(it.url || (it.card && it.card.url) || "")).filter(Boolean);
        jobs = jobs.map((j) => ({ ...j, published: [...new Set([...(j.published || []), ...urls])] }));
        await saveJobList(jobs);
        catalog = next;
        return json(200, { ok: true, publishedAt: new Date().toISOString(), counts: { products: next.products.length, filaments: next.filaments.length } });
      }

      case "discardCandidate": {
        candidate = null;
        await deleteKey("candidate.json");
        return json(200, { ok: true });
      }

      case "deleteFlagged": {
        const urls = Array.isArray(body.urls) ? body.urls.map(String).filter((u) => /^https?:\/\//i.test(u)) : [];
        if (!urls.length) throw new Error("Flag products to delete");
        const drop = new Set(urls);
        jobs = jobs.map((j) => {
          const dropped = [...new Set([...(j.dropped || []), ...urls])];
          const cards = { ...(j.cards || {}) };
          urls.forEach((u) => { delete cards[u]; });
          return { ...j, dropped, cards };
        });
        await saveJobList(jobs);
        if (candidate) {
          candidate = dropUrlsFromCatalog(candidate, urls);
          await writeJSON("candidate.json", candidate);
        }
        return json(200, { ok: true, deleted: drop.size });
      }

      case "createJob": {
        const url = String(body.url || "").trim();
        if (!/^https:\/\//i.test(url)) throw new Error("Job URL must be HTTPS");
        const jobHost = (() => { try { return new URL(url).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; } })();
        const shop = (desk.shops || []).find((s) => s.id === jobHost || (s.url && (() => { try { return new URL(s.url).hostname.replace(/^www\./, "").toLowerCase() === jobHost; } catch { return false; } })()));
        const job = {
          id: "job-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8),
          type: String(body.type || "shop"),
          url,
          vat: shop && shop.vat === "excluded" ? "excluded" : "included",
          kind: ["printer", "filament", "both"].includes(body.kind) ? body.kind : "both",
          status: "queued",
          progress: "Waiting for the local worker",
          events: [],
          error: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          maxPages: Number(body.maxPages) || 40,
          maxProducts: Number(body.maxProducts) || 400
        };
        jobs.push(job);
        await saveJobList(jobs);
        return json(200, { ok: true, job });
      }

      case "abortJob": {
        const job = jobs.find((j) => j.id === body.id);
        if (job && ["queued", "running"].includes(job.status)) {
          job.status = "aborted";
          job.progress = "Aborted from admin";
          job.updatedAt = new Date().toISOString();
          job.events = job.events || [];
          job.events.push({ type: "log", at: new Date().toISOString(), text: "Aborted from the online admin." });
          await saveJobList(jobs);
        }
        return json(200, { ok: true });
      }

      case "deleteJob": {
        jobs = jobs.filter((j) => j.id !== body.id);
        await saveJobList(jobs);
        return json(200, { ok: true });
      }

      case "deleteCatalogProducts": {
        const ids = new Set((Array.isArray(body.ids) ? body.ids : []).map(String).filter(Boolean));
        if (!ids.size) throw new Error("Select products to delete");
        catalog.products = (catalog.products || []).filter((p) => !ids.has(p.id));
        catalog.filaments = (catalog.filaments || []).filter((p) => !ids.has(p.id));
        catalog.productCount = catalog.products.length;
        catalog.filamentCount = catalog.filaments.length;
        catalog.savedAt = new Date().toISOString();
        await writeJSON("catalog.json", catalog);
        return json(200, { ok: true, counts: { products: catalog.products.length, filaments: catalog.filaments.length } });
      }

      case "deleteAllCatalog": {
        const empty = {
          ...catalog,
          products: [],
          filaments: [],
          productCount: 0,
          filamentCount: 0,
          savedAt: new Date().toISOString()
        };
        await writeJSON("catalog.json", empty);
        await writeJSON("candidate.json", { ...empty, source: { id: "empty", name: "Empty catalog" } });
        await writeJSON("last-publish.json", { publishedAt: empty.savedAt, savedAt: empty.savedAt, emptied: true });
        return json(200, { ok: true, counts: { products: 0, filaments: 0 } });
      }

      case "updateProduct": {
        const id = String(body.id || "");
        const patch = body.patch && typeof body.patch === "object" ? body.patch : {};
        if (!id) throw new Error("Product id required");
        const allowed = ["name", "title", "brand", "color", "polymer", "variant", "aisle", "unit", "kind", "packaging", "weight", "diameter"];
        const product = [...(catalog.products || []), ...(catalog.filaments || [])].find((p) => p.id === id);
        if (!product) throw new Error("Product not found");
        for (const key of allowed) {
          if (key in patch) product[key] = patch[key];
        }
        const inProducts = (catalog.products || []).some((p) => p.id === id);
        if (inProducts) {
          catalog.products = catalog.products.map((p) => (p.id === id ? product : p));
        } else {
          catalog.filaments = catalog.filaments.map((p) => (p.id === id ? product : p));
        }
        await writeJSON("catalog.json", catalog);
        return json(200, { ok: true, product });
      }

      default:
        throw new Error("Unknown action");
    }
  } catch (err) {
    return json(400, { error: err.message || "Admin request failed" });
  }
};
