"use strict";

const fs = require("fs");
const path = require("path");

const DEFAULT_CATEGORIES = [
  { id: "printers", name: "3D Printers" },
  { id: "filaments", name: "Filament" }
];

// v001-printers.json is bundled with require() in loadBackupPrinters() rather
// than resolved through __dirname: Workers has no filesystem, and a bundled
// JSON module is inlined by the bundler while still working under Node.

function emptyBoard() {
  return {
    categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })),
    items: [],
    updatedAt: new Date().toISOString()
  };
}

function loadBackupPrinters() {
  try {
    // Bundled at build time instead of read from disk; still valid under Node.
    const data = require("../data/v001-printers.json");
    return Array.isArray(data.products) ? data.products : [];
  } catch {
    return [];
  }
}

function categoryId(name) {
  const id = String(name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return id || "cat-" + Date.now().toString(36);
}

function foldKey(it) {
  return String(it.brand || "").trim().toLowerCase() + "\n" + String(it.name || "").trim().toLowerCase();
}

function kindOf(it) {
  return it.kind === "filament" || it.category === "filaments" ? "filament" : "printer";
}

function itemForProduct(board, product) {
  const items = (board && board.items) || [];
  const exact = items.find((it) => it.id === product.id);
  if (exact) return exact;
  const folded = items.filter((it) => kindOf(it) === kindOf(product) && foldKey(it) === foldKey(product));
  if (folded.length === 1) return folded[0];
  const { decidePair } = require("./product-match.cjs");
  const matches = items.filter((it) => kindOf(it) === kindOf(product)
    && decidePair({ ...product, kind: kindOf(product) }, { ...it, kind: kindOf(it) }).action === "merge");
  return matches.length === 1 ? matches[0] : null;
}

function asMatchProducts(board, kind) {
  return ((board && board.items) || [])
    .filter((it) => !kind || kindOf(it) === kind)
    .map((it) => ({
      id: it.id,
      name: it.name,
      brand: it.brand || "",
      kind: kindOf(it),
      image: it.image || "",
      offers: []
    }));
}

function matchListingToBoard(listing, board) {
  const { rankCandidates } = require("./product-match.cjs");
  const kind = listing && listing.kind === "filament" ? "filament" : "printer";
  const pool = asMatchProducts(board, kind);
  if (!pool.length) return { item: null, ranked: [] };
  const ranked = rankCandidates({ ...listing, kind }, pool);
  const best = ranked[0];
  if (!best || best.decision.action !== "merge") return { item: null, ranked };
  return { item: best.item, decision: best.decision, ranked };
}

function catalogProductForItem(catalog, item) {
  if (!catalog || !item) return null;
  const both = [...((catalog.products || [])), ...((catalog.filaments || []))];
  const stamped = both.find((p) => p.id === item.id || p.baselineId === item.id);
  if (stamped) return stamped;
  const named = both.filter((p) => !p.baselineId && kindOf(p) === kindOf(item) && foldKey(p) === foldKey(item));
  if (named.length === 1) return named[0];
  if (named.length > 1) return null;
  // The other shops already landed on a catalog row whose title is the scraped name,
  // not the baseline name. Join that row when it is the only one this model matches.
  const linked = both.filter((p) => !p.baselineId && itemForProduct({ items: [item] }, p)?.id === item.id);
  return linked.length === 1 ? linked[0] : null;
}

function loadHumanBoard(catalogFile, explicit) {
  const files = [explicit];
  if (catalogFile) {
    const dir = path.dirname(catalogFile);
    files.push(path.join(dir, "online-baseline.json"), path.join(dir, "baseline.json"));
  }
  for (const file of files.filter(Boolean)) {
    try {
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      if (data && Array.isArray(data.items)) return data;
    } catch { /* next */ }
  }
  return null;
}

function applyBaselineImages(catalog, board) {
  for (const product of [...((catalog && catalog.products) || []), ...((catalog && catalog.filaments) || [])]) {
    const item = itemForProduct(board, product);
    if (!item || !item.image) continue;
    product.image = item.image;
    product.imageSource = "baseline";
    product.baselineId = item.id;
  }
  return catalog;
}

function sanitizeItem(it) {
  if (!it || typeof it !== "object") return null;
  const id = String(it.id || "").trim();
  const name = String(it.name || it.title || "").trim();
  if (!id || !name) return null;
  return {
    id,
    category: String(it.category || "printers").trim() || "printers",
    name,
    brand: String(it.brand || "").trim(),
    image: String(it.image || "").trim(),
    addedAt: it.addedAt || new Date().toISOString()
  };
}

function ensureCategories(board) {
  const cats = [];
  const seen = new Set();
  for (const c of [...DEFAULT_CATEGORIES, ...((board && board.categories) || [])]) {
    const id = String(c.id || categoryId(c.name) || "").trim();
    const name = String(c.name || id).trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    cats.push({ id, name });
  }
  for (const it of (board && board.items) || []) {
    const id = String(it.category || "printers");
    if (seen.has(id)) continue;
    seen.add(id);
    cats.push({ id, name: id });
  }
  return cats;
}

function sanitizeBoard(board) {
  const next = emptyBoard();
  const items = ((board && board.items) || []).map(sanitizeItem).filter(Boolean);
  next.items = items;
  next.categories = ensureCategories({ ...(board || {}), items });
  next.updatedAt = (board && board.updatedAt) || next.updatedAt;
  return next;
}

function isIdentityStyleBoard(board) {
  const items = board && board.items;
  if (!items || !items.length) return false;
  let n = 0;
  for (const it of items) {
    const id = String(it.identityId || it.id || "");
    const slashId = id.includes("/") && !/^https?:/i.test(id) && !id.startsWith("qwen-") && !id.startsWith("sel-") && !id.startsWith("bl-");
    const noName = !it.name || it.name === id;
    if (slashId && (noName || !(it.brand))) n += 1;
  }
  return n >= Math.max(1, items.length * 0.6);
}

function fromProduct(p, origin) {
  const kind = p.kind === "filament" || origin === "filaments" ? "filaments" : "printers";
  return sanitizeItem({
    id: p.id || p.name,
    category: p.category || kind,
    name: p.name || p.title || p.id,
    brand: p.brand || "",
    image: p.image || ""
  });
}

function fromRunCard(card, job) {
  const kind = (job && job.kind) === "filament" || card.kind === "filament" ? "filaments" : "printers";
  return sanitizeItem({
    id: card.id || card.name,
    category: kind,
    name: card.name,
    brand: card.brand || "",
    image: card.image || ""
  });
}

function upsertItems(board, incoming) {
  const items = [...(board.items || [])];
  const byId = new Map(items.map((i) => [i.id, i]));
  const byFold = new Map(items.map((i) => [foldKey(i), i]));
  let added = 0;
  let updated = 0;
  for (const raw of incoming || []) {
    const it = sanitizeItem(raw);
    if (!it) continue;
    const old = byId.get(it.id) || byFold.get(foldKey(it));
    if (!old) {
      items.push(it);
      byId.set(it.id, it);
      byFold.set(foldKey(it), it);
      added += 1;
      continue;
    }
    if (it.image && !old.image) old.image = it.image;
    if (it.brand && !old.brand) old.brand = it.brand;
    updated += 1;
  }
  board.items = items;
  board.categories = ensureCategories(board);
  board.updatedAt = new Date().toISOString();
  return { added, updated, total: items.length };
}

function addCategory(board, name) {
  const trimmed = String(name || "").trim();
  if (!trimmed) throw new Error("Category name required");
  const id = categoryId(trimmed);
  board.categories = ensureCategories(board);
  if (board.categories.some((c) => c.id === id || c.name.toLowerCase() === trimmed.toLowerCase())) {
    throw new Error("That category already exists");
  }
  board.categories.push({ id, name: trimmed });
  board.updatedAt = new Date().toISOString();
  return { id, name: trimmed };
}

function renameCategory(board, id, name) {
  const trimmed = String(name || "").trim();
  if (!trimmed) throw new Error("Category name required");
  board.categories = ensureCategories(board);
  const cat = board.categories.find((c) => c.id === id);
  if (!cat) throw new Error("Category not found");
  if (board.categories.some((c) => c.id !== id && c.name.toLowerCase() === trimmed.toLowerCase())) {
    throw new Error("That category already exists");
  }
  cat.name = trimmed;
  board.updatedAt = new Date().toISOString();
  return cat;
}

function setItemCategory(board, id, category) {
  const item = (board.items || []).find((i) => i.id === id);
  if (!item) throw new Error("Model not found");
  const cats = ensureCategories(board);
  if (!cats.some((c) => c.id === category)) throw new Error("Pick an existing category");
  item.category = category;
  board.categories = cats;
  board.updatedAt = new Date().toISOString();
  return item;
}

function patchItem(board, id, patch) {
  const item = (board.items || []).find((i) => i.id === id);
  if (!item) throw new Error("Model not found");
  if (patch.name != null) {
    const name = String(patch.name).trim();
    if (!name) throw new Error("Name required");
    item.name = name;
  }
  if (patch.brand != null) item.brand = String(patch.brand).trim();
  if (patch.image != null) item.image = String(patch.image).trim();
  if (patch.category != null) setItemCategory(board, id, String(patch.category));
  board.updatedAt = new Date().toISOString();
  return item;
}

// A catalog or uncertain rename updates the one baseline row you already approved.
// It never creates a row, and it never guesses when two rows fit the old name.
function renameLinkedItem(board, product, previous, nextName) {
  const name = String(nextName || "").trim();
  const oldName = String(previous && previous.name || "").trim();
  if (!board || !name || !oldName || name === oldName) return null;
  const items = board.items || [];
  let item = null;
  if (product && product.baselineId) item = items.find((it) => it.id === product.baselineId) || null;
  if (!item && product && product.id) item = items.find((it) => it.id === product.id) || null;
  if (!item) {
    const probe = { name: oldName, brand: (previous && previous.brand) || (product && product.brand) || "" };
    const wantKind = product && (product.kind || product.category) ? kindOf(product) : "";
    const hits = items.filter((it) => foldKey(it) === foldKey(probe));
    const typed = wantKind ? hits.filter((it) => kindOf(it) === wantKind) : hits;
    const pick = typed.length === 1 ? typed : hits;
    if (pick.length === 1) item = pick[0];
  }
  if (!item) return null;
  item.name = name;
  board.updatedAt = new Date().toISOString();
  return item;
}

// Worker "create" decisions wait here. Confirming one is what copies it onto the baseline.
function addRecommendations(file, incoming, board, job) {
  const items = [...((file && file.items) || [])];
  const onBaseline = new Set(((board && board.items) || []).map((it) => foldKey(it)));
  let added = 0;
  for (const raw of incoming || []) {
    const name = String(raw.name || "").trim();
    if (!name) continue;
    const row = {
      name,
      brand: String(raw.brand || "").trim(),
      category: raw.kind === "filament" || raw.category === "filaments" ? "filaments" : "printers",
      image: String(raw.image || "").trim(),
      url: String(raw.url || "").trim(),
      site: String((job && job.site) || raw.site || "").trim(),
      jobId: String((job && job.id) || "").trim(),
      reason: String(raw.reason || "Worker would add this as its own product").slice(0, 240),
      at: new Date().toISOString()
    };
    if (onBaseline.has(foldKey(row))) continue;
    if (items.some((it) => (row.url && it.url === row.url) || foldKey(it) === foldKey(row))) continue;
    row.id = "rec-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6) + "-" + added;
    items.push(row);
    added += 1;
  }
  return { items, added };
}

function absorbWorkerCreates(board, file, job) {
  const incoming = [];
  for (const raw of Object.values((job && job.cards) || {})) {
    const card = (raw && raw.card) || raw || {};
    const decision = (raw && raw.decision) || card.decision || {};
    if (decision.action !== "create" || !card.name) continue;
    incoming.push({
      name: card.name,
      brand: card.brand || "",
      image: card.image || "",
      url: card.url || "",
      kind: card.kind,
      reason: decision.reason || "Worker would add this as its own product"
    });
  }
  return addRecommendations(file, incoming, board, job);
}

function addItem(board, raw) {
  const it = sanitizeItem({
    id: raw.id || "bl-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6),
    category: raw.category,
    name: raw.name,
    brand: raw.brand,
    image: raw.image
  });
  if (!it) throw new Error("Name required");
  const cats = ensureCategories(board);
  if (!cats.some((c) => c.id === it.category)) throw new Error("Pick an existing category");
  if ((board.items || []).some((i) => i.id === it.id || foldKey(i) === foldKey(it))) {
    throw new Error("That model is already on the baseline");
  }
  board.categories = cats;
  board.items = [...(board.items || []), it];
  board.updatedAt = new Date().toISOString();
  return it;
}

module.exports = {
  DEFAULT_CATEGORIES,
  emptyBoard,
  loadBackupPrinters,
  isIdentityStyleBoard,
  sanitizeBoard,
  sanitizeItem,
  fromProduct,
  fromRunCard,
  upsertItems,
  addCategory,
  renameCategory,
  setItemCategory,
  patchItem,
  addItem,
  renameLinkedItem,
  addRecommendations,
  absorbWorkerCreates,
  categoryId,
  kindOf,
  asMatchProducts,
  matchListingToBoard,
  catalogProductForItem,
  loadHumanBoard,
  itemForProduct,
  applyBaselineImages
};
