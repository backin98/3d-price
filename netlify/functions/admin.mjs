// /api/admin — unified online admin API backed by Netlify Blobs (Functions v2).
import store from "../../lib/netlify-store.cjs";
import auth from "../../lib/netlify-auth.cjs";
import money from "../../lib/parse-money.cjs";
import matcher from "../../lib/product-match.cjs";

const { readJSON, writeJSON, deleteKey } = store;
const { ownerFromHeaders, authReady } = auth;
const { withVat, withoutVat } = money;

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

// The axes the matcher actually uses. The catalog page shows them so a "Bare" and a "Combo"
// never look alike, and the duplicates inbox refuses to merge across them.
function axesOf(p) {
  const id = matcher.identity(p || {});
  return {
    combo: id.combo === true,
    ams: id.ams || "",
    variant: id.variantTag || "",
    mini: id.mini === true,
    laser: id.laserW || "",
    label: [id.combo ? "Combo" : "Bare", id.ams || "", id.variant ? "variant " + id.variant : "", id.mini ? "Mini" : "", id.laserW ? "laser " + id.laserW + "W" : ""]
      .filter(Boolean).join(" · ")
  };
}

function withAxes(catalog) {
  const map = (list) => (list || []).map((p) => ({ ...p, axes: axesOf(p) }));
  return { ...(catalog || {}), products: map(catalog && catalog.products), filaments: map(catalog && catalog.filaments) };
}

// Clusters of rows that are the same product by title (exact after folding, or Magellan close
// enough), each with a suggested keeper. Pairs that differ on a hard axis are reported as
// blocked instead, so "these two look identical but must never merge" is visible, not silent.
function duplicateClusters(catalog, opts = {}) {
  const rows = [...((catalog && catalog.products) || []), ...((catalog && catalog.filaments) || [])];
  const parent = new Map(rows.map((p) => [p.id, p.id]));
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  const exactKey = (p) => matcher.fold(p.name || p.id || "");
  const toks = (name) => matcher.tokens(name || "");
  // One title being the other plus configuration words ("P1S" vs "P1S Combo") is the case that
  // matters most here: those pairs score too low for a closeness test, and they are exactly the
  // ones that must never merge, so they are found by subset and reported as blocked.
  // Chains are the danger in clustering: H2D ~ H2D Combo ~ ... would otherwise drag H2C in.
  // Two rows may only be joined when they name the same model (same digit-bearing tokens),
  // so a group stays one machine instead of one product family.
  const signature = (name) => toks(name).filter((t) => /[0-9]/.test(t)).sort().join(" ");
  const isSubset = (a, b) => {
    const A = toks(a), B = toks(b);
    if (A.length < 2 || B.length < 2) return false;
    const [sm, lg] = A.length <= B.length ? [A, B] : [B, A];
    return sm.every((t) => lg.some((u) => u === t || matcher.similar(t, u)));
  };
  const byExact = new Map();
  const blocked = [];
  const near = [];
  for (const p of rows) {
    const k = exactKey(p);
    byExact.set(k, [...(byExact.get(k) || []), p]);
  }
  for (const [, list] of byExact) {
    for (let i = 1; i < list.length; i++) {
      union(list[0].id, list[i].id);
      near.push({ a: list[0], b: list[i], kind: "exact" });
    }
  }
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i], b = rows[j];
      if (find(a.id) === find(b.id)) continue;
      if ((a.kind || "printer") !== (b.kind || "printer")) continue;
      const conf = matcher.conflicts(matcher.identity(a), matcher.identity(b));
      const close = matcher.similar(matcher.fold(a.name), matcher.fold(b.name));
      const score = matcher.score(a.name || "", b.name || "");
      const subset = isSubset(a.name, b.name);
      if (!(close || score >= 0.82 || subset)) continue;
      if (signature(a.name) !== signature(b.name)) continue;
      if (conf.length) { blocked.push({ a: { id: a.id, name: a.name }, b: { id: b.id, name: b.name }, conflicts: conf }); continue; }
      union(a.id, b.id);
      near.push({ a, b, kind: subset ? "subset" : "near", score });
    }
  }
  const groups = new Map();
  for (const p of rows) {
    const k = find(p.id);
    groups.set(k, [...(groups.get(k) || []), p]);
  }
  const clusters = [...groups.values()]
    .filter((list) => list.length > 1)
    .map((list) => {
      const offers = (p) => (p.offers || []).length;
      const keeper = [...list].sort((x, y) => offers(y) - offers(x) || String(x.id).localeCompare(String(y.id)))[0];
      return {
        key: exactKey(list[0]),
        name: keeper.name,
        exact: list.every((p) => exactKey(p) === exactKey(list[0])),
        keeperId: keeper.id,
        rows: list.map((p) => ({
          id: p.id, name: p.name, offers: offers(p), price: p.price, axes: axesOf(p),
          stores: [...new Set((p.offers || []).map((o) => o.store).filter(Boolean))]
        }))
      };
    })
    .sort((a, b) => b.rows.length - a.rows.length);
  return { clusters, blocked: blocked.slice(0, 60), scanned: rows.length };
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
    // The scraped title travels with the offer so the catalog can show where it came from
    // and offer a regroup/branch when the matcher grouped it wrong.
    const scrapedTitle = String(card.name || "").trim();
    const offer = found?.offer
      ? { ...found.offer, sourceTitle: found.offer.sourceTitle || scrapedTitle }
      : { store: offerStore(url, card), price: card.price, url, image: card.image || "", sourceTitle: scrapedTitle,
          priceSuspect: card.priceSuspect === true ? "harvest" : undefined, priceCurrency: card.currency || undefined };
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
    // The URL is the identity. Without this guard the fallback id below mints a
    // fresh row for a URL the live catalog already carries (qwen- vs sel- duplicates).
    const already = findByUrl(next, url)?.product;
    if (already) {
      if (!already.offers) already.offers = [];
      if (!already.offers.some((o) => o.url === url)) already.offers.push(offer);
      applied += 1;
      continue;
    }
    const srcId = found?.product?.id;
    // Same printer, new shop, fresh id: the title is the identity everywhere else in
    // this app (Magellan merges on identical titles), so join the row that already
    // carries that title instead of minting a second one.
    const incomingName = card.name || (found?.product && found.product.name) || "";
    const twin = incomingName ? dest.find((p) => foldName(p.name) === foldName(incomingName)) : null;
    if (twin) {
      if (!twin.offers) twin.offers = [];
      if (!twin.offers.some((o) => o.url === url)) twin.offers.push(offer);
      applied += 1;
      continue;
    }
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

