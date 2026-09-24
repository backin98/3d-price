// /api/admin — unified online admin API backed by Netlify Blobs (Functions v2).
import store from "../../lib/netlify-store.cjs";
import auth from "../../lib/netlify-auth.cjs";
import money from "../../lib/parse-money.cjs";
import matcher from "../../lib/product-match.cjs";
import boardLib from "../../lib/baseline-board.cjs";

const { readJSON, writeJSON, writeBytes, deleteKey } = store;
const { ownerFromHeaders, authReady } = auth;
const { withVat, withoutVat, parseMoney, pickPrice } = money;
const { emptyBoard, fromProduct, upsertItems, loadBackupPrinters, sanitizeBoard, addCategory, renameCategory, patchItem, addItem, itemForProduct, applyBaselineImages, catalogProductForItem } = boardLib;

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

function imageType(bytes) {
  if (!bytes || bytes.length < 12) return "";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes.slice(1, 4).toString() === "PNG") return "image/png";
  if (bytes.slice(0, 4).toString() === "RIFF" && bytes.slice(8, 12).toString() === "WEBP") return "image/webp";
  return "";
}

const PRODUCT_PATCH_FIELDS = ["name", "title", "brand", "color", "polymer", "variant", "aisle", "unit", "kind", "packaging", "weight", "diameter"];

async function storeUploadedImage(id, imageUpload) {
  if (!imageUpload) return "";
  const type = String(imageUpload.type || "");
  const encoded = String(imageUpload.data || "");
  if (!/^image\/(?:jpeg|png|webp)$/.test(type) || !/^[a-z0-9+/]+={0,2}$/i.test(encoded)) throw new Error("Use a JPG, PNG or WebP image");
  const bytes = Buffer.from(encoded, "base64");
  if (!bytes.length || bytes.length > 1024 * 1024) throw new Error("Thumbnail must be smaller than 1 MB");
  if (imageType(bytes) !== type) throw new Error("The uploaded file is not a valid image");
  const safeId = String(id || "image").toLowerCase().replace(/[^a-z0-9._-]+/g, "-").slice(0, 80) || "image";
  const imageKey = safeId + "-" + Date.now();
  await writeBytes("product-images/" + imageKey, bytes);
  return "/api/product-image?key=" + encodeURIComponent(imageKey);
}