const foldName = (s) => String(s || "").toLocaleLowerCase("tr")
  .replace(/ı/g, "i").replace(/ş/g, "s").replace(/ç/g, "c")
  .replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ö/g, "o")
  .replace(/[^a-z0-9]+/g, " ").trim();

// Rows that ended up as the same product under two ids (qwen- from a run, sel- from
// a publish). Keeps the Magellan-owned row, unions its offers, records the ids it ate.
function collapseDuplicates(catalog) {
  const groups = [];
  const dropped = new Set();
  const shelf = (list) => {
    const byKey = new Map();
    for (const p of list || []) {
      const key = foldName(p.name);
      if (!key) continue;
      const first = byKey.get(key);
      if (!first) {
        byKey.set(key, p);
        continue;
      }
      // Belt and braces: even if two titles fold to the same key, rows that differ on a hard
      // axis (Bare/Combo, AMS, Mini, laser, variant) are left alone.
      if (matcher.conflicts(matcher.identity(first), matcher.identity(p)).length) continue;
      const preferQwen = (x, y) => (!String(x.id).startsWith("qwen-") && String(y.id).startsWith("qwen-") ? y : x);
      const kept = preferQwen(first, p);
      const gone = kept === first ? p : first;
      kept.offers = [...new Map([...(kept.offers || []), ...(gone.offers || [])].filter((o) => o && o.url).map((o) => [o.url, o])).values()];
      kept.mergedIds = [...new Set([...(kept.mergedIds || []), String(gone.id), ...(gone.mergedIds || [])])];
      byKey.set(key, kept);
      dropped.add(gone);
      groups.push({ name: kept.name, kept: kept.id, dropped: gone.id, offers: kept.offers.length });
    }
    return (list || []).filter((p) => !dropped.has(p));
  };
  const products = shelf(catalog?.products);
  const filaments = shelf(catalog?.filaments);
  return {
    catalog: { ...catalog, products, filaments, productCount: products.length, filamentCount: filaments.length, savedAt: new Date().toISOString() },
    removed: dropped.size,
    groups
  };
}

const hostOfUrl = (url) => {
  try { return new URL(String(url)).hostname.replace(/^www\./, "").toLowerCase(); } catch (_) { return ""; }
};

// Every stored price is KDV-inclusive (the storefront labels offers "KDV dahil"), so a
// shop whose listing prices are net has to have its offers re-priced. `vatAdded` records
// whether we already added the 20%, which is what makes the toggle reversible instead of
// compounding: 29155 -> withVat -> 34986 -> withoutVat -> 29155.
function repriceShopVat(catalog, candidate, shop, vat) {
  const keys = shopKeys(shop);
  const excluded = vat === "excluded";
  const counts = { checked: 0, offers: 0, was: 0, skipped: 0 };
  const walk = (doc, count) => {
    if (!doc) return doc;
    const shelf = (list) => (list || []).map((p) => ({
      ...p,
      offers: (p.offers || []).map((o) => {
        if (!offerFromShop(o, keys)) return o;
        if (count) counts.checked += 1;
        // A page that prints "+KDV" must keep its VAT whatever the shop default says.
        if (o.vatForced === true) { if (count) counts.skipped += 1; return o; }
        const raw = o.vatAdded === true ? withoutVat(o.price) : o.price;
        const price = excluded ? withVat(raw, "excluded") : raw;
        const next = { ...o, price, vatIncluded: true, vatAdded: excluded };
        if (Number.isFinite(o.was) && o.was > 0) {
          const rawWas = o.vatAdded === true ? withoutVat(o.was) : o.was;
          next.was = excluded ? withVat(rawWas, "excluded") : rawWas;
          if (count) counts.was += 1;
        }
        if (count && price !== o.price) counts.offers += 1;
        return next;
      })
    }));
    const products = shelf(doc.products);
    const filaments = shelf(doc.filaments);
    return { ...doc, products, filaments, productCount: products.length, filamentCount: filaments.length, savedAt: new Date().toISOString() };
  };
  return { counts, catalog: walk(catalog, true), candidate: walk(candidate, false) };
}

// An offer identifies its shop by URL host and by `store`, both of which hold the
// host ("robolinkmarket.com"), while a shop id is often a short slug ("robolink").
// Match on all of them; shop id alone would silently delete nothing.
function shopKeys(shop) {
  const keys = new Set();
  for (const k of [shop?.id, shop?.name, hostOfUrl(shop?.url)]) {
    const v = String(k || "").trim().toLowerCase();
    if (v) keys.add(v);
  }
  return keys;
}

const offerFromShop = (offer, keys) =>
  keys.has(String(offer?.store || "").trim().toLowerCase()) || keys.has(hostOfUrl(offer?.url));