async function updateCatalogProduct(catalog, item) {
  const id = String(item.id || "");
  const patch = item.patch && typeof item.patch === "object" ? item.patch : {};
  if (!id) throw new Error("Product id required");
  const product = [...(catalog.products || []), ...(catalog.filaments || [])].find((p) => p.id === id);
  if (!product) throw new Error("Product not found: " + id);
  if (item.imageUpload) {
    product.image = await storeUploadedImage(id, item.imageUpload);
    // ponytail: old manual thumbnails stay immutable so catalog backups retain their images;
    // add garbage collection only if this small manual-upload store becomes material.
  }
  for (const key of PRODUCT_PATCH_FIELDS) if (key in patch) product[key] = patch[key];
  return product;
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

async function loadBaselineBoard() {
  const board = await readJSON("baseline.json", null);
  if (board && Array.isArray(board.items)) return board;
  return emptyBoard();
}

async function seedBaselineFromBackup() {
  const board = await loadBaselineBoard();
  upsertItems(board, loadBackupPrinters().map((p) => fromProduct(p, "backup")));
  await writeJSON("baseline.json", sanitizeBoard(board));
  return sanitizeBoard(board);
}

async function ensureBaseline() {
  const loaded = await loadBaselineBoard();
  if (!loaded.items || !loaded.items.length) return loaded.items ? loaded : emptyBoard();
  // Polling the admin must be read-only. A stale GET used to write its sanitized copy back
  // over a model that had just been added while a shop run was being queued.
  return sanitizeBoard(loaded);
}

async function saveJobList(jobs) {
  jobs.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  await writeJSON("jobs.json", jobs);
}

// Remove every other row's copy of an offer URL, keeping the one that should own it. An offer URL
// identifies one listing on one shop, so two rows carrying it means the storefront compares the
// same shop twice — and the second product's price is fiction.
function stripOfferUrl(catalog, url, keepRowId) {
  const rows = [...(catalog.products || []), ...(catalog.filaments || [])];
  let moved = 0;
  for (const row of rows) {
    if (!row.offers || row.id === keepRowId) continue;
    const before = row.offers.length;
    row.offers = row.offers.filter((o) => String(o.url || "") !== url);
    moved += before - row.offers.length;
  }
  // A row with no offers left is not a product any more.
  const keep = (list) => (list || []).filter((r) => (r.offers || []).length);
  catalog.products = keep(catalog.products);
  catalog.filaments = keep(catalog.filaments);
  return moved;
}

// How many URLs are currently in more than one row, and which.
function findDuplicateOfferUrls(catalog) {
  const seen = new Map();
  for (const row of [...(catalog.products || []), ...(catalog.filaments || [])]) {
    for (const o of row.offers || []) {
      const url = String(o.url || "");
      if (!url) continue;
      if (!seen.has(url)) seen.set(url, []);
      seen.get(url).push(row);
    }
  }
  return [...seen.entries()].filter(([, rows]) => rows.length > 1).map(([url, rows]) => ({ url, rows: rows.map((r) => ({ id: r.id, name: r.name })) }));
}

// ---------- backups ----------
// A named snapshot of everything the admin owns. The index is a single key so listing costs one
// read and never depends on blob-listing behaviour. Restoring writes the snapshot back over the
// live keys, so it overrides whatever happened since — that is the point of it.
const BACKUP_INDEX = "backups/index.json";
// The database: the catalog, the draft, and the shops. Run history (jobs.json, many megabytes of
// logs) is deliberately not part of a backup — it is history, not data, and a restore leaves it
// alone rather than resurrecting runs that refer to rows that no longer exist.
const BACKUP_PARTS = ["catalog.json", "candidate.json", "desk.json"];

const backupKey = (slug, stamp) => `backups/${slug}-${stamp}.json`;
const slugifyName = (name) =>
  String(name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[ıİ]/g, "i")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

function countsOf(snapshot) {
  // Accepts a backup record ({ parts: {...} }) or a bare parts object.
  const parts = (snapshot && snapshot.parts) || snapshot || {};
  const rows = [...((parts.catalog && parts.catalog.products) || []), ...((parts.catalog && parts.catalog.filaments) || [])];
  return {
    rows: rows.length,
    offers: rows.reduce((n, p) => n + ((p.offers || []).length || 0), 0),
    shops: ((parts.desk || {}).shops || []).length,
    hasDraft: !!parts.candidate
  };
}

const readBackupIndex = async () => {
  const index = await readJSON(BACKUP_INDEX, []);
  return Array.isArray(index) ? index.filter((e) => e && e.key) : [];
};

const writeBackupIndex = (index) =>
  writeJSON(BACKUP_INDEX, index.slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))));