// Remove every trace of one shop: its offers (rows left with nothing are dropped), the
// category URLs it owns, shared category names only it used, and optionally its runs.
function purgeShop(catalog, candidate, desk, jobs, shop, opts = {}) {
  const withRuns = opts.runs !== false;
  const keys = shopKeys(shop);
  const shopHost = hostOfUrl(shop.url);
  const counts = { offers: 0, rows: 0, categories: 0, jobs: 0 };
  const strip = (doc, countRows) => {
    if (!doc) return doc;
    const rows = (list) => (list || []).map((p) => {
      const offers = p.offers || [];
      const kept = offers.filter((o) => !offerFromShop(o, keys));
      counts.offers += offers.length - kept.length;
      return { ...p, offers: kept };
    }).filter((p) => {
      if ((p.offers || []).length) return true;
      if (countRows) counts.rows += 1;
      return false;
    });
    const products = rows(doc.products);
    const filaments = rows(doc.filaments);
    return { ...doc, products, filaments, productCount: products.length, filamentCount: filaments.length, savedAt: new Date().toISOString() };
  };

  const mine = new Set((shop.categories || []).map((c) => foldName(c.name)).filter(Boolean));
  const usedElsewhere = new Set();
  for (const s of desk.shops || []) {
    if (s.id === shop.id) continue;
    for (const c of s.categories || []) {
      const n = foldName(c.name);
      if (n) usedElsewhere.add(n);
    }
  }
  counts.categories = (shop.categories || []).length;

  // Only purge runs we can identify: every job carries the category URL it crawled.
  const keptJobs = withRuns && shopHost ? (jobs || []).filter((j) => hostOfUrl(j.url) !== shopHost) : jobs || [];
  counts.jobs = (jobs || []).length - keptJobs.length;

  return {
    counts,
    catalog: strip(catalog, true),
    candidate: candidate ? strip(candidate, false) : candidate,
    jobs: keptJobs,
    desk: {
      ...desk,
      shops: (desk.shops || []).map((s) => (s.id === shop.id ? { ...s, categories: [], categoryIds: [] } : s)),
      // A shared name another shop still uses stays.
      categories: (desk.categories || []).filter((c) => !mine.has(foldName(c.name || c)) || usedElsewhere.has(foldName(c.name || c)))
    }
  };
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
      catalog: withAxes(catalog),
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

      case "collapseDuplicates": {
        const res = collapseDuplicates(catalog);
        if (!res.removed) return json(200, { ok: true, removed: 0, groups: [] });
        await writeJSON("catalog.json", res.catalog);
        catalog = res.catalog;
        return json(200, { ok: true, removed: res.removed, groups: res.groups });
      }

      case "saveShopVat": {
        const shop = (desk.shops || []).find((s) => String(s.id) === String(body.shop || ""));
        if (!shop) throw new Error("Unknown shop");
        const vat = body.vat === "excluded" ? "excluded" : "included";
        const res = repriceShopVat(catalog, candidate, shop, vat);
        desk.shops = (desk.shops || []).map((s) => (s.id === shop.id ? { ...s, vat } : s));
        await writeJSON("desk.json", desk);
        await writeJSON("catalog.json", res.catalog);
        if (res.candidate) await writeJSON("candidate.json", res.candidate);
        catalog = res.catalog;
        candidate = res.candidate;
        return json(200, { ok: true, shop: shop.id, vat, ...res.counts, counts: { products: res.catalog.products.length, filaments: res.catalog.filaments.length } });
      }

      case "purgeShop": {
        const shop = (desk.shops || []).find((s) => String(s.id) === String(body.shop || ""));
        if (!shop) throw new Error("Unknown shop");
        const res = purgeShop(catalog, candidate, desk, jobs, shop, { runs: body.runs !== false });
        await writeJSON("catalog.json", res.catalog);
        await writeJSON("desk.json", res.desk);
        if (res.candidate) await writeJSON("candidate.json", res.candidate);
        if (res.counts.jobs) await saveJobList(res.jobs);
        catalog = res.catalog;
        candidate = res.candidate;
        jobs = res.jobs;
        desk.shops = res.desk.shops;
        desk.categories = res.desk.categories;
        return json(200, { ok: true, shop: shop.id, ...res.counts, counts: { products: res.catalog.products.length, filaments: res.catalog.filaments.length } });
      }

      case "deleteJobs": {
        const id = String(body.id || "");
        const shopId = String(body.shop || "");
        const target = shopId ? (desk.shops || []).find((s) => String(s.id) === shopId) : null;
        const host = target ? hostOfUrl(target.url) : "";
        const before = jobs.length;
        if (id) jobs = jobs.filter((j) => j.id !== id);
        else if (target && host) jobs = jobs.filter((j) => hostOfUrl(j.url) !== host);
        else if (target) jobs = jobs; // no URL on the shop: cannot tell its runs apart
        else jobs = [];
        await saveJobList(jobs);
        return json(200, { ok: true, removed: before - jobs.length, left: jobs.length });
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
          maxProducts: Number(body.maxProducts) || 400,
          autoLlmMatch: body.autoLlmMatch === undefined ? desk.autoLlmMatch === true : body.autoLlmMatch === true,
          visualMatch: body.visualMatch === undefined ? true : body.visualMatch !== false
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

      // The duplicates inbox: clusters with a keeper suggestion, and the near-duplicate pairs
      // that must never merge reported separately.
      case "suggestDuplicates": {
        return json(200, { ok: true, ...duplicateClusters(catalog) });
      }

      // Merge selected rows into one keeper. The page keeps the previous catalog so this can
      // be undone by saving it back.
      case "mergeProducts": {
        const ids = [...new Set((Array.isArray(body.ids) ? body.ids : []).map(String).filter(Boolean))];
        const keeperId = String(body.keeperId || ids[0] || "");
        if (ids.length < 2) throw new Error("Select at least two products to merge");
        if (!ids.includes(keeperId)) throw new Error("The keeper must be one of the selected products");
        const before = { products: (catalog.products || []).length, filaments: (catalog.filaments || []).length };
        const mergeInto = (list) => {
          const keeper = (list || []).find((p) => p.id === keeperId);
          if (!keeper) return list;
          const others = (list || []).filter((p) => ids.includes(p.id) && p.id !== keeperId);
          keeper.offers = keeper.offers || [];
          for (const other of others) {
            for (const offer of other.offers || []) {
              if (!offer.url || keeper.offers.some((o) => o.url === offer.url)) continue;
              keeper.offers.push(offer);
            }
          }
          const prices = keeper.offers.map((o) => Number(o.price)).filter((n) => Number.isFinite(n) && n > 0);
          if (prices.length) keeper.price = Math.min(...prices);
          keeper.manual = true;
          keeper.mergedFrom = [...new Set([...(keeper.mergedFrom || []), ...others.map((p) => p.id)])];
          return (list || []).filter((p) => !(ids.includes(p.id) && p.id !== keeperId));
        };
        catalog.products = mergeInto(catalog.products);
        catalog.filaments = mergeInto(catalog.filaments);
        catalog.productCount = catalog.products.length;
        catalog.filamentCount = catalog.filaments.length;
        catalog.savedAt = new Date().toISOString();
        await writeJSON("catalog.json", catalog);
        const keeper = findById(catalog, keeperId)?.product;
        return json(200, {
          ok: true,
          keeper: { id: keeperId, name: keeper && keeper.name, offers: ((keeper && keeper.offers) || []).length },
          merged: ids.length - 1,
          counts: { before, after: { products: catalog.products.length, filaments: catalog.filaments.length } }
        });
      }

      // Move one offer to another product row, or branch it out as its own product. This is
      // how a wrongly grouped offer (a K2 Plus sitting on a K2 row) gets separated, using the
      // scraped title we recorded at harvest time.
      case "retargetOffer": {
        const url = String(body.url || "").trim();
        const from = String(body.from || "").trim();
        const to = String(body.to || "").trim();
        if (!url || !from || !to) throw new Error("retargetOffer needs url, from and to");
        const shelves = [catalog.products || [], catalog.filaments || []];
        const found = shelves.map((list) => list.find((p) => p.id === from)).find(Boolean);
        if (!found) throw new Error("Source product not found");
        const at = (found.offers || []).findIndex((o) => o.url === url);
        if (at < 0) throw new Error("That offer is not on the source product");
        const priceOf = (p) => {
          const prices = (p.offers || []).map((o) => Number(o.price)).filter((n) => Number.isFinite(n) && n > 0);
          return prices.length ? Math.min(...prices) : p.price;
        };
        const shelfOf = (kind) => (kind === "filament" ? catalog.filaments : catalog.products);
        // Validate the destination before touching anything, so a refused move is a no-op.
        let target = null;
        if (to === "new") {
          // stays null: a new row is always allowed
        } else {
          target = shelves.flat().find((p) => p.id === to);
          if (!target) throw new Error("Target product not found");
          if (target.id === from) throw new Error("Already on that product");
          if ((target.offers || []).some((o) => o.url === url)) throw new Error("Target already has that offer");
        }
        const [offer] = found.offers.splice(at, 1);
        const scraped = String(offer.sourceTitle || "").trim();
        if (to === "new") {
          const slug = (() => {
            try { return decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).pop() || "").replace(/[-_]+/g, " ").trim(); } catch (_) { return ""; }
          })();
          const row = {
            ...found,
            id: "man-" + listingId(url).replace(/^sel-/, ""),
            name: scraped || slug || url,
            offers: [offer],
            price: priceOf({ offers: [offer] }),
            url: offer.url,
            image: offer.image || found.image,
            sourceId: offer.store || found.sourceId,
            source: offer.store || found.source,
            manual: true
          };
          delete row.similar;
          shelfOf(row.kind).push(row);
        } else {
          target.offers = target.offers || [];
          target.offers.push(offer);
          target.price = priceOf(target);
        }
        // A row that lost its last offer is gone: an empty product is not a product.
        if (!(found.offers || []).length) {
          catalog.products = (catalog.products || []).filter((p) => p.id !== found.id);
          catalog.filaments = (catalog.filaments || []).filter((p) => p.id !== found.id);
        } else {
          found.price = priceOf(found);
        }
        catalog.productCount = (catalog.products || []).length;
        catalog.filamentCount = (catalog.filaments || []).length;
        catalog.savedAt = new Date().toISOString();
        await writeJSON("catalog.json", catalog);
        return json(200, {
          ok: true,
          action: to === "new" ? "branched" : "moved",
          scrapedTitle: scraped,
          counts: { products: catalog.products.length, filaments: catalog.filaments.length }
        });
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