async function snapshotNow(name, note) {
  const all = await loadAll();
  delete all.jobs;
  const createdAt = new Date().toISOString();
  const slug = slugifyName(name) || "backup";
  const key = backupKey(slug, createdAt.replace(/[^0-9]/g, "").slice(0, 14));
  const snapshot = { name: String(name || "").trim() || slug, note: note || "", createdAt, parts: all };
  await writeJSON(key, snapshot);
  const entry = { key, name: snapshot.name, note: snapshot.note, createdAt, ...countsOf(snapshot) };
  const index = await readBackupIndex();
  index.unshift(entry);
  await writeBackupIndex(index);
  return entry;
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

function coercePrice(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  const n = Number(value);
  if (Number.isFinite(n) && n > 0 && String(value).trim() !== "") return n;
  const parsed = parseMoney(value);
  return parsed && parsed.amount > 0 ? parsed.amount : null;
}

function priceFromJobs(jobs, url) {
  for (const job of jobs || []) {
    const raw = job.cards && (job.cards[url] || Object.values(job.cards).find((c) => (((c && c.card) || c) || {}).url === url));
    const inner = raw && ((raw.card) || raw);
    const fromCard = coercePrice(inner && inner.price);
    if (fromCard) return fromCard;
    for (const e of job.events || []) {
      if (e.card && e.card.url === url) {
        const fromEv = coercePrice(e.card.price);
        if (fromEv) return fromEv;
      }
    }
  }
  return null;
}

function applySelectedListings(live, candidate, items, jobs) {
  const next = cloneCatalog(live || { products: [], filaments: [] });
  let applied = 0;
  const appliedUrls = [];
  for (const item of items || []) {
    const card = item.card && typeof item.card === "object" ? item.card : {};
    const url = String(item.url || card.url || "");
    if (!url) continue;
    const found = findByUrl(candidate || {}, url) || findByUrl(next, url);
    // The scraped title travels with the offer so the catalog can show where it came from
    // and offer a regroup/branch when the matcher grouped it wrong.
    const scrapedTitle = String(card.name || "").trim();
    const price = coercePrice(card.price) || coercePrice(found?.offer?.price) || priceFromJobs(jobs, url);
    const offer = found?.offer
      ? { ...found.offer, price: coercePrice(found.offer.price) || price || found.offer.price, sourceTitle: scrapedTitle || found.offer.sourceTitle, url }
      : { store: offerStore(url, card), price, url, image: card.image || "", sourceTitle: scrapedTitle,
          priceSuspect: card.priceSuspect === true ? "harvest" : undefined, priceCurrency: card.currency || undefined };
    if (!Number.isFinite(Number(offer.price)) || Number(offer.price) <= 0) continue;
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
        // The dropdown is an instruction to move this listing, even if an earlier publish
        // left the same URL sitting on a different product.
        if (!target.offers) target.offers = [];
        target.offers = target.offers.filter((o) => o.url !== url);
        target.offers.push(offer);
        stripOfferUrl(next, url, target.id);
        if (item.stampBaselineId && !target.baselineId) target.baselineId = item.stampBaselineId;
        applied += 1;
        appliedUrls.push(url);
        continue;
      }
    }
    // The URL is the identity. Without this guard the fallback id below mints a
    // fresh row for a URL the live catalog already carries (qwen- vs sel- duplicates).
    const already = findByUrl(next, url)?.product;
    if (already) {
      // One store, one row. If this URL already sits in a different product, take it out of
      // there — otherwise the same listing is compared twice on the storefront.
      stripOfferUrl(next, url, already.id);
      if (!already.offers) already.offers = [];
      already.offers = already.offers.filter((o) => o.url !== url);
      already.offers.push(offer);
      if (!already.baselineId && already.offers.length === 1) {
        if (card.name) already.name = card.name;
        if (card.brand != null) already.brand = card.brand;
      }
      applied += 1;
      appliedUrls.push(url);
      continue;
    }
    if (item.baselineModel) {
      const model = item.baselineModel;
      const id = model.id;
      let target = dest.find((p) => p.id === id || p.baselineId === id);
      if (!target) {
        target = {
          id,
          name: model.name,
          brand: model.brand || "",
          kind: model.category === "filaments" ? "filament" : "printer",
          image: model.image || card.image || "",
          aisle: model.category === "filaments" ? "filament" : "fdm",
          baselineId: id,
          offers: []
        };
        dest.push(target);
      }
      if (!target.offers.some((o) => o.url === url)) target.offers.push(offer);
      applied += 1;
      appliedUrls.push(url);
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
      appliedUrls.push(url);
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
    appliedUrls.push(url);
  }
  next.savedAt = new Date().toISOString();
  next.source = next.source || { id: "desk", name: "Published catalog" };
  next.productCount = next.products.length;
  next.filamentCount = next.filaments.length;
  next._applied = applied;
  next._appliedUrls = appliedUrls;
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

function listingUrlsFromJob(job) {
  const urls = [];
  for (const raw of Object.values(job.cards || {})) {
    const c = (raw && raw.card) || raw;
    if (c && c.url) urls.push(c.url);
  }
  for (const key of Object.keys(job.cards || {})) if (/^https?:\/\//i.test(key)) urls.push(key);
  for (const e of job.events || []) {
    if (e.card && e.card.url) urls.push(e.card.url);
    if (e.url) urls.push(e.url);
    for (const u of e.urls || []) urls.push(u);
    for (const it of e.items || []) if (it && it.url) urls.push(it.url);
  }
  return urls.filter((u) => /^https?:\/\//i.test(String(u)));
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
    const baseline = await ensureBaseline();
    return json(200, {
      configured: authReady(),
      desk: data.desk,
      catalog: withAxes(applyBaselineImages(catalog, baseline)),
      candidate: data.candidate,
      jobs: data.jobs || [],
      backups: await readBackupIndex(),
      baseline,
      recommendations: await readJSON("baseline-recommendations.json", { items: [] }),
      duplicateOffers: findDuplicateOfferUrls(catalog),
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
        const board = await ensureBaseline();
        const deferredItems = Array.isArray(body.deferred) ? body.deferred : [];
        const rawItems = Array.isArray(body.placements) && body.placements.length
          ? body.placements
          : (Array.isArray(body.ids) ? body.ids.map((id) => ({ url: String(id), action: "create" })) : []);
        if (!rawItems.length && !deferredItems.length) throw new Error("Select at least one product");
        const deferredUrls = new Set();
        jobs = jobs.map((job) => {
          const known = new Set(listingUrlsFromJob(job));
          const cards = { ...(job.cards || {}) };
          let changed = false;
          for (const item of deferredItems) {
            const url = String(item.url || (item.card && item.card.url) || "");
            if (!url || !known.has(url)) continue;
            const raw = cards[url];
            const prev = (raw && (raw.card || raw)) || item.card || { url };
            cards[url] = { ...prev, ...(item.card || {}), url, reviewState: "uncertain" };
            deferredUrls.add(url);
            changed = true;
          }
          return changed ? { ...job, cards } : job;
        });
        if (!rawItems.length) {
          await saveJobList(jobs);
          return json(200, { ok: true, published: 0, appliedUrls: [], deferred: deferredUrls.size,
            counts: { products: catalog.products.length, filaments: catalog.filaments.length } });
        }
        const items = rawItems.map((it) => {
          const cid = String(it.candidateId || "");
          if (cid.startsWith("baseline:")) {
            const model = (board.items || []).find((i) => i.id === cid.slice(9));
            if (!model) return { ...it, action: "create", candidateId: "" };
            const live = catalogProductForItem(catalog, model) || catalogProductForItem(candidate, model);
            if (live) return { ...it, action: "merge", candidateId: live.id, stampBaselineId: model.id };
            return { ...it, action: "create", candidateId: "", baselineModel: model };
          }
          return it;
        });
        const next = applySelectedListings(catalog, candidate, items, jobs);
        const applied = next._applied || 0;
        const appliedUrls = next._appliedUrls || [];
        delete next._applied;
        delete next._appliedUrls;
        if (!applied && !deferredUrls.size) throw new Error("None of the selected products could be published — they need a price from the shop run");
        await writeJSON("catalog.json", next);
        await writeJSON("last-publish.json", { publishedAt: new Date().toISOString(), savedAt: next.savedAt });
        jobs = jobs.map((j) => ({ ...j, published: [...new Set([...(j.published || []), ...appliedUrls])] }));
        await saveJobList(jobs);
        catalog = next;
        return json(200, {
          ok: true,
          publishedAt: new Date().toISOString(),
          published: appliedUrls.length,
          appliedUrls,
          deferred: deferredUrls.size,
          counts: { products: next.products.length, filaments: next.filaments.length }
        });
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

      case "dedupeOfferUrls": {
        // One listing, one row. The keeper is the row whose name carries the most of the offer's
        // own words; when that is a tie the longer, more specific name wins.
        const rowsOf = (cat) => [...(cat.products || []), ...(cat.filaments || [])];
        const dupes = findDuplicateOfferUrls(catalog);
        let removed = 0;
        for (const d of dupes) {
          const slugWords = String(d.url).split("/").pop().replace(/[-_]+/g, " ").toLowerCase().split(/\s+/).filter((w) => w.length > 2);
          const score = (name) => slugWords.filter((w) => String(name || "").toLowerCase().includes(w)).length;
          const keeper = rowsOf(catalog).filter((r) => d.rows.some((x) => x.id === r.id))
            .sort((a, b) => score(b.name) - score(a.name) || String(b.name || "").length - String(a.name || "").length)[0];
          if (keeper) removed += stripOfferUrl(catalog, d.url, keeper.id);
        }
        await writeJSON("catalog.json", catalog);
        return json(200, { ok: true, groups: dupes.length, removed, left: findDuplicateOfferUrls(catalog).length });
      }

      case "createBackup": {
        const name = String(body.name || "").trim();
        if (!name) throw new Error("Give the backup a name");
        if (name.length > 60) throw new Error("Keep the name under 60 characters");
        const entry = await snapshotNow(name, "manual");
        return json(200, { ok: true, backup: entry, backups: await readBackupIndex() });
      }

      case "restoreBackup": {
        const key = String(body.key || "");
        if (!key.startsWith("backups/")) throw new Error("Pick a backup to restore");
        const snap = await readJSON(key, null);
        if (!snap || !snap.parts) throw new Error("That backup is missing or unreadable");
        // A restore is a big, deliberate override, so take a snapshot of what we are replacing
        // first: that makes restoring itself undoable.
        await snapshotNow("before restore " + new Date().toISOString().slice(0, 16).replace("T", " "), "automatic, taken before restoring " + snap.name);
        // Only the database is written back; the run history is left as it is.
        const parts = snap.parts;
        if (parts.catalog) await writeJSON("catalog.json", parts.catalog);
        if (parts.desk) await writeJSON("desk.json", parts.desk);
        if (parts.candidate) await writeJSON("candidate.json", parts.candidate);
        else await deleteKey("candidate.json");
        return json(200, {
          ok: true,
          restored: { key, name: snap.name, createdAt: snap.createdAt, ...countsOf(snap) },
          backups: await readBackupIndex()
        });
      }

      case "deleteBackup": {
        const key = String(body.key || "");
        if (!key.startsWith("backups/")) throw new Error("Pick a backup to delete");
        await deleteKey(key);
        const left = (await readBackupIndex()).filter((e) => e.key !== key);
        await writeBackupIndex(left);
        return json(200, { ok: true, backups: left });
      }

      case "seedBaseline": {
        const board = await seedBaselineFromBackup();
        return json(200, { ok: true, baseline: board, seeded: board.items.length });
      }

      case "importBaselineFromCatalog":
      case "importBaselineFromRun":
        throw new Error("The baseline is not filled from the catalog or a shop run. Confirm a worker recommendation, or add the model yourself.");

      case "confirmBaselineRecommendation": {
        const board = await ensureBaseline();
        const file = await readJSON("baseline-recommendations.json", { items: [] });
        const id = String(body.id || "");
        const rec = (file.items || []).find((it) => it.id === id);
        if (!rec) throw new Error("That recommendation is no longer here");
        file.items = (file.items || []).filter((it) => it.id !== id);
        try {
          addItem(board, { name: rec.name, brand: rec.brand, category: rec.category, image: rec.image });
          await writeJSON("baseline.json", board);
        } catch (err) {
          if (!/already on the baseline/i.test(err.message || "")) throw err;
        }
        await writeJSON("baseline-recommendations.json", file);
        return json(200, { ok: true, baseline: board, recommendations: file });
      }

      case "dismissBaselineRecommendation": {
        const file = await readJSON("baseline-recommendations.json", { items: [] });
        const id = String(body.id || "");
        const before = (file.items || []).length;
        file.items = (file.items || []).filter((it) => it.id !== id);
        if (file.items.length === before) throw new Error("That recommendation is no longer here");
        await writeJSON("baseline-recommendations.json", file);
        return json(200, { ok: true, recommendations: file });
      }

      case "deleteBaselineItem": {
        const board = await ensureBaseline();
        const id = String(body.id || "");
        board.items = (board.items || []).filter((i) => i.id !== id);
        await writeJSON("baseline.json", board);
        return json(200, { ok: true, baseline: board });
      }

      case "updateBaselineItem": {
        const board = await ensureBaseline();
        const id = String(body.id || "");
        const patch = body.patch && typeof body.patch === "object" ? { ...body.patch } : {};
        if (body.imageUpload) patch.image = await storeUploadedImage(id, body.imageUpload);
        patchItem(board, id, patch);
        await writeJSON("baseline.json", board);
        return json(200, { ok: true, baseline: board });
      }

      case "addBaselineItem": {
        const board = await ensureBaseline();
        addItem(board, { name: body.name, brand: body.brand, category: body.category, image: body.image });
        await writeJSON("baseline.json", board);
        return json(200, { ok: true, baseline: board });
      }

      case "addBaselineCategory": {
        const board = await ensureBaseline();
        addCategory(board, body.name);
        await writeJSON("baseline.json", board);
        return json(200, { ok: true, baseline: board });
      }

      case "renameBaselineCategory": {
        const board = await ensureBaseline();
        renameCategory(board, String(body.id || ""), body.name);
        await writeJSON("baseline.json", board);
        return json(200, { ok: true, baseline: board });
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

      case "deleteAllReview": {
        const urls = [...new Set(jobs.flatMap(listingUrlsFromJob))];
        jobs = jobs.map((j) => ({
          ...j,
          dropped: [...new Set([...(j.dropped || []), ...urls])],
          cards: {}
        }));
        await saveJobList(jobs);
        if (candidate) {
          candidate = dropUrlsFromCatalog(candidate, urls);
          await writeJSON("candidate.json", candidate);
        }
        return json(200, { ok: true, deleted: urls.length });
      }

      case "createJob": {
        const url = String(body.url || "").trim();
        if (!/^https:\/\//i.test(url)) throw new Error("Job URL must be HTTPS");
        const jobHost = (() => { try { return new URL(url).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; } })();
        const shop = (desk.shops || []).find((s) => s.id === jobHost || (s.url && (() => { try { return new URL(s.url).hostname.replace(/^www\./, "").toLowerCase() === jobHost; } catch { return false; } })()));
        const cat = ((shop && shop.categories) || []).find((c) => {
          try { return new URL(c.url).href === new URL(url).href; } catch { return c.url === url; }
        });
        const job = {
          id: "job-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8),
          type: String(body.type || "shop"),
          url,
          page2Url: String((cat && cat.page2Url) || body.page2Url || "").trim(),
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
          visualMatch: body.visualMatch === undefined ? true : body.visualMatch !== false,
          batchId: /^batch-[a-z0-9-]{4,48}$/i.test(String(body.batchId || "")) ? String(body.batchId) : ""
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

      case "abortAllJobs": {
        const at = new Date().toISOString();
        let aborted = 0;
        for (const job of jobs) {
          if (!["queued", "running"].includes(job.status)) continue;
          job.status = "aborted";
          job.progress = "Aborted from admin (all)";
          job.updatedAt = at;
          job.events = job.events || [];
          job.events.push({ type: "log", at, text: "Aborted from the online admin (abort all)." });
          aborted += 1;
        }
        if (aborted) await saveJobList(jobs);
        return json(200, { ok: true, aborted });
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
        const board = await ensureBaseline();
        let target = null;
        let baselineTarget = null;
        if (to === "new") {
          // stays null: a new row is always allowed
        } else if (to.startsWith("baseline:")) {
          baselineTarget = (board.items || []).find((it) => it.id === to.slice(9));
          if (!baselineTarget) throw new Error("Baseline model not found");
          target = [...shelves.flat()].find((p) => itemForProduct(board, p)?.id === baselineTarget.id) || null;
          if (target && target.id === from) throw new Error("Already on that product");
          if (target && (target.offers || []).some((o) => o.url === url)) throw new Error("Target already has that offer");
        } else {
          target = shelves.flat().find((p) => p.id === to);
          if (!target) throw new Error("Target product not found");
          if (target.id === from) throw new Error("Already on that product");
          if ((target.offers || []).some((o) => o.url === url)) throw new Error("Target already has that offer");
        }
        const [offer] = found.offers.splice(at, 1);
        const scraped = String(offer.sourceTitle || "").trim();
        if (to === "new") {
          // No scraped title: name it from the URL slug, tidied up, rather than leaving a raw
          // lowercase slug as the product name ("creality k2 plus combo").
          const slug = (() => {
            try {
              const tail = decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).pop() || "");
              return tail
                .replace(/[-_]+/g, " ")
                .replace(/\s+/g, " ")
                .trim()
                .split(" ")
                .filter((w) => w && !/^\d{3,}$/.test(w)) // drop trailing id numbers
                .map((w) => (/[0-9]/.test(w) || w.length <= 2 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
                .join(" ");
            } catch (_) { return ""; }
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
          upsertItems(board, [fromProduct(row, "catalog")]);
          await writeJSON("baseline.json", board);
        } else {
          if (!target && baselineTarget) {
            target = {
              id: baselineTarget.id,
              name: baselineTarget.name,
              title: baselineTarget.name,
              brand: baselineTarget.brand || "",
              kind: baselineTarget.category === "filaments" ? "filament" : "printer",
              aisle: baselineTarget.category === "filaments" ? "filament" : "fdm",
              image: baselineTarget.image || offer.image || "",
              offers: [],
              manual: true,
              baselineId: baselineTarget.id
            };
            shelfOf(target.kind).push(target);
          }
          target.offers = target.offers || [];
          target.offers.push(offer);
          target.price = priceOf(target);
          if (baselineTarget) Object.assign(target, { name: baselineTarget.name, title: baselineTarget.name, brand: baselineTarget.brand || target.brand || "", image: baselineTarget.image || target.image, baselineId: baselineTarget.id });
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
          baseline: board,
          counts: { products: catalog.products.length, filaments: catalog.filaments.length }
        });
      }

      case "deleteOffer": {
        const url = String(body.url || "").trim();
        const from = String(body.from || "").trim();
        if (!url || !from) throw new Error("deleteOffer needs url and from");
        const shelves = [catalog.products || [], catalog.filaments || []];
        const found = shelves.flat().find((p) => p.id === from);
        if (!found) throw new Error("Source product not found");
        const before = (found.offers || []).length;
        found.offers = (found.offers || []).filter((o) => o.url !== url);
        if (found.offers.length === before) throw new Error("That offer is not on the source product");
        const removedProduct = found.offers.length === 0;
        if (removedProduct) {
          catalog.products = (catalog.products || []).filter((p) => p.id !== from);
          catalog.filaments = (catalog.filaments || []).filter((p) => p.id !== from);
        } else {
          const prices = found.offers.map((o) => Number(o.price)).filter((n) => Number.isFinite(n) && n > 0);
          if (prices.length) found.price = Math.min(...prices);
        }
        catalog.productCount = (catalog.products || []).length;
        catalog.filamentCount = (catalog.filaments || []).length;
        catalog.savedAt = new Date().toISOString();
        await writeJSON("catalog.json", catalog);
        return json(200, { ok: true, removedProduct, counts: { products: catalog.products.length, filaments: catalog.filaments.length } });
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
        const product = await updateCatalogProduct(catalog, body);
        catalog.savedAt = new Date().toISOString();
        await writeJSON("catalog.json", catalog);
        return json(200, { ok: true, product, baseline: await loadBaselineBoard() });
      }

      case "saveLayaOpinions": {
        const results = Array.isArray(body.results) ? body.results : [];
        const at = new Date().toISOString();
        jobs = jobs.map((j) => {
          const known = new Set(listingUrlsFromJob(j));
          const cards = { ...(j.cards || {}) };
          let changed = false;
          for (const r of results) {
            const url = String(r.url || "");
            if (!url || !known.has(url)) continue;
            const prev = (cards[url] && ((cards[url].card) || cards[url])) || { url };
            const hit = r.matchId ? findById(catalog, r.matchId) : null;
            const named = r.matchName || (hit && hit.product && hit.product.name) || "";
            const laya = {
              action: r.action || "hold",
              matchId: r.matchId || "",
              matchName: named,
              reason: r.reason || "",
              confidence: r.confidence,
              at
            };
            cards[url] = { ...prev, url, name: prev.name || "", laya, decision: prev.decision };
            changed = true;
          }
          return changed ? { ...j, cards } : j;
        });
        await saveJobList(jobs);
        return json(200, { ok: true });
      }

      case "addUncertainToBaseline": {
        const url = String(body.url || "");
        const job = jobs.find((j) => j.id === body.jobId) || jobs.find((j) => j.cards && j.cards[url]);
        if (!job || !url) throw new Error("Pick a card");
        const raw = job.cards && job.cards[url];
        const prev = (raw && (raw.card || raw)) || {};
        const name = String(body.name != null ? body.name : prev.name || "").trim();
        const brand = String(body.brand != null ? body.brand : prev.brand || "").trim();
        if (!name) throw new Error("Name required");
        const kind = prev.kind || job.kind || "printer";
        const listing = { name, brand, kind: kind === "filament" ? "filament" : "printer" };
        let price = coercePrice(body.price) || coercePrice(prev.price) || coercePrice(raw && raw.price) || priceFromJobs(jobs, url);
        if (!price && /^https:\/\//i.test(url)) {
          try {
            const page = await fetch(url, {
              redirect: "follow",
              signal: AbortSignal.timeout(12000),
              headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36", "Accept-Language": "tr-TR,tr;q=0.9,en;q=0.7" }
            });
            if (page.ok) {
              const picked = pickPrice(await page.text());
              price = picked && picked.price;
              if (price && picked.plusVat) price = withVat(price, "excluded");
            }
          } catch { /* the card price is enough when the shop page cannot be read */ }
        }
        if (!price) throw new Error("No price on this card, so it was not added or published");
        const board = await ensureBaseline();
        const category = listing.kind === "filament" && (board.categories || []).some((c) => c.id === "filaments") ? "filaments" : "printers";
        const sameName = (it) => foldName(it.name) === foldName(name) && foldName(it.brand || "") === foldName(brand);
        let created = (board.items || []).find((it) => sameName(it) && (it.category === "filaments") === (category === "filaments"));
        if (!created) created = addItem(board, { name, brand, category, image: prev.image || "" });
        stripOfferUrl(catalog, url, created.id);
        const next = applySelectedListings(catalog, candidate, [{
          url,
          action: "create",
          baselineModel: created,
          card: { ...prev, url, name, brand, kind: listing.kind, price, image: prev.image || "" }
        }], jobs);
        const applied = next._applied || 0;
        const appliedUrls = next._appliedUrls || [];
        delete next._applied;
        delete next._appliedUrls;
        if (!applied) throw new Error("Could not publish this card");
        await writeJSON("baseline.json", board);
        await writeJSON("catalog.json", next);
        await writeJSON("last-publish.json", { publishedAt: new Date().toISOString(), savedAt: next.savedAt });
        const cards = { ...(job.cards || {}) };
        cards[url] = {
          ...prev,
          url,
          name,
          brand,
          decision: { action: "merge", candidateId: "baseline:" + created.id, baselineId: created.id, candidateName: created.name }
        };
        jobs = jobs.map((j) => (j.id === job.id ? { ...j, cards, published: [...new Set([...(j.published || []), ...appliedUrls])] } : j));
        await saveJobList(jobs);
        catalog = next;
        return json(200, { ok: true, baseline: board, item: created, published: applied });
      }

      case "updateUncertainCard": {
        const url = String(body.url || "");
        const job = jobs.find((j) => j.id === body.jobId);
        if (!job || !url) throw new Error("Pick a card");
        const cards = { ...(job.cards || {}) };
        const prev = (cards[url] && ((cards[url].card) || cards[url])) || { url };
        const inner = { ...prev, url };
        if (body.patch && body.patch.name != null) inner.name = String(body.patch.name);
        if (body.patch && body.patch.brand != null) inner.brand = String(body.patch.brand);
        cards[url] = inner;
        jobs = jobs.map((j) => (j.id === job.id ? { ...j, cards } : j));
        await saveJobList(jobs);
        return json(200, { ok: true });
      }

      case "republishCatalog": {
        catalog.savedAt = new Date().toISOString();
        await writeJSON("catalog.json", catalog);
        await writeJSON("last-publish.json", { publishedAt: catalog.savedAt, savedAt: catalog.savedAt, republished: true });
        return json(200, { ok: true, savedAt: catalog.savedAt, counts: { products: (catalog.products || []).length, filaments: (catalog.filaments || []).length } });
      }

      case "updateProducts": {
        const items = Array.isArray(body.items) ? body.items : [];
        if (!items.length || items.length > 500) throw new Error("Choose between 1 and 500 products to update");
        for (const item of items) await updateCatalogProduct(catalog, item || {});
        catalog.savedAt = new Date().toISOString();
        await writeJSON("catalog.json", catalog);
        await writeJSON("last-publish.json", { publishedAt: catalog.savedAt, savedAt: catalog.savedAt });
        return json(200, { ok: true, updated: items.length });
      }

      default:
        throw new Error("Unknown action");
    }
  } catch (err) {
    return json(400, { error: err.message || "Admin request failed" });
  }
};
